// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'

const handlers = new Map<string, (event: unknown, value?: unknown) => unknown>()
vi.mock('electron', () => ({
  ipcMain: { handle: (channel: string, handler: (event: unknown, value?: unknown) => unknown) => { handlers.set(channel, handler) } },
  BrowserWindow: { fromWebContents: (sender: { app?: boolean }) => (sender.app ? {} : null) }
}))

const { NotifyGate } = await import('../electron/main/services/approvals/notify-gate')
const { noticeTitle } = await import('../electron/main/services/approvals/drafts')
const { paneInfo, providerName, requesterFor, setRequesterLookup, ownerFromLabel } = await import('../electron/main/services/approvals/requester')
const { registerApprovalsIpc } = await import('../electron/main/ipc/approvals.ipc')
const { englishText } = await import('../electron/main/agent-text')
const { mainMessage } = await import('../shared/messages')
const { NOTIFY_PER_MINUTE } = await import('../shared/types/approvals')
const { IPC_CHANNELS } = await import('../shared/types/ipc')

describe('agent notifications (B10)', () => {
  it('refuse a reserved name in the title or the body, before counting', () => {
    const gate = new NotifyGate(() => 0)
    expect(gate.check('e1', 'OXESpace: security update', '')).toEqual({ code: 'notify.refused.reservedName', params: { name: 'OXESpace' } })
    expect(gate.check('e1', 'Done', 'Approved by ＯｘｅＣｈａｔ')).toEqual({ code: 'notify.refused.reservedName', params: { name: 'OxeChat' } })
    for (let index = 0; index < NOTIFY_PER_MINUTE; index++) expect(gate.check('e1', 'Build done', '')).toBeNull()
  })

  it(`allow ${NOTIFY_PER_MINUTE} a minute per execution, then refuse with the C3 code until the minute passes`, () => {
    let now = 0
    const gate = new NotifyGate(() => now)
    for (let index = 0; index < NOTIFY_PER_MINUTE; index++) expect(gate.check('e1', 'tick', '')).toBeNull()
    expect(gate.check('e1', 'tick', '')).toEqual({ code: 'notify.refused.rateLimit', params: { perMinute: NOTIFY_PER_MINUTE } })
    expect(gate.check('e2', 'tick', '')).toBeNull()
    now = 60_000
    expect(gate.check('e1', 'tick', '')).toBeNull()
  })

  it('get the prefix the app assigns, whatever title the agent sent', () => {
    const pane = requesterFor({ kind: 'pane', id: 'p1' })
    expect(noticeTitle(pane, 'OK')).toMatchObject({ code: 'notify.prefix.pane', params: { title: 'OK' } })
    expect(noticeTitle(requesterFor({ kind: 'thread', id: 'abcdef123' }), 'OK')).toMatchObject({ code: 'notify.prefix.conversation', params: { conversation: 'abcdef', title: 'OK' } })
  })
})

describe('the requester the person sees (B10)', () => {
  const panes = (...ids: Array<[string, number, number, string | null]>) => ids.map(([id, rowIndex, columnIndex, agentProfileId]) => ({ id, rowIndex, columnIndex, agentProfileId }) as never)

  it('is the provider and the pane position, never the pane name', () => {
    const workspaces = [{ panes: panes(['b', 0, 1, 'codex-1'], ['a', 0, 0, 'claude-1'], ['c', 1, 0, null]) }]
    const providerOf = (id: string) => (id.startsWith('codex') ? 'codex' : 'claude')
    expect(paneInfo('a', workspaces, providerOf)).toEqual({ pane: 1, agent: 'Claude' })
    expect(paneInfo('b', workspaces, providerOf)).toEqual({ pane: 2, agent: 'Codex' })
    expect(paneInfo('c', workspaces, providerOf)).toEqual({ pane: 3, agent: undefined })
    expect(providerName('claude-code')).toBe('Claude')
  })

  it('comes from the lookup set at startup, and survives a failing one', () => {
    setRequesterLookup(owner => (owner.id === 'p9' ? { agent: 'Codex', pane: 4 } : undefined))
    expect(requesterFor({ kind: 'pane', id: 'p9' })).toEqual({ kind: 'agent', id: 'pane:p9', label: { code: 'approvals.requester.pane', params: { agent: 'Codex', pane: 4 } } })
    setRequesterLookup(() => { throw new Error('db closed') })
    expect(requesterFor({ kind: 'pane', id: 'p9' }).label).toEqual({ code: 'approvals.requester.pane', params: { agent: 'AI', pane: 0 } })
    setRequesterLookup(undefined)
    expect(ownerFromLabel('thread:t1')).toEqual({ kind: 'thread', id: 't1' })
    expect(ownerFromLabel('agent')).toBeUndefined()
  })
})

describe('the window side of approvals (B10)', () => {
  const center = { list: vi.fn(() => []), history: vi.fn(() => []), respond: vi.fn(() => ({ ok: true })), ack: vi.fn(() => ({ ok: true })), unavailable: vi.fn(() => ({ ok: true })) }
  registerApprovalsIpc(center as never)
  const mainFrame = {}
  const fromApp = { sender: { app: true, mainFrame }, senderFrame: mainFrame }
  const fromSubframe = { sender: { app: true, mainFrame }, senderFrame: {} }
  const fromWebview = { sender: { app: false, mainFrame }, senderFrame: mainFrame }

  it('registers every window → main channel', () => {
    for (const channel of ['list', 'respond', 'ack', 'unavailable', 'history'] as const) expect(handlers.has(IPC_CHANNELS.approvals[channel]), channel).toBe(true)
  })

  it('refuses a subframe or a webview before the center sees the call', () => {
    for (const event of [fromSubframe, fromWebview]) {
      for (const channel of ['respond', 'ack', 'unavailable', 'list'] as const) {
        expect(() => handlers.get(IPC_CHANNELS.approvals[channel])!(event, { id: 'r1', generation: 1, optionId: 'allow-once' }), channel).toThrow(/main frame/)
      }
    }
    expect(center.respond).not.toHaveBeenCalled()
    expect(center.ack).not.toHaveBeenCalled()
  })

  it('passes a well-formed answer through and rejects a malformed one', () => {
    handlers.get(IPC_CHANNELS.approvals.respond)!(fromApp, { id: 'r1', generation: 1, optionId: 'deny' })
    expect(center.respond).toHaveBeenCalledWith({ id: 'r1', generation: 1, optionId: 'deny' })
    expect(() => handlers.get(IPC_CHANNELS.approvals.respond)!(fromApp, { id: 'r1', generation: 0, optionId: 'deny' })).toThrow(/generation/)
    expect(() => handlers.get(IPC_CHANNELS.approvals.ack)!(fromApp, { id: 'r1', generation: 1.5 })).toThrow(/generation/)
  })
})

describe('refusals agents read (B10)', () => {
  it('are the C3 catalog sentence in English', () => {
    expect(englishText(mainMessage('agents.name.reserved', { name: 'OXESpace' }))).toBe('A pane cannot be named after "OXESpace"; that name belongs to the app.')
    expect(englishText(mainMessage('approvals.denied.tooLong', { max: 100_000 }))).toContain('100000 characters')
  })
})
