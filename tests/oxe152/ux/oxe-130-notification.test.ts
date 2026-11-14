// Frozen acceptance test for 1.5.2 OxeChat F2 (OXE program oxespace-152-chat, phase F2, Jira OXE-130).
// Written by the planner; the executor must not edit it.
// Today: an OxeChat conversation notifies "<name> — finished" / "<name> — needs approval" with a fixed body
// (src/hooks/useThreadAttention.ts + src/utils/threadAttention.ts), an OxeCode pane "<agent> — waiting for you" /
// "<agent> — needs your decision" with "<workspace>: …" (src/hooks/useAgentNotifications.ts), and the main process
// always shows the notification with `silent: false` (electron/main/ipc/notifications.ipc.ts).
// Contract:
// - Title: the conversation's name (the pane's name for an OxeCode pane, which has no conversation), at most 80
//   characters (a longer one is cut, an ellipsis allowed within the 80). Nothing else in the title.
// - Body: "Needs you · <place>" or "Finished · <place>" (pt-BR "Precisa de você · <place>" / "Terminou · <place>"):
//   <place> is the conversation's project (OxeChat) or the pane's workspace (OxeCode), by name. No raw codes.
//   Needs you = a conversation waiting on approval (status approval) or a pane blocked on a decision; Finished = a
//   conversation whose turn completed or a pane that finished and waits for a reply. Failed / exited / error notices
//   keep their words.
// - Sound: Settings › Notifications gains "Play a sound when an agent finishes" (pt-BR "Tocar som ao terminar"), a
//   src/ui Switch in a src/ui SettingRow ([data-ui=setting-row]) inside a src/ui SettingsSection
//   ([data-ui=settings-section]) (rebrand BRD-06/OXE-67: Settings 720 px, title 20, nav 28, SettingRow; the measures
//   come from those primitives, tokens in both themes). Off by factory default (RT-1), kept across restarts. A
//   "finished" notification goes out with `silent: true` while it is off and `silent: false` while it is on; a
//   "needs you" one always with `silent: false` (the system sound). The payload carries `silent`
//   (AgentNotificationPayload, shared/types/ipc.ts) and the main process passes it to Electron's Notification;
//   without it, `silent: false`.
// - Focus: with the window focused and the conversation (or pane) on screen, no notification (today's rule, kept).
// - Grouping (finished only): within 10 s, the first 3 finished conversations or panes notify one by one; the ones
//   after them in the same 10 s do not notify one by one: one grouped notification "N agents finished" (pt-BR
//   "N agentes terminaram"), N = how many were held, goes out when those 10 s end. A finish after the window notifies
//   on its own again. "Needs you" is never grouped.
// - Do not disturb: the notification never bypasses the system mode: no `urgency: 'critical'`, no
//   `timeoutType: 'never'`, no `toastXml`; Notification.isSupported() false shows nothing.
// - Clicking a notification still activates that pane or conversation (existing; not re-tested here).
// Runs the real hooks, stores, Settings page, i18n catalogs and the main IPC handler; electron and window.oxe are doubles.
import { createElement } from 'react'
import { act, cleanup, render, renderHook, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ConversationThread } from '../../../shared/types/thread'
import type { Workspace, WorkspacePane } from '../../../shared/types/workspace'
import type { TerminalStateEntry } from '../../../src/store/terminal.store'

const main = vi.hoisted(() => ({
  created: [] as Array<Record<string, unknown>>,
  supported: true,
  handlers: new Map<string, (event: unknown, value: unknown) => unknown>()
}))
vi.mock('electron', () => ({
  ipcMain: { handle: (channel: string, handler: (event: unknown, value: unknown) => unknown) => { main.handlers.set(channel, handler) } },
  BrowserWindow: { getAllWindows: () => [] },
  Notification: class {
    static isSupported(): boolean { return main.supported }
    constructor(options: Record<string, unknown>) { main.created.push(options) }
    on(): void {}
    show(): void {}
  }
}))

const { registerNotificationsIpc } = await import('../../../electron/main/ipc/notifications.ipc')
const { useThreadAttention } = await import('../../../src/hooks/useThreadAttention')
const { useAgentNotifications } = await import('../../../src/hooks/useAgentNotifications')
const { SettingsContent } = await import('../../../src/components/Settings/SettingsModal')
const { useThreadStore } = await import('../../../src/store/thread.store')
const { useWorkspaceStore } = await import('../../../src/store/workspace.store')
const { useTerminalStore } = await import('../../../src/store/terminal.store')
const { useSettingsStore } = await import('../../../src/store/settings.store')
const { useActivityStore } = await import('../../../src/store/activity.store')
const { changeLanguage } = await import('../../../src/i18n')

