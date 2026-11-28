import { act, cleanup, fireEvent, render, renderHook, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ConversationThread, ThreadEvent, ThreadSnapshot } from '../../shared/types/thread'
import type { Workspace } from '../../shared/types/workspace'
import { ConversationSettings } from '../../src/components/Settings/ConversationSettings'
import { SettingsContent } from '../../src/components/Settings/SettingsModal'
import { ThreadActivityGroup } from '../../src/components/Threads/ThreadActivityGroup'
import { ThreadView } from '../../src/components/Threads/ThreadView'
import { altSendKeyLabel, isAltSendKey } from '../../src/components/Threads/sendKey'
import { resetSideChats, useSideChatStore } from '../../src/components/Threads/side/sideChatStore'
import { useThreadAttention } from '../../src/hooks/useThreadAttention'
import { changeLanguage } from '../../src/i18n'
import { useAccountStore } from '../../src/store/account.store'
import { useActivityStore } from '../../src/store/activity.store'
import {
  APPROVAL_NOTIFY_DEFAULT,
  COMPLETION_NOTIFY_DEFAULT,
  shouldSendDesktopNotification,
  useSettingsStore
} from '../../src/store/settings.store'
import {
  ACTIVE_TURN_SEND_ACTION_DEFAULT,
  AUTO_EXPAND_FAILURES_DEFAULT,
  FOLD_COMPLETED_TURNS_DEFAULT,
  PASTE_AS_ATTACHMENT_DEFAULT,
  THINKING_STYLE_DEFAULT,
  useThreadPrefs
} from '../../src/store/thread-prefs.store'
import { useThreadStore } from '../../src/store/thread.store'
import { useThreadViewModeStore } from '../../src/store/thread-view-mode.store'
import { useWorkspaceStore } from '../../src/store/workspace.store'

vi.mock('../../src/hooks/useGitBranch', () => ({
  useGitBranch: () => ({ branch: 'feat/oxe-479', detached: false, shortSha: 'abc1234', error: null })
}))

const priorOxe = Object.getOwnPropertyDescriptor(window, 'oxe')

const SETTINGS_PROPS = {
  agentProfiles: [],
  agentReadiness: [],
  isDiscoveringAgents: false,
  onClose: vi.fn(),
  onDiscoverAgents: vi.fn(),
  onConfigureAgent: vi.fn(),
  onNewCustomAgent: vi.fn()
}

function resetStores(): void {
  useThreadPrefs.setState({
    sendKey: 'enter',
    thinkingStyle: THINKING_STYLE_DEFAULT,
    foldCompletedTurns: FOLD_COMPLETED_TURNS_DEFAULT,
    autoExpandFailures: AUTO_EXPAND_FAILURES_DEFAULT,
    activeTurnSendAction: ACTIVE_TURN_SEND_ACTION_DEFAULT,
    pasteAsAttachmentThreshold: PASTE_AS_ATTACHMENT_DEFAULT
  })
  useSettingsStore.setState({
    notificationsEnabled: true,
    approvalNotifyMode: APPROVAL_NOTIFY_DEFAULT,
    completionNotifyMode: COMPLETION_NOTIFY_DEFAULT,
    finishSound: false
  })
  useThreadViewModeStore.setState({ mode: 'normal' })
  useActivityStore.getState().reset()
  resetSideChats()
}

interface ViewFixtureOptions {
  status?: ConversationThread['status']
  steeringEnabled?: boolean
  events?: ThreadEvent[]
}

