// @vitest-environment node
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * B10 · Main-process routing of approvals: with a live app window, no door opens `dialog.showMessageBox`; the stub
 * throws, so any native dialog fails the test. With no window (or on the window's report), the native fallback asks.
 */
const showMessageBox = vi.fn(async (..._args: unknown[]): Promise<{ response: number }> => { throw new Error('a native dialog opened while the app window exists') })
const send = vi.fn()
const windows: unknown[] = []
const appWindow = { isDestroyed: () => false, isFocused: () => true, flashFrame: vi.fn(), webContents: { isDestroyed: () => false, isCrashed: () => false, send } }
vi.mock('electron', () => ({
  app: { isReady: () => true, getLocale: () => 'en', isPackaged: false, getAppPath: () => '.' },
  BrowserWindow: { getAllWindows: () => windows, getFocusedWindow: () => null },
  dialog: { showMessageBox: (...args: unknown[]) => showMessageBox(...args) },
  nativeImage: { createFromPath: () => ({ isEmpty: () => true }) }
}))
vi.mock('electron-log/main.js', () => ({ default: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } }))

process.env.OXESPACE_LOCALE = 'en'
const { IPC_CHANNELS } = await import('../../shared/types/ipc')
const { approvalCenter } = await import('../../electron/main/services/approvals')
const { appApprovalPrompter } = await import('../../electron/main/services/agent-actions/approval-prompter')
const { ApprovalBroker } = await import('../../electron/main/services/agent-actions/approval-broker')
const { AgentActions } = await import('../../electron/main/services/agent-actions/agent-actions')
const { AgentGateway } = await import('../../electron/main/services/oxequery/agent-gateway')
const { crashDraft, previewDraft } = await import('../../electron/main/services/approvals/drafts')
const { requesterFor } = await import('../../electron/main/services/approvals/requester')
type Request = import('../../shared/types/approvals').ApprovalRequest

const requested = (): Request[] => send.mock.calls.filter(([channel]) => channel === IPC_CHANNELS.approvals.onRequested).map(([, payload]) => payload as Request)
const latest = async (): Promise<Request> => {
  await vi.waitFor(() => expect(requested().length).toBeGreaterThan(0))
  return requested().at(-1)!
}
const answer = async (optionId: string) => {
  const request = await latest()
  approvalCenter.ack({ id: request.id, generation: request.generation, visible: true, focused: true })
  expect(approvalCenter.respond({ id: request.id, generation: request.generation, optionId })).toMatchObject({ ok: true })
}

function agentAction(key: string) {
  const actions = new AgentActions({ broker: new ApprovalBroker(appApprovalPrompter, Date.now, 5_000) })
  return actions.run({ key, label: 'pane:p1', workspaceId: 'w1', authenticated: true }, { tool: 'oxespace_git_change', action: 'push', level: 'confirm', target: '/repo', text: 'git push origin feat/x' }, async () => 'pushed')
}

function oxeQuery(key: string) {
  const gateway = new AgentGateway({
    list: () => [{ id: 'c1', name: 'shop', engine: 'postgres', environment: 'dev', readOnly: false, agentAccess: 'read' } as never],
    resolve: id => ({ id, engine: 'postgres', host: 'h', port: 1, database: 'd', username: 'u', password: 'p', sslMode: 'disable', readOnly: true }) as never,
    call: async () => ({ columns: [{ name: 'id' }], rows: [[1]], truncated: false, durationMs: 1 }) as never,
    containers: { list: async () => ({ containers: [] }), logsTail: async () => '', action: async () => undefined },
    broker: new ApprovalBroker(appApprovalPrompter, Date.now, 5_000),
    audit: { record: vi.fn(), list: () => [] } as never
  })
  return gateway.handle('oxespace_db_query', { connection: 'shop', sql: 'SELECT 1' }, { key, label: 'thread:t1' })
}

let run = 0
beforeEach(() => {
  run++
  windows.splice(0, windows.length, appWindow)
  send.mockClear()
  showMessageBox.mockReset()
  showMessageBox.mockImplementation(async () => { throw new Error('a native dialog opened while the app window exists') })
})
afterEach(() => { vi.useRealTimers() })

