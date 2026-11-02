import { afterEach, describe, expect, it, vi } from 'vitest'
import { E2E_AGENT_STATE_GLOBAL, e2eAgentStateEnabled, installE2eAgentStateHook, type E2eAgentStateDeps, type E2eAgentStateFn } from '../../electron/main/e2e/agent-state-hook'
import { loadManifests } from '../../electron/main/services/agent-state/manifest'
import type { AgentHookStatusEvent } from '../../shared/types/agent-hooks'
import type { PaneAgentState, PaneAgentStateEvent } from '../../shared/types/agent-state'
import type { WorkspacePane } from '../../shared/types/workspace'

const ASKED = { OXESPACE_E2E_MOCK_NATIVE: '1', OXESPACE_E2E_AGENT_STATE: '1' }
const { manifests } = loadManifests('resources/agent-detection')

function pane(id: string, fields: Partial<WorkspacePane> = {}): WorkspacePane {
  return { id, workspaceId: 'ws-1', type: 'terminal', rowIndex: 0, columnIndex: 0, shellProfileId: 'builtin-claude', status: 'idle', agentProfileId: null, agentName: null, displayName: null, createdAt: null, rootPath: null, ...fields }
}

function harness() {
  let clock = 1_000
  const panes = [pane('pane-claude'), pane('pane-codex', { shellProfileId: 'builtin-codex' }), pane('pane-editor', { type: 'editor' })]
  const changed: PaneAgentStateEvent[] = []
  const hookStatus: AgentHookStatusEvent[] = []
  const registerIpc = vi.fn()
  const deps: E2eAgentStateDeps = {
    findPane: id => panes.find(item => item.id === id) ?? null,
    manifests: () => manifests,
    emit: event => changed.push(event),
    sendHookStatus: event => hookStatus.push(event),
    registerIpc,
    now: () => clock
  }
  const target: Record<string, unknown> = {}
  const service = installE2eAgentStateHook(target, ASKED, false, deps)
  const set = target[E2E_AGENT_STATE_GLOBAL] as E2eAgentStateFn
  return { target, service, set, changed, hookStatus, registerIpc, tick: (ms = 10) => { clock += ms } }
}

afterEach(() => { vi.useRealTimers() })

describe('E2E agent-state hook gate', () => {
  const deps = (): E2eAgentStateDeps => ({ findPane: () => null, manifests: () => new Map(), emit: vi.fn(), sendHookStatus: vi.fn(), registerIpc: vi.fn() })

  it('is never defined in a packaged build, whatever the environment says', () => {
    const target: Record<string, unknown> = {}
    const d = deps()
    expect(e2eAgentStateEnabled(ASKED, true)).toBe(false)
    expect(installE2eAgentStateHook(target, ASKED, true, d)).toBeNull()
    expect(target[E2E_AGENT_STATE_GLOBAL]).toBeUndefined()
    expect(d.registerIpc).not.toHaveBeenCalled()
  })

  it('is not defined without the E2E mocks or without its own flag', () => {
    for (const env of [{ OXESPACE_E2E_AGENT_STATE: '1' }, { OXESPACE_E2E_MOCK_NATIVE: '1' }, {}, { OXESPACE_E2E_MOCK_NATIVE: '1', OXESPACE_E2E_AGENT_STATE: 'true' }]) {
      const target: Record<string, unknown> = {}
      const d = deps()
      expect(e2eAgentStateEnabled(env, false)).toBe(false)
      expect(installE2eAgentStateHook(target, env, false, d)).toBeNull()
      expect(target[E2E_AGENT_STATE_GLOBAL]).toBeUndefined()
      expect(d.registerIpc).not.toHaveBeenCalled()
    }
  })

  it('is defined in an unpackaged E2E run that asks for it, with the real agent-state IPC', () => {
    const { target, service, registerIpc } = harness()
    expect(typeof target[E2E_AGENT_STATE_GLOBAL]).toBe('function')
    expect(registerIpc).toHaveBeenCalledWith(service)
  })
})