function setupThreadView(options: ViewFixtureOptions = {}) {
  const status = options.status ?? 'running'
  const thread: ConversationThread = {
    id: 'thread-479',
    workspaceId: 'ws-1',
    projectId: 'proj-1',
    rootPath: '/repo',
    provider: 'claude',
    nativeSessionId: 'native-479',
    title: 'Active task',
    pinned: false,
    status,
    createdAt: 100,
    updatedAt: 200,
    access: 'workspace-write',
    mode: 'default',
    capabilities: {
      provider: 'claude',
      features: {
        steering: { enabled: options.steeringEnabled ?? true }
      }
    } as ConversationThread['capabilities']
  }

  const events: ThreadEvent[] = options.events ?? [
    { type: 'message', id: 'u1', role: 'user', text: 'Run the migration' }
  ]
  const snapshot: ThreadSnapshot = {
    thread,
    events,
    turns: [{ id: 'u1', sequence: 1, status: status === 'running' ? 'running' : 'completed', configuration: {} }]
  }

  const send = vi.fn(async () => undefined)
  const sendTyped = vi.fn(async () => undefined)
  const steer = vi.fn(async () => undefined)
  const steerTyped = vi.fn(async () => undefined)
  const sideOpen = vi.fn(async (id: string) => ({
    ok: true as const,
    side: { sideId: 'side-479', threadId: id, provider: 'claude' as const, readOnly: true as const }
  }))
  const sideSend = vi.fn(async () => undefined)
  const sideClose = vi.fn(async () => undefined)

  const api = {
    commands: vi.fn(async () => ({ commands: [] })),
    projects: vi.fn(async () => ({ projects: [], unavailable: [] })),
    list: vi.fn(async () => [thread]),
    create: vi.fn(async () => snapshot),
    read: vi.fn(async () => snapshot),
    models: vi.fn(async () => ({
      defaultModel: 'claude-sonnet',
      models: [{ id: 'claude-sonnet', label: 'Sonnet', description: '', efforts: ['low', 'high'], defaultEffort: 'low' }]
    })),
    configure: vi.fn(async () => snapshot),
    send,
    sendTyped,
    steer,
    steerTyped,
    interrupt: vi.fn(async () => undefined),
    approve: vi.fn(async () => undefined),
    respond: vi.fn(async () => undefined),
    pin: vi.fn(async () => undefined),
    onChanged: vi.fn(() => () => undefined),
    command: vi.fn(async () => ({ kind: 'applied' })),
    turnFiles: vi.fn(async () => []),
    places: vi.fn(async () => ({ places: [], capped: false, refused: 0 })),
    onPlacesChanged: vi.fn(() => () => undefined),
    collisions: vi.fn(async () => []),
    sideOpen,
    sideSend,
    sideClose,
    onSideEvent: vi.fn(() => () => undefined)
  }

  Object.defineProperty(window, 'oxe', {
    configurable: true,
    value: {
      thread: api,
      clipboard: { writeText: vi.fn(async () => true) },
      agentAccount: {
        read: vi.fn(async () => ({
          provider: 'claude',
          scopeId: 'test',
          state: 'connected',
          method: 'subscription',
          checkedAt: 1
        }))
      }
    }
  })

  const workspace = { id: 'ws-1', name: 'Repo', rootPath: '/repo', panes: [] } as unknown as Workspace
  useAccountStore.setState({ scopes: {}, snapshots: {} })
  useWorkspaceStore.setState({ workspaces: [workspace] })
  useThreadStore.setState({
    threads: [thread],
    projects: [{ projectId: 'proj-1', displayName: 'Repo', identityLabel: '/repo', hidden: false, contexts: [{ rootPath: '/repo', label: 'Repo' }] }],
    snapshot,
    selectedId: thread.id,
    secondaryId: null,
    drafts: {},
    attachments: {},
    previewElements: {},
    contextItems: {}
  } as never)

  const view = render(<ThreadView workspace={workspace} />)
  const textarea = screen.getByRole('textbox', { name: 'Message' }) as HTMLTextAreaElement
  return { ...view, textarea, send, sendTyped, steer, steerTyped, sideOpen, sideSend }
}

beforeEach(async () => {
  localStorage.clear()
  resetStores()
  await changeLanguage('en')
})

afterEach(async () => {
  cleanup()
  resetStores()
  if (priorOxe) Object.defineProperty(window, 'oxe', priorOxe)
  else Reflect.deleteProperty(window, 'oxe')
  vi.useRealTimers()
  vi.restoreAllMocks()
  await changeLanguage('en')
})

