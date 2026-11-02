// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import { ApprovalBroker, type ApprovalDecision, type ApprovalPrompter, type ApprovalRequest } from '../../electron/main/services/agent-actions/approval-broker'
import { ApprovalCenter } from '../../electron/main/services/approvals/approval-center'
import { crashDraft } from '../../electron/main/services/approvals/drafts'
import { executionSignal, ExecutionRegistry, onExecutionEnded } from '../../electron/main/services/execution-registry'

vi.mock('electron', () => ({ app: { getPath: () => '' }, BrowserWindow: { getAllWindows: () => [] } }))

/** A prompter that never answers on its own: it only settles when its ask is aborted, as the approval center does. */
function waitingPrompter() {
  const asks: { request: ApprovalRequest; signal: AbortSignal }[] = []
  const prompter: ApprovalPrompter = {
    ask: (request, signal) => new Promise<ApprovalDecision>(resolve => {
      asks.push({ request, signal })
      signal.addEventListener('abort', () => resolve('deny'), { once: true })
    })
  }
  return { prompter, asks }
}

const ask = (tool = 'oxespace_git'): Omit<ApprovalRequest, 'id' | 'hash' | 'expiresAt'> => ({
  actor: 'pane:p', tool, risk: 'write', text: `${tool} push`, requester: { kind: 'agent', id: 'p', label: { code: 'approvals.requester.app', params: {} } },
  level: 'medium', title: { code: 'approvals.title.agent', params: {} }, summary: { code: 'approvals.title.agent', params: {} }, appNotes: []
} as never)