describe('B10 · no native dialog while an app window exists', () => {
  it('ApprovalBroker for an agent action asks in the window', async () => {
    const result = agentAction(`action-${run}`)
    await answer('allow-once')
    await expect(result).resolves.toBe('pushed')
    expect((await latest())).toMatchObject({ kind: 'mcp-confirm', summary: { code: 'approvals.summary.mcpConfirm', params: { tool: 'oxespace_git_change', action: 'push', target: '/repo' } } })
    expect(showMessageBox).not.toHaveBeenCalled()
  })

  it('ApprovalBroker for OxeQuery asks in the window', async () => {
    const result = oxeQuery(`oxequery-${run}`)
    await answer('allow-once')
    await expect(result).resolves.toMatchObject({ untrusted: true, rows: [[1]] })
    expect(await latest()).toMatchObject({ kind: 'oxequery', risk: 'low', environment: { kind: 'dev', production: false } })
    expect(showMessageBox).not.toHaveBeenCalled()
  })

  it.each(['closeTab', 'click', 'fill', 'navigate', 'scroll'])('preview automation (%s) asks in the window', async action => {
    const outcome = approvalCenter.ask(previewDraft({ requester: requesterFor({ kind: 'pane', id: 'p1' }), action, page: 'http://localhost:5173/', text: '#buy' }))
    await answer('deny')
    await expect(outcome).resolves.toMatchObject({ intent: 'deny', by: 'user' })
    expect(await latest()).toMatchObject({ kind: 'preview-automation', target: 'http://localhost:5173/' })
    expect(showMessageBox).not.toHaveBeenCalled()
  })

  it('preview automation reaches the person only through the approval center', () => {
    const source = readFileSync('electron/main/services/documentation/preview-automation.ts', 'utf8')
    expect(source).not.toMatch(/showMessageBox/)
    expect(source.match(/approvalCenter\.ask\(previewDraft\(/g)).toHaveLength(2)
  })

  it('the crash offer stays in the window when it is acknowledged within 3 s', async () => {
    vi.useFakeTimers()
    const outcome = approvalCenter.ask(crashDraft())
    const [request] = requested()
    expect(request).toMatchObject({ kind: 'crash', ackRequired: true })
    approvalCenter.ack({ id: request.id, generation: 1, visible: true, focused: true })
    vi.advanceTimersByTime(5_000)
    expect(showMessageBox).not.toHaveBeenCalled()
    approvalCenter.respond({ id: request.id, generation: 1, optionId: 'keep-working' })
    await expect(outcome).resolves.toMatchObject({ intent: 'deny', by: 'user' })
  })
})

describe('B10 · the native dialog as the fallback', () => {
  const nativeAnswers = (response: number) => showMessageBox.mockImplementation(async () => ({ response }))

  it('asks natively, exactly once, for each path when every window is gone', async () => {
    windows.splice(0)
    nativeAnswers(1)
    await expect(agentAction(`gone-action-${run}`)).resolves.toBe('pushed')
    await expect(oxeQuery(`gone-oxequery-${run}`)).resolves.toMatchObject({ untrusted: true })
    await expect(approvalCenter.ask(previewDraft({ requester: requesterFor({ kind: 'pane', id: 'p1' }), action: 'click', page: 'http://localhost/', text: '#a' }))).resolves.toMatchObject({ intent: 'allow', by: 'native' })
    expect(showMessageBox).toHaveBeenCalledTimes(3)
    expect(requested()).toHaveLength(0)
  })

  it('moves a crash offer the window never acknowledges to the native dialog after 3,000 ms', async () => {
    vi.useFakeTimers()
    nativeAnswers(0)
    const outcome = approvalCenter.ask(crashDraft())
    await vi.advanceTimersByTimeAsync(2_999)
    expect(showMessageBox).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    await vi.waitFor(() => expect(showMessageBox).toHaveBeenCalledTimes(1))
    await expect(outcome).resolves.toMatchObject({ intent: 'deny', optionId: 'keep-working', by: 'native' })
  })

  it('asks natively once for the request the window reports unavailable, with the same answer rules', async () => {
    nativeAnswers(0)
    const first = approvalCenter.ask(previewDraft({ requester: requesterFor({ kind: 'pane', id: 'p1' }), action: 'click', page: 'http://localhost/', text: '#a' }))
    const second = approvalCenter.ask(previewDraft({ requester: requesterFor({ kind: 'pane', id: 'p1' }), action: 'scroll', page: 'http://localhost/', text: '#b' }))
    const [one, two] = requested()
    expect(approvalCenter.unavailable({ id: one.id, generation: 1 })).toMatchObject({ ok: true })
    expect(approvalCenter.unavailable({ id: one.id, generation: 1 })).toMatchObject({ ok: false, refusal: 'alreadyReported' })
    expect(approvalCenter.unavailable({ id: two.id, generation: 2 })).toMatchObject({ ok: false, refusal: 'staleGeneration' })
    await expect(first).resolves.toMatchObject({ intent: 'deny', by: 'native' })
    expect(showMessageBox).toHaveBeenCalledTimes(1)
    expect(approvalCenter.respond({ id: one.id, generation: 1, optionId: 'allow-once' })).toMatchObject({ ok: false, refusal: 'alreadyAnswered' })
    expect(approvalCenter.list().map(item => item.id)).toContain(two.id)
    approvalCenter.respond({ id: two.id, generation: 1, optionId: 'deny' })
    await expect(second).resolves.toMatchObject({ by: 'user' })
  })
})

describe('B10 · where the main process may still open a native dialog', () => {
  const files = (dir: string): string[] => readdirSync(dir).flatMap(name => {
    const path = join(dir, name)
    return statSync(path).isDirectory() ? (name === 'vendor' ? [] : files(path)) : path.endsWith('.ts') ? [path] : []
  })

  it('only the approval fallback and the renderer-gone notice call showMessageBox', () => {
    const callers = files('electron/main').filter(path => /showMessageBox\(/.test(readFileSync(path, 'utf8'))).map(path => path.replace(/\\/g, '/')).sort()
    expect(callers).toEqual(['electron/main/index.ts', 'electron/main/services/approvals/native-approval.ts'])
    // index.ts keeps one: the renderer is gone, so there is no modal to use.
    expect(readFileSync('electron/main/index.ts', 'utf8').match(/showMessageBox\(/g)).toHaveLength(1)
  })
})