describe('OXE-479 · Lean OxeChat Preferences & Notification Modes', () => {
  it('renders and persists all lean conversation controls in ConversationSettings', async () => {
    const user = userEvent.setup()
    Object.defineProperty(window, 'oxe', { configurable: true, value: {} })

    render(<ConversationSettings />)

    // 1. Thinking style
    const thinkingGroup = screen.getByRole('radiogroup', { name: 'Thinking style' })
    expect(within(thinkingGroup).getByRole('radio', { name: 'Auto-scroll preview' })).toHaveAttribute('aria-checked', 'true')
    await user.click(within(thinkingGroup).getByRole('radio', { name: 'Expanded' }))
    expect(useThreadPrefs.getState().thinkingStyle).toBe('expanded')

    // 2. Completed intermediate work
    const foldGroup = screen.getByRole('radiogroup', { name: 'Completed intermediate work' })
    expect(within(foldGroup).getByRole('radio', { name: 'Fold completed turns' })).toHaveAttribute('aria-checked', 'true')
    await user.click(within(foldGroup).getByRole('radio', { name: 'Keep expanded' }))
    expect(useThreadPrefs.getState().foldCompletedTurns).toBe(false)

    // 3. Auto-expand failed commands
    const failSwitch = screen.getByRole('switch', { name: 'Auto-expand failed commands' })
    expect(failSwitch).toHaveAttribute('aria-checked', 'true')
    await user.click(failSwitch)
    expect(useThreadPrefs.getState().autoExpandFailures).toBe(false)

    // 4. Action while agent is working
    const activeActionGroup = screen.getByRole('radiogroup', { name: 'Action while agent is working' })
    expect(within(activeActionGroup).getByRole('radio', { name: 'Add to queue' })).toHaveAttribute('aria-checked', 'true')
    await user.click(within(activeActionGroup).getByRole('radio', { name: 'Steer' }))
    expect(useThreadPrefs.getState().activeTurnSendAction).toBe('steer')

    // 5. Paste-as-attachment threshold
    const pasteGroup = screen.getByRole('radiogroup', { name: 'Paste-as-attachment threshold' })
    expect(within(pasteGroup).getByRole('radio', { name: '10,000 chars' })).toHaveAttribute('aria-checked', 'true')
    await user.click(within(pasteGroup).getByRole('radio', { name: '25,000 chars' }))
    expect(useThreadPrefs.getState().pasteAsAttachmentThreshold).toBe(25_000)
    await user.click(within(pasteGroup).getByRole('radio', { name: 'Off' }))
    expect(useThreadPrefs.getState().pasteAsAttachmentThreshold).toBe(0)

    // 6. Send key stays present and persisted
    const sendKeyGroup = screen.getByRole('radiogroup', { name: 'Send message with' })
    expect(within(sendKeyGroup).getByRole('radio', { name: 'Enter' })).toHaveAttribute('aria-checked', 'true')

    // Persisted into localStorage
    const saved = JSON.parse(localStorage.getItem('oxe.thread-appearance') ?? '{}') as { state?: Record<string, unknown> }
    expect(saved.state).toMatchObject({
      thinkingStyle: 'expanded',
      foldCompletedTurns: false,
      autoExpandFailures: false,
      activeTurnSendAction: 'steer',
      pasteAsAttachmentThreshold: 0
    })

    // Re-mounting reads persisted choices cleanly
    cleanup()
    render(<ConversationSettings />)
    expect(within(screen.getByRole('radiogroup', { name: 'Thinking style' })).getByRole('radio', { name: 'Expanded' })).toHaveAttribute('aria-checked', 'true')
    expect(within(screen.getByRole('radiogroup', { name: 'Completed intermediate work' })).getByRole('radio', { name: 'Keep expanded' })).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByRole('switch', { name: 'Auto-expand failed commands' })).toHaveAttribute('aria-checked', 'false')
    expect(within(screen.getByRole('radiogroup', { name: 'Action while agent is working' })).getByRole('radio', { name: 'Steer' })).toHaveAttribute('aria-checked', 'true')
    expect(within(screen.getByRole('radiogroup', { name: 'Paste-as-attachment threshold' })).getByRole('radio', { name: 'Off' })).toHaveAttribute('aria-checked', 'true')
  })

  it('renders separate Approval needed and Turn completed notification modes and applies them in useThreadAttention', async () => {
    const user = userEvent.setup()
    Object.defineProperty(window, 'oxe', { configurable: true, value: {} })

    render(<SettingsContent section="notifications" {...SETTINGS_PROPS} />)

    const approvalGroup = screen.getByRole('radiogroup', { name: 'Approval needed' })
    const completionGroup = screen.getByRole('radiogroup', { name: 'Turn completed' })
    expect(within(approvalGroup).getByRole('radio', { name: 'When unfocused' })).toHaveAttribute('aria-checked', 'true')
    expect(within(completionGroup).getByRole('radio', { name: 'When unfocused' })).toHaveAttribute('aria-checked', 'true')

    await user.click(within(approvalGroup).getByRole('radio', { name: 'Always' }))
    await user.click(within(completionGroup).getByRole('radio', { name: 'Off' }))
    expect(useSettingsStore.getState().approvalNotifyMode).toBe('always')
    expect(useSettingsStore.getState().completionNotifyMode).toBe('off')

    // Helper contract check
    expect(shouldSendDesktopNotification(true, 'always', true)).toBe(true)
    expect(shouldSendDesktopNotification(true, 'unfocused', true)).toBe(false)
    expect(shouldSendDesktopNotification(true, 'unfocused', false)).toBe(true)
    expect(shouldSendDesktopNotification(true, 'off', false)).toBe(false)
    expect(shouldSendDesktopNotification(false, 'always', false)).toBe(false)

    // Hook behavior: even while focused & watching, approvalNotifyMode='always' notifies, while completionNotifyMode='off' stays silent even unfocused.
    cleanup()
    vi.useFakeTimers()
    const notify = vi.fn(async () => true)
    let changed: (() => void) | null = null
    let threads: ConversationThread[] = [
      { id: 't1', workspaceId: 'ws', projectId: 'proj', rootPath: '/repo/app', provider: 'claude', title: 'Deploy', pinned: false, status: 'running', nativeSessionId: null, createdAt: 1, updatedAt: 1 },
      { id: 't2', workspaceId: 'ws', projectId: 'proj', rootPath: '/repo/app', provider: 'claude', title: 'Lint', pinned: false, status: 'running', nativeSessionId: null, createdAt: 1, updatedAt: 1 }
    ]
    Object.defineProperty(window, 'oxe', {
      configurable: true,
      value: {
        notifications: { notify },
        thread: {
          list: vi.fn(async () => threads),
          onChanged: vi.fn((cb: () => void) => { changed = cb; return () => { changed = null } })
        }
      }
    })
    vi.spyOn(document, 'hasFocus').mockReturnValue(true)
    useThreadStore.setState({ selectedId: 't1', secondaryId: null, projects: [], threads: [], unreadIds: [] })

    renderHook(() => useThreadAttention('thread'))
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })

    // t1 asks for approval while watched (mode: always -> notifies), t2 finishes while unwatched (mode: off -> no notify).
    threads = [
      { ...threads[0], status: 'approval' },
      { ...threads[1], status: 'idle', lastTurnStatus: 'completed' }
    ]
    changed?.()
    await act(async () => { await vi.advanceTimersByTimeAsync(350) })

    expect(notify).toHaveBeenCalledTimes(1)
    expect(notify.mock.calls[0][0]).toMatchObject({ title: 'Deploy' })
  })
})