describe('B23 · what an execution asks for ends with the execution', () => {
  it('tells every listener which execution ended: pane closed or exited, session ended, or replaced by a new one', () => {
    const registry = new ExecutionRegistry()
    const ended: string[] = []
    const stop = onExecutionEnded(execution => ended.push(`${execution.owner.kind}:${execution.owner.id}:${execution.generation}`))
    try {
      registry.register({ paneId: 'p1', workspaceId: 'w', cwd: '.' })
      registry.register({ owner: { kind: 'thread', id: 't1' }, workspaceId: 'w', cwd: '.' })
      // A new launch in the same pane replaces the old execution.
      registry.register({ paneId: 'p1', workspaceId: 'w', cwd: '.' })
      registry.end('p1')
      registry.endOwner({ kind: 'thread', id: 't1' })
      expect(ended).toEqual(['pane:p1:1', 'pane:p1:2', 'thread:t1:1'])
      // Nothing to end: no event.
      registry.end('p1')
      expect(ended).toHaveLength(3)
    } finally { stop() }
  })

  it('gives each execution its own signal, keyed by its own owner object, that aborts when it ends', () => {
    const registry = new ExecutionRegistry()
    const owner = { kind: 'pane' as const, id: 'p2' }
    expect(executionSignal(owner)).toBeUndefined()
    expect(executionSignal(undefined)).toBeUndefined()
    registry.register({ paneId: 'p2', workspaceId: 'w', cwd: '.' })
    const firstOwner = registry.forOwner(owner)!.owner
    const first = executionSignal(firstOwner)!
    expect(first.aborted).toBe(false)
    // An owner object that is not an execution's own has no signal: nothing ties an ask to it.
    expect(executionSignal({ kind: 'pane', id: 'p2' })).toBeUndefined()
    registry.register({ paneId: 'p2', workspaceId: 'w', cwd: '.' })
    expect(first.aborted).toBe(true)
    // A late call from the first launch still gets the first launch's (aborted) signal, never the second's.
    expect(executionSignal(firstOwner)).toBe(first)
    const second = executionSignal(registry.forOwner(owner)!.owner)!
    expect(second).not.toBe(first)
    expect(second.aborted).toBe(false)
    registry.end('p2')
    expect(second.aborted).toBe(true)
  })

  it('never lets one registry abort another registry\'s signal for the same owner', () => {
    const [a, b] = [new ExecutionRegistry(), new ExecutionRegistry()]
    a.register({ paneId: 'shared', workspaceId: 'w', cwd: '.' })
    b.register({ paneId: 'shared', workspaceId: 'w', cwd: '.' })
    const inA = executionSignal(a.forOwner({ kind: 'pane', id: 'shared' })!.owner)!
    b.end('shared')
    expect(inA.aborted).toBe(false)
    a.end('shared')
    expect(inA.aborted).toBe(true)
  })

  it('keeps notifying the other listeners when one throws', () => {
    const registry = new ExecutionRegistry()
    const heard: string[] = []
    const stops = [onExecutionEnded(() => { throw new Error('broken listener') }), onExecutionEnded(execution => heard.push(execution.paneId))]
    try {
      registry.register({ paneId: 'p3', workspaceId: 'w', cwd: '.' })
      expect(() => registry.end('p3')).not.toThrow()
      expect(heard).toEqual(['p3'])
    } finally { for (const stop of stops) stop() }
  })

  it('cancels the ended execution\'s pending asks, and only that execution\'s', async () => {
    const { prompter, asks } = waitingPrompter()
    let ended: ((execution: { id: string }) => void) | undefined
    const broker = new ApprovalBroker(prompter, Date.now, 10, listener => { ended = listener })
    expect(await broker.require('exec-a', 'scope', ask())).toMatchObject({ state: 'pending' })
    expect(await broker.require('exec-b', 'scope', ask())).toMatchObject({ state: 'pending' })
    expect(asks.map(item => item.signal.aborted)).toEqual([false, false])
    ended!({ id: 'exec-a' })
    expect(asks.map(item => item.signal.aborted)).toEqual([true, false])
    // A call authenticated just before the pane closed raises nothing new: nobody is left to act on the answer.
    expect(await broker.require('exec-a', 'scope', ask())).toEqual({ state: 'denied' })
    expect(asks).toHaveLength(2)
    // exec-b is still waiting on its own request, and can still ask.
    expect(asks[1].signal.aborted).toBe(false)
    expect(await broker.require('exec-b', 'scope', ask('oxespace_other'))).toMatchObject({ state: 'pending' })
    expect(asks).toHaveLength(3)
  })

  it('does not remember a cancelled ask as the person\'s denial, and stops listening when disposed', async () => {
    const { prompter } = waitingPrompter()
    const listeners: ((execution: { id: string }) => void)[] = []
    let unsubscribed = false
    const broker = new ApprovalBroker(prompter, Date.now, 10, listener => { listeners.push(listener); return () => { unsubscribed = true } })
    expect(await broker.require('exec-c', 'scope', ask())).toMatchObject({ state: 'pending' })
    listeners[0]({ id: 'exec-c' })
    await new Promise(resolve => setTimeout(resolve, 0))
    expect((broker as unknown as { denials: Map<string, number> }).denials.size).toBe(0)
    broker.dispose()
    expect(unsubscribed).toBe(true)
  })

  it('subscribes to the registry by default: closing the pane cancels the ask', async () => {
    const registry = new ExecutionRegistry()
    const env = registry.register({ paneId: 'p4', workspaceId: 'w', cwd: '.' })
    const { prompter, asks } = waitingPrompter()
    const broker = new ApprovalBroker(prompter, Date.now, 10)
    expect(await broker.require(env.OXESPACE_EXECUTION_ID, 'scope', ask())).toMatchObject({ state: 'pending' })
    registry.end('p4')
    expect(asks[0].signal.aborted).toBe(true)
  })

  it('end to end through the approval center: the native dialog closes and the request is recorded as cancelled', async () => {
    const nativeSignals: AbortSignal[] = []
    const center = new ApprovalCenter({
      send: () => {}, hasWindow: () => false,
      native: (_request, _reason, signal) => new Promise(() => { nativeSignals.push(signal) })
    })
    const registry = new ExecutionRegistry()
    registry.register({ owner: { kind: 'thread', id: 't5' }, workspaceId: 'w', cwd: '.' })
    const outcome = center.ask(crashDraft(), executionSignal(registry.forOwner({ kind: 'thread', id: 't5' })!.owner))
    await Promise.resolve()
    expect(nativeSignals).toHaveLength(1)
    registry.endOwner({ kind: 'thread', id: 't5' })
    await expect(outcome).resolves.toMatchObject({ intent: 'deny', by: 'cancelled' })
    expect(nativeSignals[0].aborted).toBe(true)
    expect(center.history()[0]).toMatchObject({ by: 'cancelled', reason: { code: 'approvals.denied.cancelled' } })
  })
})