type Payload = { title: string; body: string; paneId: string; workspaceId: string; silent?: boolean }
const notify = vi.fn(async (_payload: Payload) => true)
const sent = (): Payload[] => notify.mock.calls.map(call => call[0])

// ---- OxeChat conversations (useThreadAttention)
const conversation = (id: string, title: string, over: Partial<ConversationThread> = {}): ConversationThread =>
  ({ id, workspaceId: 'ws', projectId: 'project', rootPath: '/repo/pix-api', provider: 'claude', title, pinned: false, status: 'running', nativeSessionId: null, createdAt: 1, updatedAt: 1, ...over })

let threads: ConversationThread[] = []
let changed: (() => void) | null = null
const flush = async (ms = 0): Promise<void> => { await act(async () => { await vi.advanceTimersByTimeAsync(ms) }) }

async function watchConversations(initial: ConversationThread[], view: 'thread' | 'code' = 'code'): Promise<void> {
  threads = initial
  renderHook(() => useThreadAttention(view))
  await flush()
}
/** Main reports new statuses; the hook reads the list after its settle delay. */
async function update(next: ConversationThread[]): Promise<void> {
  threads = next
  changed?.()
  await flush(300)
}
const finished = (thread: ConversationThread): ConversationThread => ({ ...thread, status: 'idle', lastTurnStatus: 'completed' })

// ---- OxeCode panes (useAgentNotifications)
const pane = (id: string, displayName: string): WorkspacePane => ({ id, workspaceId: 'ws-1', type: 'terminal', rowIndex: 0, columnIndex: 0, status: 'running', agentProfileId: null, agentName: 'Claude', displayName, shellProfileId: 'builtin-claude', rootPath: null, createdAt: null } as WorkspacePane)
const terminalEntry = (over: Partial<TerminalStateEntry> = {}): TerminalStateEntry => ({ status: 'running', error: null, lastActivityAt: null, lastOutput: null, lastIntent: null, lastIntentAt: null, isWorking: false, hasUnread: false, hookState: null, hookAt: null, agentState: null, agentSource: null, location: null, detached: false, ...over } as TerminalStateEntry)
const setPaneState = (id: string, agentState: TerminalStateEntry['agentState']): void => act(() => useTerminalStore.getState().setAgentState(id, agentState, 'hook'))

// ---- Settings › Notifications
const SOUND = { en: /play a sound when an agent finishes/i, 'pt-BR': 'Tocar som ao terminar' } as const
async function soundSwitch(language: 'en' | 'pt-BR' = 'en'): Promise<HTMLElement> {
  render(createElement(SettingsContent, { section: 'notifications', agentProfiles: [], agentReadiness: [], isDiscoveringAgents: false, onClose: vi.fn(), onDiscoverAgents: vi.fn(), onConfigureAgent: vi.fn(), onNewCustomAgent: vi.fn() }))
  return screen.getByRole('switch', { name: SOUND[language] })
}

// Each test starts an hour after the last one, on a clock that only moves forward, so a grouping window a test
// opened is long over in the next one.
let clock = Date.UTC(2026, 10, 14, 9)
beforeEach(async () => {
  clock += 3_600_000
  vi.useFakeTimers({ now: clock })
  notify.mockClear()
  main.created.length = 0
  main.supported = true
  main.handlers.clear()
  changed = null
  Object.defineProperty(window, 'oxe', { configurable: true, value: {
    notifications: { notify },
    thread: { list: vi.fn(async () => threads), onChanged: vi.fn((listener: () => void) => { changed = listener; return () => { changed = null } }) }
  } })
  vi.spyOn(document, 'hasFocus').mockReturnValue(false)
  useActivityStore.getState().reset()
  useSettingsStore.setState({ notificationsEnabled: true })
  useThreadStore.setState({ threads: [], projects: [{ projectId: 'project', displayName: 'pix-api', identityLabel: '/repo/pix-api', hidden: false, contexts: [{ rootPath: '/repo/pix-api', label: 'pix-api' }] }], selectedId: null, secondaryId: null, unreadIds: [] })
  useWorkspaceStore.setState({ workspaces: [
    { id: 'ws', name: 'pix-api', rootPath: '/repo/pix-api', panes: [] },
    { id: 'ws-1', name: 'demo', rootPath: 'C:/dev/demo', defaultShellProfileId: 'builtin-claude', panes: [pane('p1', 'api-server')] }
  ] as unknown as Workspace[], shellProfiles: [] })
  useTerminalStore.setState({ panes: { p1: terminalEntry({ agentState: 'working' }) }, activePaneId: null })
  await changeLanguage('en')
})
afterEach(async () => {
  cleanup()
  // A held group goes out before the clock is put back, so nothing of this test is pending in the next.
  await vi.advanceTimersByTimeAsync(60_000)
  vi.useRealTimers()
  vi.restoreAllMocks()
  await changeLanguage('en')
})