describe('OXE-479 · Configurable Steer / Queue (Enter vs Alt+Enter) & Ask in Side Chat', () => {
  it('recognizes Alt+Enter cleanly and formats platform shortcut labels', () => {
    expect(isAltSendKey({ key: 'Enter', altKey: true })).toBe(true)
    expect(isAltSendKey({ key: 'Enter', altKey: false })).toBe(false)
    expect(isAltSendKey({ key: 'Enter', altKey: true, shiftKey: true })).toBe(false)
    expect(isAltSendKey({ key: 'Enter', altKey: true, ctrlKey: true })).toBe(false)
    expect(isAltSendKey({ key: 'Enter', altKey: true, isComposing: true })).toBe(false)
    expect(altSendKeyLabel(false)).toBe('Alt+Enter')
    expect(altSendKeyLabel(true)).toBe('⌥+Enter')
  })

  it('sends default Queue on Enter and opposite Steer on Alt+Enter while running', async () => {
    useThreadPrefs.setState({ activeTurnSendAction: 'queue', sendKey: 'enter' })
    const { textarea, sendTyped, steerTyped } = setupThreadView({ status: 'running', steeringEnabled: true })

    fireEvent.change(textarea, { target: { value: 'Queue this next' } })
    await act(async () => { fireEvent.keyDown(textarea, { key: 'Enter' }) })
    await waitFor(() => expect(sendTyped).toHaveBeenCalledWith('thread-479', 'Queue this next', []))
    expect(steerTyped).not.toHaveBeenCalled()

    fireEvent.change(textarea, { target: { value: 'Steer immediately' } })
    await act(async () => { fireEvent.keyDown(textarea, { key: 'Enter', altKey: true }) })
    await waitFor(() => expect(steerTyped).toHaveBeenCalledWith('thread-479', 'Steer immediately', []))
  })

  it('sends default Steer on Enter and opposite Queue on Alt+Enter when activeTurnSendAction is steer', async () => {
    useThreadPrefs.setState({ activeTurnSendAction: 'steer', sendKey: 'enter' })
    const { textarea, sendTyped, steerTyped } = setupThreadView({ status: 'running', steeringEnabled: true })

    fireEvent.change(textarea, { target: { value: 'Redirect current step' } })
    await act(async () => { fireEvent.keyDown(textarea, { key: 'Enter' }) })
    await waitFor(() => expect(steerTyped).toHaveBeenCalledWith('thread-479', 'Redirect current step', []))
    expect(sendTyped).not.toHaveBeenCalled()

    fireEvent.change(textarea, { target: { value: 'Wait for next turn' } })
    await act(async () => { fireEvent.keyDown(textarea, { key: 'Enter', altKey: true }) })
    await waitFor(() => expect(sendTyped).toHaveBeenCalledWith('thread-479', 'Wait for next turn', []))
  })

  it('falls back to Queue when provider disables steering even if activeTurnSendAction is steer', async () => {
    useThreadPrefs.setState({ activeTurnSendAction: 'steer', sendKey: 'enter' })
    const { textarea, sendTyped, steerTyped } = setupThreadView({ status: 'running', steeringEnabled: false })

    fireEvent.change(textarea, { target: { value: 'Fallback message' } })
    await act(async () => { fireEvent.keyDown(textarea, { key: 'Enter' }) })
    await waitFor(() => expect(sendTyped).toHaveBeenCalledWith('thread-479', 'Fallback message', []))
    expect(steerTyped).not.toHaveBeenCalled()
  })

  it('offers Queue, Steer (Alt+Enter), and Ask in Side Chat in the active-turn menu and pre-fills Side Chat without sending to main turn', async () => {
    const user = userEvent.setup()
    useThreadPrefs.setState({ activeTurnSendAction: 'queue', sendKey: 'enter' })
    const { textarea, send, sendTyped, steer, steerTyped, sideSend } = setupThreadView({ status: 'running', steeringEnabled: true })

    fireEvent.change(textarea, { target: { value: 'Why is this retry needed?' } })

    const trigger = screen.getByTestId('composer-send-options')
    await user.click(trigger)

    const menu = await screen.findByRole('menu', { name: 'Active turn send options' })
    const menuItems = within(menu).getAllByRole('menuitem').map(el => el.textContent ?? '')
    expect(menuItems.some(text => text.includes('Queue follow-up'))).toBe(true)
    expect(menuItems.some(text => text.includes('Steer active turn'))).toBe(true)
    expect(menuItems.some(text => text.includes('Ask in Side Chat'))).toBe(true)

    await user.click(within(menu).getByRole('menuitem', { name: /Ask in Side Chat/i }))

    // Side chat opens pre-filled with the draft; main composer draft clears; main turn is NEVER polluted.
    const sideInput = await screen.findByTestId('thread-side-chat-input') as HTMLTextAreaElement
    expect(sideInput.value).toBe('Why is this retry needed?')
    expect(textarea.value).toBe('')
    expect(useSideChatStore.getState().shown['thread-479']).toBe(true)
    expect(send).not.toHaveBeenCalled()
    expect(sendTyped).not.toHaveBeenCalled()
    expect(steer).not.toHaveBeenCalled()
    expect(steerTyped).not.toHaveBeenCalled()
    expect(sideSend).not.toHaveBeenCalled()
  })
})

