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
    expect(noticeTitle(pane, 'OK')).toEqual({ code: 'notify.prefix.unknownPane', params: { pane: 0, title: 'OK' } })
    expect(noticeTitle(requesterFor({ kind: 'thread', id: 'abcdef123' }), 'OK')).toEqual({ code: 'notify.prefix.unknownConversation', params: { conversation: 'abcdef', title: 'OK' } })
    const known = { kind: 'agent' as const, id: 'pane:p1', label: mainMessage('approvals.requester.pane', { agent: 'Claude', pane: 2 }) }
    expect(noticeTitle(known, 'OK')).toEqual({ code: 'notify.prefix.pane', params: { agent: 'Claude', pane: 2, title: 'OK' } })
  })
})

describe('the requester the person sees (B10)', () => {
  it('says "Unknown agent" with the pane position when the provider is not known, never a provider name', () => {
    setRequesterLookup(owner => (owner.id === 'p3' ? { pane: 3 } : undefined))
    expect(requesterFor({ kind: 'pane', id: 'p3' }).label).toEqual({ code: 'approvals.requester.unknownPane', params: { pane: 3 } })
    expect(requesterFor({ kind: 'thread', id: 'thread-xyz' }).label).toEqual({ code: 'approvals.requester.unknownConversation', params: { conversation: 'thread' } })
    expect(englishText(mainMessage('approvals.requester.unknownPane', { pane: 3 }))).toBe('Unknown agent · pane 3')
    setRequesterLookup(undefined)
  })

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
    expect(requesterFor({ kind: 'pane', id: 'p9' }).label).toEqual({ code: 'approvals.requester.unknownPane', params: { pane: 0 } })
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

describe('a full approval queue (B10)', () => {
  it('tells the agent the specific reason, so it can back off and retry, and is not remembered as a denial', async () => {
    const { ApprovalCenter } = await import('../electron/main/services/approvals/approval-center')
    const { previewDraft } = await import('../electron/main/services/approvals/drafts')
    const { centerApprovalPrompter } = await import('../electron/main/services/agent-actions/approval-prompter')
    const { ApprovalBroker } = await import('../electron/main/services/agent-actions/approval-broker')
    const { AgentActions } = await import('../electron/main/services/agent-actions/agent-actions')
    const sent: unknown[] = []
    const center = new ApprovalCenter({ send: (_channel, payload) => { sent.push(payload) }, hasWindow: () => true, native: async () => null, queueMax: 1 })
    void center.ask(previewDraft({ requester: requesterFor({ kind: 'pane', id: 'p2' }), action: 'click', page: 'http://localhost/', text: '#a' }))
    const actions = new AgentActions({ broker: new ApprovalBroker(centerApprovalPrompter(center), Date.now, 5_000) })
    const push = () => actions.run({ key: 'e-queue', label: 'pane:p1', workspaceId: 'w', authenticated: true }, { tool: 'oxespace_git_change', action: 'push', level: 'confirm', target: '/repo', text: 'git push' }, async () => 'pushed')
    await expect(push()).rejects.toMatchObject({ code: 'queue-full', message: 'Too many requests are waiting (1), so this one was denied without being shown.' })
    // Once the queue drains, the same call is asked again rather than refused from a remembered denial.
    const [waiting] = center.list()
    center.respond({ id: waiting.id, generation: 1, optionId: 'deny' })
    const retried = push()
    await vi.waitFor(() => expect(center.list()).toHaveLength(1))
    center.ack({ id: center.list()[0].id, generation: 1, visible: true, focused: true })
    center.respond({ id: center.list()[0].id, generation: 1, optionId: 'allow-once' })
    await expect(retried).resolves.toBe('pushed')
  })
})

describe('attention when a request waits (B10 R3)', () => {
  it('flashes an unfocused window and notifies with the fixed app text only', async () => {
    const { askForAttention } = await import('../electron/main/services/approvals/attention')
    const window = { isFocused: vi.fn(() => false), flashFrame: vi.fn() }
    const show = vi.fn()
    expect(askForAttention([window], { supported: () => true, show, title: async () => 'OXESpace: approval waiting' })).toBe(true)
    expect(window.flashFrame).toHaveBeenCalledWith(true)
    await vi.waitFor(() => expect(show).toHaveBeenCalledWith('OXESpace: approval waiting'))
    expect(show).toHaveBeenCalledTimes(1)
  })

  it('does nothing when a window is focused, and never notifies without support', async () => {
    const { askForAttention } = await import('../electron/main/services/approvals/attention')
    const show = vi.fn()
    const notifier = (supported: boolean) => ({ supported: () => supported, show, title: async () => 'OXESpace: approval waiting' })
    const focused = { isFocused: () => true, flashFrame: vi.fn() }
    expect(askForAttention([focused], notifier(true))).toBe(false)
    expect(focused.flashFrame).not.toHaveBeenCalled()
    const away = { isFocused: () => false, flashFrame: vi.fn() }
    expect(askForAttention([away], notifier(false))).toBe(true)
    expect(away.flashFrame).toHaveBeenCalledWith(true)
    expect(askForAttention([], notifier(true))).toBe(false)
    expect(show).not.toHaveBeenCalled()
  })

  it('has en and pt-BR text that names no requester', () => {
    expect(englishText(mainMessage('approvals.notify.waiting', {}))).toBe('OXESpace: approval waiting')
  })
})

describe('stopping the attention signal (B10 S4)', () => {
  it('stops flashing when the window gains focus, and on endAttention', async () => {
    const { askForAttention, endAttention } = await import('../electron/main/services/approvals/attention')
    let onFocus: (() => void) | undefined
    const window = { isFocused: () => false, flashFrame: vi.fn(), once: vi.fn((_event: 'focus', listener: () => void) => { onFocus = listener }) }
    askForAttention([window], { supported: () => false, show: vi.fn(), title: async () => '' })
    expect(window.flashFrame).toHaveBeenLastCalledWith(true)
    expect(window.once).toHaveBeenCalledWith('focus', expect.any(Function))
    onFocus!()
    expect(window.flashFrame).toHaveBeenLastCalledWith(false)
    const other = { isFocused: () => true, flashFrame: vi.fn() }
    endAttention([other])
    expect(other.flashFrame).toHaveBeenCalledWith(false)
  })
})

describe('refusals agents read (B10)', () => {
  it('are the C3 catalog sentence in English', () => {
    expect(englishText(mainMessage('agents.name.reserved', { name: 'OXESpace' }))).toBe('A pane cannot be named after "OXESpace"; that name belongs to the app.')
    expect(englishText(mainMessage('approvals.denied.tooLong', { max: 100_000 }))).toContain('100000 characters')
  })
})