describe('OXE-130 · a notification names the conversation and where it is, with an optional sound', () => {
  it('CA-1 · título da notificação', async () => {
    const long = 'Refactor the payment reconciliation job so that retries never double charge a customer twice in a row'
    expect(long.length).toBeGreaterThan(80)
    await watchConversations([conversation('a', 'Auth investigation'), conversation('b', long)])
    await update([finished(conversation('a', 'Auth investigation')), finished(conversation('b', long))])
    const [short, cut] = sent()
    expect(short.title).toBe('Auth investigation')
    expect([...cut.title].length).toBeLessThanOrEqual(80)
    const kept = cut.title.replace(/…$/, '')
    expect(long.startsWith(kept), 'the title is the start of the name').toBe(true)
    expect([...kept].length).toBeGreaterThanOrEqual(79)

    // An OxeCode pane has no conversation: the pane's name.
    notify.mockClear()
    renderHook(() => useAgentNotifications())
    act(() => { vi.advanceTimersByTime(1500) })
    setPaneState('p1', 'blocked')
    act(() => { vi.advanceTimersByTime(1500) })
    expect(sent().map(payload => payload.title)).toEqual(['api-server'])
  })

  it('CA-2 · corpo com estado e lugar', async () => {
    await watchConversations([conversation('a', 'Auth investigation'), conversation('b', 'Billing')])
    await update([finished(conversation('a', 'Auth investigation')), conversation('b', 'Billing', { status: 'approval' })])
    expect(sent().map(({ title, body }) => ({ title, body }))).toEqual([
      { title: 'Auth investigation', body: 'Finished · pix-api' },
      { title: 'Billing', body: 'Needs you · pix-api' }
    ])
    cleanup(); notify.mockClear()

    await changeLanguage('pt-BR')
    await watchConversations([conversation('c', 'Cobrança'), conversation('d', 'Deploy')])
    await update([finished(conversation('c', 'Cobrança')), conversation('d', 'Deploy', { status: 'approval' })])
    expect(sent().map(payload => payload.body)).toEqual(['Terminou · pix-api', 'Precisa de você · pix-api'])
    cleanup(); notify.mockClear()
    await changeLanguage('en')

    // An OxeCode pane: blocked on a decision, then finished and waiting (away, after its 10 s stability gate).
    renderHook(() => useAgentNotifications())
    act(() => { vi.advanceTimersByTime(1500) })
    setPaneState('p1', 'blocked')
    act(() => { vi.advanceTimersByTime(1500) })
    setPaneState('p1', 'done')
    act(() => { vi.advanceTimersByTime(13_500) })
    expect(sent().map(({ title, body }) => ({ title, body }))).toEqual([
      { title: 'api-server', body: 'Needs you · demo' },
      { title: 'api-server', body: 'Finished · demo' }
    ])
  })

  it('CA-3 · som opcional ao terminar', async () => {
    // The option: off by default, a Switch in a SettingRow inside a SettingsSection, in both languages.
    let toggle = await soundSwitch()
    expect(toggle).toHaveAttribute('aria-checked', 'false')
    const row = toggle.closest('[data-ui="setting-row"]')
    expect(row, 'the switch is a SettingRow').not.toBeNull()
    expect(row!.closest('[data-ui="settings-section"]'), 'inside a SettingsSection').not.toBeNull()
    cleanup()
    await changeLanguage('pt-BR')
    expect(await soundSwitch('pt-BR')).toHaveAttribute('aria-checked', 'false')
    cleanup()
    await changeLanguage('en')

    // Off: "finished" is silent, "needs you" keeps the system sound.
    await watchConversations([conversation('a', 'Auth investigation'), conversation('b', 'Billing')])
    await update([finished(conversation('a', 'Auth investigation')), conversation('b', 'Billing', { status: 'approval' })])
    expect(sent().map(({ title, silent }) => ({ title, silent }))).toEqual([
      { title: 'Auth investigation', silent: true },
      { title: 'Billing', silent: false }
    ])
    cleanup(); notify.mockClear()

    // On: "finished" plays the sound.
    toggle = await soundSwitch()
    await userEvent.setup({ advanceTimers: vi.advanceTimersByTime }).click(toggle)
    expect(toggle).toHaveAttribute('aria-checked', 'true')
    cleanup()
    await watchConversations([conversation('c', 'Checkout')])
    await update([finished(conversation('c', 'Checkout'))])
    expect(sent().map(({ title, silent }) => ({ title, silent }))).toEqual([{ title: 'Checkout', silent: false }])
    cleanup()
    toggle = await soundSwitch()
    await userEvent.setup({ advanceTimers: vi.advanceTimersByTime }).click(toggle)
    expect(toggle).toHaveAttribute('aria-checked', 'false')
    cleanup()

    // The main process shows what the payload asks for; without `silent`, the system sound.
    registerNotificationsIpc()
    const handle = main.handlers.get('notifications:notify')!
    const payload = { title: 'Auth investigation', body: 'Finished · pix-api', paneId: 'thread:a', workspaceId: 'ws' }
    await handle({}, { ...payload, silent: true })
    await handle({}, { ...payload, silent: false })
    await handle({}, payload)
    expect(main.created.map(options => options.silent)).toEqual([true, false, false])
    expect(main.created[0]).toMatchObject({ title: 'Auth investigation', body: 'Finished · pix-api' })
  })

  it('CA-4 · sem notificação com foco', async () => {
    vi.mocked(document.hasFocus).mockReturnValue(true)
    useThreadStore.setState({ selectedId: 'a' })
    await watchConversations([conversation('a', 'Auth investigation')], 'thread')
    await update([finished(conversation('a', 'Auth investigation'))])
    useTerminalStore.setState({ activePaneId: 'p1' })
    renderHook(() => useAgentNotifications())
    act(() => { vi.advanceTimersByTime(1500) })
    setPaneState('p1', 'done')
    act(() => { vi.advanceTimersByTime(13_500) })
    expect(notify).not.toHaveBeenCalled()
  })

  it('CA-5 · agrupamento acima de 3 em 10 s', async () => {
    const names = ['Alpha', 'Bravo', 'Charlie', 'Delta', 'Echo']
    await watchConversations(names.map((name, index) => conversation(`t${index}`, name)))
    await update(names.map((name, index) => finished(conversation(`t${index}`, name))))
    await flush(10_000)
    const titles = sent().map(payload => payload.title)
    expect(titles).toHaveLength(4)
    expect(titles.slice(0, 3).every(title => names.includes(title)), 'the first three one by one').toBe(true)
    expect(titles[3]).toBe('2 agents finished')
    expect(sent()[3].body).not.toMatch(/\{\{|notify\.|thread\.|\bcode\./)
    expect(sent()[3].silent, 'the sound option holds for the grouped one too').toBe(true)

    // A finish after the window notifies on its own; up to three in a window never group.
    notify.mockClear()
    await update([...names.map((name, index) => finished(conversation(`t${index}`, name))), conversation('t5', 'Foxtrot')])
    await update([...names.map((name, index) => finished(conversation(`t${index}`, name))), finished(conversation('t5', 'Foxtrot'))])
    await flush(10_000)
    expect(sent().map(payload => payload.title)).toEqual(['Foxtrot'])

    // "Needs you" is never grouped.
    notify.mockClear()
    const asking = ['Golf', 'Hotel', 'India', 'Juliet', 'Kilo']
    await update([...asking.map((name, index) => conversation(`n${index}`, name))])
    await update([...asking.map((name, index) => conversation(`n${index}`, name, { status: 'approval' }))])
    await flush(10_000)
    expect(sent().map(payload => payload.title)).toEqual(asking)
  })

  it('CA-6 · respeita o não perturbe', async () => {
    registerNotificationsIpc()
    const handle = main.handlers.get('notifications:notify')!
    const payload = { title: 'Auth investigation', body: 'Needs you · pix-api', paneId: 'thread:a', workspaceId: 'ws' }
    await handle({}, { ...payload, silent: false })
    expect(main.created).toHaveLength(1)
    expect(main.created[0].urgency).not.toBe('critical')
    expect(main.created[0].timeoutType).not.toBe('never')
    expect(main.created[0].toastXml).toBeUndefined()
    main.supported = false
    expect(await handle({}, payload)).toBe(false)
    expect(main.created).toHaveLength(1)
  })
})
