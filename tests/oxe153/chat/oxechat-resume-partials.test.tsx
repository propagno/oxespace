// Frozen acceptance test for 1.5.2 OxeChat UX onda 2 (Jira OXE-329, A1–A2). Written by the planner; the executor must
// not edit it. OXE-165 (#1013) streams `session:list-partial` to the OxeCode finder; /resume in OxeChat still waits for
// the whole `window.oxe.session.list`. Contract (it needs #1013's preload API on main):
// - src/components/Threads/threadCommandPanels.ts: when `window.oxe.session.onPartial` exists, `loadResumeData` does
//   not wait for the native list: it returns `nativeSessions: []` and `nativeLoading: true` (ThreadResumeData).
// - src/components/Threads/ThreadCommandDialog.tsx: the resume surface with `nativeLoading` asks
//   `window.oxe.session.list({ workspaceId, workspaceRootPath, provider, requestId })` with a fresh requestId, shows the
//   sessions of each `onPartial` event for that requestId (others are dropped), shows the src/ui Spinner (role status)
//   until the list resolves, keeps the typed filter, and unsubscribes on close. Without onPartial, today's behaviour.
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ConversationThread, ThreadSnapshot } from '../../../shared/types/thread'
import type { SessionSummary } from '../../../shared/types/session'
import ThreadCommandDialog from '../../../src/components/Threads/ThreadCommandDialog'
import { loadResumeData } from '../../../src/components/Threads/threadCommandPanels'

const thread = { id: 't1', title: 'Checkout', provider: 'claude', rootPath: '/repo', workspaceId: 'w1' } as unknown as ConversationThread
const snapshot = { thread, events: [] } as unknown as ThreadSnapshot
const session = (n: number, preview: string): SessionSummary => ({
  sessionId: `0000000${n}-0000-4000-8000-00000000000${n}`, provider: 'claude', modelId: 'sonnet', requestCount: 1, lastUpdatedMs: n, sessionStartedAtMs: n,
  totalTokens: 0, estimatedCostUsd: 0, filePath: null, isFork: false, firstMessagePreview: preview
} as unknown as SessionSummary)

type Partial = { requestId: string; workspaceId: string; workspaceRootPath: string; provider: string; sessions: SessionSummary[] }
let listeners: Array<(event: Partial) => void>
let unsubscribe: ReturnType<typeof vi.fn>
let finish: (sessions: SessionSummary[]) => void

beforeEach(() => {
  listeners = []
  unsubscribe = vi.fn()
  window.oxe = {
    delegation: { status: vi.fn().mockResolvedValue({ tasks: [], nextCursor: null }) },
    thread: {},
    session: {
      list: vi.fn(() => new Promise<SessionSummary[]>(resolve => { finish = resolve })),
      onPartial: vi.fn((listener: (event: Partial) => void) => { listeners.push(listener); return unsubscribe })
    }
  } as unknown as typeof window.oxe
})
afterEach(() => { cleanup() })

async function openResume() {
  // The dialog must open before the native list resolves: loadResumeData may not wait for it.
  const raced = await Promise.race([loadResumeData(thread), new Promise<string>(resolve => setTimeout(() => resolve('waited for the whole native list'), 1000))])
  expect(raced).not.toBe('waited for the whole native list')
  const resume = raced as Awaited<ReturnType<typeof loadResumeData>>
  const view = render(<ThreadCommandDialog panel={{ kind: 'panel', surface: 'sessions', title: 'Resume', resume }} snapshot={snapshot} pending={false} error="" onClose={vi.fn()} onError={vi.fn()} action={vi.fn(async (run: () => Promise<unknown>) => { await run() })} runCommand={vi.fn(async () => {})} />)
  await waitFor(() => expect(window.oxe.session.list).toHaveBeenCalled())
  const requestId = (vi.mocked(window.oxe.session.list).mock.calls[0][0] as { requestId?: string }).requestId
  return { resume, view, requestId }
}

const emit = (event: Partial) => act(() => { for (const listener of listeners) listener(event) })

describe('OXE-329 · /resume in OxeChat lists native sessions as they are read', () => {
  it('ThreadCommandDialog streams native sessions progressively via onPartial and ignores stale requestId', async () => {
    const user = userEvent.setup()
    const { resume, requestId } = await openResume()
    expect(resume).toMatchObject({ nativeSessions: [], nativeLoading: true })
    expect(typeof requestId).toBe('string')
    expect(screen.getByRole('status', { name: /loading|carregando/i })).toBeInTheDocument()

    emit({ requestId: 'stale-request', workspaceId: 'w1', workspaceRootPath: '/repo', provider: 'claude', sessions: [session(9, 'Old reopen')] })
    expect(screen.queryByText('Old reopen')).toBeNull()

    emit({ requestId: requestId!, workspaceId: 'w1', workspaceRootPath: '/repo', provider: 'claude', sessions: [session(1, 'Fix login'), session(2, 'Refund flow')] })
    expect(screen.getByText('Fix login')).toBeInTheDocument()
    expect(screen.getByText('Refund flow')).toBeInTheDocument()

    await user.type(screen.getByRole('searchbox'), 'refund')
    emit({ requestId: requestId!, workspaceId: 'w1', workspaceRootPath: '/repo', provider: 'claude', sessions: [session(1, 'Fix login'), session(2, 'Refund flow'), session(3, 'Refund tests')] })
    expect(screen.getByRole('searchbox')).toHaveValue('refund')
    expect(screen.queryByText('Fix login')).toBeNull()
    expect(screen.getByText('Refund tests')).toBeInTheDocument()

    await act(async () => { finish([session(1, 'Fix login'), session(2, 'Refund flow'), session(3, 'Refund tests')]) })
    await waitFor(() => expect(screen.queryByRole('status', { name: /loading|carregando/i })).toBeNull())
  })

  it('ThreadCommandDialog unsubscribes onPartial cleanly on close', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const { view, requestId } = await openResume()
    expect(window.oxe.session.onPartial).toHaveBeenCalledTimes(1)
    view.unmount()
    expect(unsubscribe).toHaveBeenCalledTimes(1)
    emit({ requestId: requestId!, workspaceId: 'w1', workspaceRootPath: '/repo', provider: 'claude', sessions: [session(1, 'Late')] })
    await act(async () => { finish([session(1, 'Late')]) })
    expect(errors).not.toHaveBeenCalled()
    errors.mockRestore()
  })
})