describe('OXE-479 · Timeline Fold & Failed Command Auto-Expand Preferences', () => {
  it('keeps completed turns expanded when foldCompletedTurns is false and folds them when true', () => {
    const completedEvents: ThreadEvent[] = [
      { type: 'message', id: 'u1', role: 'user', text: 'Inspect files' },
      { type: 'tool', id: 't1', name: 'Read', state: 'completed', detail: '{"file_path":"/repo/a.ts"}', startedAt: 100, completedAt: 150 },
      { type: 'tool', id: 't2', name: 'Bash', state: 'completed', detail: '{"command":"npm test"}', output: 'ok', startedAt: 160, completedAt: 220 },
      { type: 'message', id: 'a1', role: 'assistant', text: 'All green.' },
      { type: 'completed', status: 'completed' }
    ]

    // Default (foldCompletedTurns = true): turn folds into one summary button.
    useThreadPrefs.setState({ foldCompletedTurns: true })
    setupThreadView({ status: 'idle', events: completedEvents })
    expect(screen.getByTestId('thread-turn-fold')).toBeInTheDocument()

    // With foldCompletedTurns = false: intermediate tool steps stay expanded with no fold button.
    cleanup()
    useThreadPrefs.setState({ foldCompletedTurns: false })
    setupThreadView({ status: 'idle', events: completedEvents })
    expect(screen.queryByTestId('thread-turn-fold')).toBeNull()
    expect(screen.getByText('npm test')).toBeInTheDocument()
  })

  it('keeps failed shell commands collapsed initially when autoExpandFailures is false and expanded when true', () => {
    const failedTool: Extract<ThreadEvent, { type: 'tool' }> = {
      type: 'tool',
      id: 'run-fail-1',
      name: 'Bash',
      state: 'failed',
      detail: '{"command":"npm run lint"}',
      output: 'Error: lint failed on line 12',
      exitCode: 1,
      startedAt: 10,
      completedAt: 20
    }

    useThreadPrefs.setState({ autoExpandFailures: true })
    const { container, unmount } = render(<ThreadActivityGroup events={[failedTool]} mode="normal" rootPath="/repo" />)
    expect(container.querySelector('[data-ui="step"]')).toHaveAttribute('data-open', 'true')
    expect(screen.getByText(/lint failed on line 12/)).toBeInTheDocument()
    unmount()

    useThreadPrefs.setState({ autoExpandFailures: false })
    const second = render(<ThreadActivityGroup events={[failedTool]} mode="normal" rootPath="/repo" />)
    expect(second.container.querySelector('[data-ui="step"]')).toHaveAttribute('data-open', 'false')
    expect(screen.queryByText(/lint failed on line 12/)).toBeNull()
  })
})
