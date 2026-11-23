import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ConversationThread, ThreadEvent, ThreadSnapshot } from '../../../shared/types/thread'
import type { SessionSummary } from '../../../shared/types/session'
import { ThreadActivityGroup } from '../../../src/components/Threads/ThreadActivityGroup'
import ThreadCommandDialog from '../../../src/components/Threads/ThreadCommandDialog'
import { ThreadMessageRow } from '../../../src/components/Threads/ThreadMessageRow'
import { useThreadStore } from '../../../src/store/thread.store'
import { changeLanguage, i18n } from '../../../src/i18n'

type ToolEvent = Extract<ThreadEvent, { type: 'tool' }>
type MessageEvent = Extract<ThreadEvent, { type: 'message' }>

const tt = (key: string, options: Record<string, unknown> = {}): string => i18n.t(key, { ns: 'thread', ...options }) as string

const makeThread = (overrides: Partial<ConversationThread> = {}): ConversationThread => ({
  id: 't-current',
  workspaceId: 'ws-1',
  projectId: 'proj-1',
  rootPath: '/repo',
  provider: 'claude',
  title: 'Current conversation',
  pinned: false,
  status: 'idle',
  nativeSessionId: 'native-current',
  createdAt: 1,
  updatedAt: 1,
  ...overrides
}) as ConversationThread

const makeSession = (n: number, preview: string): SessionSummary => ({
  sessionId: `0000000${n}-0000-4000-8000-00000000000${n}`,
  provider: 'claude',
  modelId: 'sonnet',
  requestCount: 2,
  lastUpdatedMs: 1_700_000_000_000 + n,
  sessionStartedAtMs: 1_700_000_000_000,
  totalTokens: 100,
  estimatedCostUsd: 0.01,
  filePath: null,
  isFork: false,
  firstMessagePreview: preview
}) as SessionSummary

beforeEach(() => {
  useThreadStore.setState({ threads: [] } as never)
})

afterEach(async () => {
  cleanup()
  vi.restoreAllMocks()
  await changeLanguage('en')
})

describe('OXE-403 · ThreadActivityGroup normal mode clickable ToolRowView (OXE-375)', () => {
  it('toggles inline diagnostic output when clicking a succeeded tool row in normal mode', async () => {
    const user = userEvent.setup()
    const toolEvent: ToolEvent = {
      type: 'tool',
      id: 'tool-1',
      name: 'Bash',
      state: 'completed',
      detail: 'npm test',
      output: 'All 42 specs passed',
      exitCode: 0,
      startedAt: 1000,
      completedAt: 1450
    }
    const { container } = render(<ThreadActivityGroup events={[toolEvent]} mode="normal" rootPath="/repo" />)

    // Open the summary fold
    const details = container.querySelector('details.thread-activity-group') as HTMLDetailsElement
    details.open = true

    const rowButton = screen.getByRole('button', { name: /npm test/i })
    expect(rowButton).toHaveAttribute('aria-expanded', 'false')
    expect(container.querySelector('.thread-tool-diagnostic')).toBeNull()

    await user.click(rowButton)
    expect(rowButton).toHaveAttribute('aria-expanded', 'true')
    const diagnostic = container.querySelector('.thread-tool-diagnostic')
    expect(diagnostic).not.toBeNull()
    expect(diagnostic?.textContent).toContain('All 42 specs passed')

    await user.click(rowButton)
    expect(rowButton).toHaveAttribute('aria-expanded', 'false')
    expect(container.querySelector('.thread-tool-diagnostic')).toBeNull()
  })
})