describe('E2E agent-state hook drives the production pipeline', () => {
  it('blocked, then working, then done: the window gets the production events and explain answers from the hook', () => {
    const { set, service, changed, hookStatus, tick } = harness()

    const blocked = set({ paneId: 'pane-claude', state: 'waiting', hookEvent: 'PermissionRequest' })
    expect(blocked).toMatchObject({ ok: true, explain: { state: { paneId: 'pane-claude', workspaceId: 'ws-1', agent: 'claude', state: 'blocked', source: 'hook' }, hook: { state: 'blocked' }, pendingIdle: false } })
    expect(changed.at(-1)).toMatchObject({ paneId: 'pane-claude', state: 'blocked', source: 'hook', seen: true })
    expect(hookStatus.at(-1)).toMatchObject({ paneId: 'pane-claude', workspaceId: 'ws-1', agent: 'claude-code', state: 'waiting', event: 'PermissionRequest', sessionId: null })
    expect(blocked.ok && blocked.explain).toEqual(service.explain('pane-claude'))

    tick(); set({ paneId: 'pane-claude', state: 'working' })
    expect(changed.at(-1)).toMatchObject({ state: 'working', source: 'hook' })

    tick()
    const done = set({ paneId: 'pane-claude', state: 'done' })
    expect(done).toMatchObject({ ok: true, explain: { state: { state: 'done', source: 'hook', seen: false, completionSeq: 1 }, hook: { state: 'idle' } } })
    const last = changed.at(-1) as PaneAgentState
    expect(last).toMatchObject({ state: 'done', source: 'hook', seen: false, completionSeq: 1 })
    expect(hookStatus.at(-1)).toMatchObject({ state: 'done', event: 'Stop' })
    expect(changed.map(event => 'state' in event ? event.state : 'cleared')).toEqual(['blocked', 'working', 'done'])

    // The person looks at the pane: a finished turn is no longer news.
    service!.markSeen('pane-claude')
    expect(changed.at(-1)).toMatchObject({ state: 'idle', seen: true })
    expect(service!.explain('pane-claude').state).toMatchObject({ state: 'idle', source: 'hook' })
  })

  it('a done straight after blocked publishes idle, as the service does for a real hook', () => {
    const { set, changed, tick } = harness()
    set({ paneId: 'pane-claude', state: 'waiting' })
    tick()
    expect(set({ paneId: 'pane-claude', state: 'done' })).toMatchObject({ ok: true, explain: { state: { state: 'idle' } } })
    expect(changed.at(-1)).toMatchObject({ state: 'idle', completionSeq: 0 })
  })

  it('ended clears the pane, and the agent defaults to the pane profile', () => {
    const { set, changed, hookStatus } = harness()
    expect(set({ paneId: 'pane-codex', state: 'working' })).toMatchObject({ ok: true, explain: { state: { agent: 'codex', state: 'working' } } })
    expect(hookStatus.at(-1)).toMatchObject({ agent: 'codex', event: 'UserPromptSubmit' })
    expect(set({ paneId: 'pane-codex', state: 'ended' })).toEqual({ ok: true, explain: { state: null, hook: null, screen: null, pendingIdle: false } })
    expect(changed.at(-1)).toEqual({ paneId: 'pane-codex', workspaceId: 'ws-1', cleared: true })
  })

  it('later screen evaluations of the empty mock screen do not override the injected state', async () => {
    vi.useFakeTimers()
    const { set, changed, tick } = harness()
    set({ paneId: 'pane-claude', state: 'waiting' })
    tick(2_000)
    await vi.advanceTimersByTimeAsync(2_000)
    expect(changed.at(-1)).toMatchObject({ state: 'blocked', source: 'hook' })
  })
})

describe('E2E agent-state hook refusals', () => {
  it('refuses an unknown pane, a non-terminal pane, an unknown state or agent, a reason and malformed input, without emitting', () => {
    const { set, changed, hookStatus } = harness()
    expect(set({ paneId: 'nope', state: 'working' })).toEqual({ ok: false, refusal: 'unknown-pane' })
    expect(set({ paneId: 'pane-editor', state: 'working' })).toEqual({ ok: false, refusal: 'not-terminal-pane' })
    expect(set({ paneId: 'pane-claude', state: 'blocked' })).toEqual({ ok: false, refusal: 'unknown-state' })
    expect(set({ paneId: 'pane-claude', state: 'idle' })).toEqual({ ok: false, refusal: 'unknown-state' })
    expect(set({ paneId: 'pane-claude', state: 'working', agent: 'copilot' })).toEqual({ ok: false, refusal: 'unknown-agent' })
    expect(set({ paneId: 'pane-claude', state: 'waiting', reason: 'Run npm test' })).toEqual({ ok: false, refusal: 'reason-unsupported' })
    expect(set({ paneId: 'pane-claude', state: 'waiting', hookEvent: 7 })).toEqual({ ok: false, refusal: 'invalid-input' })
    expect(set(null)).toEqual({ ok: false, refusal: 'invalid-input' })
    expect(set({ state: 'working' })).toEqual({ ok: false, refusal: 'invalid-input' })
    expect(changed).toEqual([])
    expect(hookStatus).toEqual([])
  })
})
