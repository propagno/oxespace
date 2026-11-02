import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { ReactElement } from 'react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { GitHubPrStatus } from '../shared/types/github'
import type { ConversationThread } from '../shared/types/thread'
import { PR_ARCHIVE_OFFER_MS, prArchiveOffer } from '../src/components/Threads/prArchiveOffer'
import { usePrArchiveOffer } from '../src/components/Threads/usePrArchiveOffer'
import { useThreadStore } from '../src/store/thread.store'
import { Toaster, useToasts } from '../src/ui/Toast'

/** T40 (B20): a conversation whose own pull request closed or merged offers to archive itself, with Keep. */

const BRANCH = 'oxe/fix-login'
const thread = (change: Partial<ConversationThread> = {}): ConversationThread => ({
  id: 'conv-1', title: 'Fix login', archived: false, keptAfterPr: [],
  ownedWorktree: { path: '/repo-wt', branch: BRANCH, projectRoot: '/repo', baseCommit: 'abc' },
  ...change
} as ConversationThread)
const status = (state: GitHubPrStatus['state'], number = 41, headRefName: string | null = BRANCH): GitHubPrStatus => ({
  number, title: 'Fix login', state, isDraft: false, url: null, headRefName, baseRefName: 'main', mergeable: null, reviewDecision: null, autoMerge: false, checks: []
})

describe('which conversation is offered', () => {
  it('only its own worktree\'s PR, once it closed or merged', () => {
    expect(prArchiveOffer(thread(), status('MERGED'))).toEqual({ prNumber: 41, merged: true })
    expect(prArchiveOffer(thread(), status('CLOSED'))).toEqual({ prNumber: 41, merged: false })
    expect(prArchiveOffer(thread(), status('OPEN'))).toBeNull()
    expect(prArchiveOffer(thread(), null)).toBeNull()
  })
  it('never a conversation at the project root, another branch, an archived one or a kept PR', () => {
    expect(prArchiveOffer(thread({ ownedWorktree: undefined }), status('MERGED'))).toBeNull()
    expect(prArchiveOffer(thread(), status('MERGED', 41, 'oxe/other'))).toBeNull()
    expect(prArchiveOffer(thread({ archived: true }), status('MERGED'))).toBeNull()
    expect(prArchiveOffer(thread({ keptAfterPr: [41] }), status('MERGED'))).toBeNull()
  })
  it('a new PR on the same branch is offered again after the old one was kept', () => {
    expect(prArchiveOffer(thread({ keptAfterPr: [41] }), status('MERGED', 52))).toEqual({ prNumber: 52, merged: true })
  })
})

let report: (status: GitHubPrStatus | null) => void = () => undefined
function Host({ conversation }: { conversation: ConversationThread | undefined }): ReactElement {
  report = usePrArchiveOffer(conversation)
  return <Toaster />
}

const settle = async (): Promise<void> => { for (let i = 0; i < 3; i++) await act(async () => { await Promise.resolve() }) }
const tick = (ms: number): void => { act(() => { vi.advanceTimersByTime(ms) }) }

describe('the offer (toast with Keep, archived when its time runs out)', () => {
  let archive: ReturnType<typeof vi.fn>
  let keep: ReturnType<typeof vi.fn>
  beforeAll(async () => { await import('../src/ui/ToastStack') })
  beforeEach(() => {
    vi.useFakeTimers()
    vi.stubGlobal('requestIdleCallback', (run: () => void) => { run(); return 1 })
    vi.spyOn(document, 'hasFocus').mockReturnValue(true)
    archive = vi.fn(async () => true)
    keep = vi.fn(async () => undefined)
    useThreadStore.setState({ archiveThread: archive } as never)
    ;(window as unknown as { oxe: unknown }).oxe = { thread: { keepAfterPr: keep } }
  })
  afterEach(() => { act(() => useToasts.setState({ items: [] })); cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks() })

  const mount = async (conversation = thread()): Promise<{ rerender: (next: ConversationThread | undefined) => void }> => {
    const view = render(<Host conversation={conversation} />)
    await settle()
    return { rerender: next => view.rerender(<Host conversation={next} />) }
  }

  it('merged: says so, offers Keep politely, and archives when the time runs out', async () => {
    await mount()
    act(() => report(status('MERGED')))
    await settle()
    expect(screen.getByText('Pull request #41 was merged')).toBeVisible()
    expect(screen.getByText('This conversation will be archived. Archived conversations can\'t be restored yet.')).toBeVisible()
    expect(screen.getByRole('region', { name: 'Notifications' })).toHaveAttribute('aria-live', 'polite')
    expect(screen.getByRole('button', { name: 'Keep' })).toBeVisible()
    tick(PR_ARCHIVE_OFFER_MS - 1)
    expect(archive).not.toHaveBeenCalled()
    tick(1)
    expect(archive).toHaveBeenCalledWith('conv-1')
    // Not offered again for the same PR in this session.
    act(() => report(status('MERGED')))
    expect(useToasts.getState().items).toHaveLength(0)
  })

  it('closed: offered too; an open PR and a conversation without its own worktree are left alone', async () => {
    const { rerender } = await mount()
    act(() => report(status('OPEN')))
    expect(useToasts.getState().items).toHaveLength(0)
    act(() => report(status('CLOSED')))
    expect(useToasts.getState().items[0]?.title).toBe('Pull request #41 was closed')
    act(() => useToasts.setState({ items: [] }))
    rerender(thread({ id: 'conv-2', ownedWorktree: undefined }))
    act(() => report(status('MERGED')))
    expect(useToasts.getState().items).toHaveLength(0)
  })

  it('the timer pauses while the toast has focus: nothing is archived until it is let go', async () => {
    await mount()
    act(() => report(status('MERGED')))
    await settle()
    const keepButton = screen.getByRole('button', { name: 'Keep' })
    act(() => keepButton.focus())
    fireEvent.focus(keepButton)
    tick(PR_ARCHIVE_OFFER_MS * 3)
    expect(archive).not.toHaveBeenCalled()
  })

  it('Keep keeps it: nothing archived, the PR number is stored with the conversation, and it is not offered again', async () => {
    await mount()
    act(() => report(status('MERGED')))
    await settle()
    fireEvent.click(screen.getByRole('button', { name: 'Keep' }))
    expect(keep).toHaveBeenCalledWith('conv-1', 41)
    tick(PR_ARCHIVE_OFFER_MS * 2)
    expect(archive).not.toHaveBeenCalled()
    act(() => report(status('MERGED')))
    expect(useToasts.getState().items).toHaveLength(0)
  })

  it('leaving the conversation or the window archives nothing, and the next read offers again', async () => {
    const { rerender } = await mount()
    act(() => report(status('MERGED')))
    rerender(thread({ id: 'conv-2', ownedWorktree: undefined }))
    tick(PR_ARCHIVE_OFFER_MS * 2)
    expect(archive).not.toHaveBeenCalled()
    rerender(thread())
    act(() => report(status('MERGED')))
    expect(useToasts.getState().items).toHaveLength(1)
    act(() => { window.dispatchEvent(new Event('blur')) })
    tick(PR_ARCHIVE_OFFER_MS * 2)
    expect(archive).not.toHaveBeenCalled()
    act(() => report(status('MERGED')))
    expect(useToasts.getState().items).toHaveLength(1)
  })

  it('without window focus when the time runs out, nothing is archived', async () => {
    vi.spyOn(document, 'hasFocus').mockReturnValue(false)
    await mount()
    act(() => report(status('MERGED')))
    tick(PR_ARCHIVE_OFFER_MS)
    expect(archive).not.toHaveBeenCalled()
  })
})