describe('OXE-403 · ThreadMessageRow inline prompt editor keyboard shortcuts', () => {
  function setupMessageRow(editPrompt: ReturnType<typeof vi.fn>) {
    const userMsg: MessageEvent = { type: 'message', id: 'u1', role: 'user', text: 'Original prompt text' }
    const assistantMsg: MessageEvent = { type: 'message', id: 'a1', role: 'assistant', text: 'Answer' }
    const doneEvent: ThreadEvent = { type: 'completed', status: 'completed' }
    const thread = makeThread({ id: 'thread-1' })
    const snapshot: ThreadSnapshot = {
      thread,
      events: [userMsg, assistantMsg, doneEvent],
      turns: [{ id: 'u1', sequence: 1, status: 'completed', configuration: {} }]
    } as unknown as ThreadSnapshot
    Object.defineProperty(window, 'oxe', {
      configurable: true,
      value: { thread: { editPrompt } }
    })
    render(
      <ThreadMessageRow
        event={userMsg}
        turnId="u1"
        turnEvents={[userMsg, assistantMsg, doneEvent]}
        snapshot={snapshot}
        running={false}
        pending={false}
        copied={false}
        quickReplies={[]}
        action={async run => { await run() }}
        onCopy={vi.fn()}
        onQuickReply={vi.fn()}
        onQuote={vi.fn()}
      />
    )
  }

  it('cancels editing cleanly on Escape without calling editPrompt', async () => {
    const user = userEvent.setup()
    const editPrompt = vi.fn(async () => undefined)
    setupMessageRow(editPrompt)

    await user.click(screen.getByRole('button', { name: tt('message.editPrompt') }))
    const box = screen.getByRole('textbox', { name: tt('message.editPrompt') })
    expect(box).toHaveValue('Original prompt text')

    fireEvent.keyDown(box, { key: 'Escape' })
    expect(screen.queryByRole('textbox', { name: tt('message.editPrompt') })).toBeNull()
    expect(editPrompt).not.toHaveBeenCalled()
  })

  it('submits the edited prompt on Ctrl+Enter and Cmd+Enter', async () => {
    const user = userEvent.setup()
    const editPrompt = vi.fn(async () => undefined)
    setupMessageRow(editPrompt)

    await user.click(screen.getByRole('button', { name: tt('message.editPrompt') }))
    const box = screen.getByRole('textbox', { name: tt('message.editPrompt') })
    await user.clear(box)
    await user.type(box, 'Updated via Ctrl+Enter')

    fireEvent.keyDown(box, { key: 'Enter', ctrlKey: true })
    await waitFor(() => expect(editPrompt).toHaveBeenCalledWith('thread-1', 'u1', 'Updated via Ctrl+Enter', { restoreFiles: false }))
    await waitFor(() => expect(screen.queryByRole('textbox', { name: tt('message.editPrompt') })).toBeNull())

    // Also verify Cmd+Enter (metaKey)
    await user.click(screen.getByRole('button', { name: tt('message.editPrompt') }))
    const box2 = screen.getByRole('textbox', { name: tt('message.editPrompt') })
    await user.clear(box2)
    await user.type(box2, 'Updated via Cmd+Enter')
    fireEvent.keyDown(box2, { key: 'Enter', metaKey: true })
    await waitFor(() => expect(editPrompt).toHaveBeenCalledWith('thread-1', 'u1', 'Updated via Cmd+Enter', { restoreFiles: false }))
  })
})

describe('OXE-403 · ThreadCommandDialog /resume reactivity and section counts', () => {
  it('displays section counts and reacts to useThreadStore thread updates', () => {
    const current = makeThread({ id: 't-current', title: 'Current' })
    const saved1 = makeThread({ id: 't-saved-1', title: 'Saved Alpha' })
    const saved2 = makeThread({ id: 't-saved-2', title: 'Saved Beta' })
    useThreadStore.setState({ threads: [current, saved1] } as never)

    const snapshot = { thread: current, events: [] } as unknown as ThreadSnapshot
    render(
      <ThreadCommandDialog
        panel={{
          kind: 'panel',
          surface: 'sessions',
          title: 'Resume',
          resume: {
            tasks: [],
            nativeSessions: [makeSession(1, 'First native'), makeSession(2, 'Second native')],
            nativeLoading: false
          }
        }}
        snapshot={snapshot}
        pending={false}
        error=""
        onClose={vi.fn()}
        onError={vi.fn()}
        action={async run => { await run() }}
        runCommand={vi.fn(async () => {})}
        onDelegations={vi.fn()}
      />
    )

    expect(screen.getByText('Saved Alpha')).toBeInTheDocument()
    expect(screen.queryByText('Saved Beta')).toBeNull()
    expect(screen.getByRole('heading', { level: 3, name: new RegExp(`${tt('commandDialog.saved')}.*\\(1\\)`) })).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 3, name: new RegExp(`${tt('commandDialog.delegated')}.*\\(0\\)`) })).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 3, name: /\(2\)/ })).toBeInTheDocument()

    // Store updates reactively without remounting the dialog
    act(() => {
      useThreadStore.setState({ threads: [current, saved1, saved2] } as never)
    })

    expect(screen.getByText('Saved Beta')).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 3, name: new RegExp(`${tt('commandDialog.saved')}.*\\(2\\)`) })).toBeInTheDocument()
  })
})
