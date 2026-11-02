import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { ReactElement } from 'react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { GitHubPrStatus } from '../shared/types/github'
import type { ConversationThread } from '../shared/types/thread'
import { setShownView } from '../src/app/shownView'
import { PR_ARCHIVE_OFFER_MS, prArchiveOffer } from '../src/components/Threads/prArchiveOffer'
import { resetPrArchiveOffers, usePrArchiveOffer } from '../src/components/Threads/usePrArchiveOffer'
import { useThreadStore } from '../src/store/thread.store'
import { Toaster, useToasts } from '../src/ui/Toast'

/**
 * T40 (B20, X17; DESIGN option A on #442): a conversation whose own pull request closed or merged is archived when the
 * toast's time runs out; Keep, ✕ and Escape keep it; leaving OxeChat or the conversation withdraws it.
 */

const BRANCH = 'oxe/fix-login'
const thread = (change: Partial<ConversationThread> = {}): ConversationThread => ({
  id: 'conv-1', title: 'Fix login', archived: false, keptAfterPr: [],
  ownedWorktree: { path: '/repo-wt', branch: BRANCH, projectRoot: '/repo', baseCommit: 'abc' },
  ...change
} as ConversationThread)
const status = (state: GitHubPrStatus['state'], number = 41, headRefName: string | null = BRANCH): GitHubPrStatus => ({
  number, title: 'Fix login', state, isDraft: false, url: null, headRefName, baseRefName: 'main', mergeable: null, reviewDecision: null, autoMerge: false, checks: []
})

describe('which conversation comes up', () => {
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
  it('a new PR on the same branch comes up again after the old one was kept', () => {
    expect(prArchiveOffer(thread({ keptAfterPr: [41] }), status('MERGED', 52))).toEqual({ prNumber: 52, merged: true })
  })
  it('the timeout is at least 10 s (DESIGN, WCAG 2.2.1)', () => {
    expect(PR_ARCHIVE_OFFER_MS).toBeGreaterThanOrEqual(10_000)
  })
})

let report: (status: GitHubPrStatus | null) => void = () => undefined
function Host({ conversation }: { conversation: ConversationThread | undefined }): ReactElement {
  report = usePrArchiveOffer(conversation)
  return <Toaster />
}

const settle = async (): Promise<void> => { for (let i = 0; i < 3; i++) await act(async () => { await Promise.resolve() }) }
const tick = (ms: number): void => { act(() => { vi.advanceTimersByTime(ms) }) }
const titles = (): string[] => useToasts.getState().items.map(item => item.title)

describe('the toast (archived when its time runs out; Keep, ✕ and Escape keep it)', () => {
  let archive: ReturnType<typeof vi.fn>
  let keep: ReturnType<typeof vi.fn>
  let command: ReturnType<typeof vi.fn>
  let adopt: ReturnType<typeof vi.fn>
  beforeAll(async () => { await import('../src/ui/ToastStack') })
  beforeEach(() => {
    vi.useFakeTimers()
    vi.stubGlobal('requestIdleCallback', (run: () => void) => { run(); return 1 })
    resetPrArchiveOffers()
    act(() => setShownView('thread'))
    archive = vi.fn(async () => true)
    keep = vi.fn(async () => undefined)
    command = vi.fn(async () => undefined)
    adopt = vi.fn()
    useThreadStore.setState({ archiveThread: archive, adopt } as never)
    ;(window as unknown as { oxe: unknown }).oxe = { thread: { keepAfterPr: keep, command, read: vi.fn(async () => ({ thread: thread() })) } }
  })
  afterEach(() => { act(() => useToasts.setState({ items: [] })); act(() => setShownView('code')); cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks() })

  const mount = async (conversation = thread()): Promise<{ rerender: (next: ConversationThread | undefined) => void }> => {
    const view = render(<Host conversation={conversation} />)
    await settle()
    return { rerender: next => view.rerender(<Host conversation={next} />) }
  }

  it('merged: says it will be archived, politely, with Keep; its time running out archives it and says so, with Restore', async () => {
    await mount()
    act(() => report(status('MERGED')))
    await settle()
    expect(screen.getByText('Pull request #41 was merged')).toBeVisible()
    expect(screen.getByText('This conversation will be archived. You can restore it from Archived in the sidebar.')).toBeVisible()
    expect(screen.getByRole('region', { name: 'Notifications' })).toHaveAttribute('aria-live', 'polite')
    expect(screen.getByRole('button', { name: 'Keep' })).toBeVisible()
    expect(screen.queryByText(/can't be restored/)).toBeNull()
    tick(PR_ARCHIVE_OFFER_MS - 100)
    expect(archive).not.toHaveBeenCalled()
    tick(200)
    expect(archive).toHaveBeenCalledWith('conv-1')
    expect(keep).not.toHaveBeenCalled()
    await settle()
    expect(screen.getByText('Conversation archived')).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: 'Restore' }))
    await settle()
    expect(command).toHaveBeenCalledWith('conv-1', '/resume conv-1')
    expect(adopt).toHaveBeenCalled()
  })

  it('Keep keeps it: the PR is stored with the conversation, nothing is archived, and it does not come up again', async () => {
    await mount()
    act(() => report(status('MERGED')))
    await settle()
    fireEvent.click(screen.getByRole('button', { name: 'Keep' }))
    tick(PR_ARCHIVE_OFFER_MS * 2)
    expect(keep).toHaveBeenCalledWith('conv-1', 41)
    expect(archive).not.toHaveBeenCalled()
    act(() => report(status('MERGED')))
    expect(useToasts.getState().items).toHaveLength(0)
  })

  it('the close button keeps it too', async () => {
    await mount()
    act(() => report(status('MERGED')))
    await settle()
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss notification' }))
    tick(PR_ARCHIVE_OFFER_MS * 2)
    expect(keep).toHaveBeenCalledWith('conv-1', 41)
    expect(archive).not.toHaveBeenCalled()
  })

  it('Escape keeps it too', async () => {
    await mount()
    act(() => report(status('CLOSED')))
    await settle()
    const button = screen.getByRole('button', { name: 'Keep' })
    act(() => button.focus())
    fireEvent.keyDown(button, { key: 'Escape' })
    tick(PR_ARCHIVE_OFFER_MS * 2)
    expect(keep).toHaveBeenCalledWith('conv-1', 41)
    expect(archive).not.toHaveBeenCalled()
  })

  it('the timer waits while the pointer is over the toast or focus is in it (WCAG 2.2.1)', async () => {
    await mount()
    act(() => report(status('MERGED')))
    await settle()
    const region = screen.getByRole('region', { name: 'Notifications' })
    fireEvent.mouseEnter(region)
    tick(PR_ARCHIVE_OFFER_MS * 3)
    expect(archive).not.toHaveBeenCalled()
    fireEvent.mouseLeave(region)
    act(() => screen.getByRole('button', { name: 'Keep' }).focus())
    tick(PR_ARCHIVE_OFFER_MS * 3)
    expect(archive).not.toHaveBeenCalled()
    act(() => (document.activeElement as HTMLElement).blur())
    tick(PR_ARCHIVE_OFFER_MS + 100)
    expect(archive).toHaveBeenCalledWith('conv-1')
  })

  it('leaving OxeChat withdraws it and archives nothing; coming back shows it again with a fresh timer', async () => {
    await mount()
    act(() => report(status('MERGED')))
    await settle()
    tick(PR_ARCHIVE_OFFER_MS - 1000)
    act(() => setShownView('code'))
    await settle()
    expect(useToasts.getState().items).toHaveLength(0)
    tick(PR_ARCHIVE_OFFER_MS * 2)
    expect(archive).not.toHaveBeenCalled()
    expect(keep).not.toHaveBeenCalled()
    // Not seen in OxeCode: a status read there raises nothing.
    act(() => report(status('MERGED')))
    expect(useToasts.getState().items).toHaveLength(0)
    act(() => setShownView('thread'))
    await settle()
    expect(titles()).toEqual(['Pull request #41 was merged'])
    tick(PR_ARCHIVE_OFFER_MS - 1000)
    expect(archive).not.toHaveBeenCalled()
    tick(1100)
    expect(archive).toHaveBeenCalledWith('conv-1')
  })

  it('leaving the conversation withdraws it; another conversation does not get it; the same one does, again', async () => {
    const { rerender } = await mount()
    act(() => report(status('MERGED')))
    expect(useToasts.getState().items).toHaveLength(1)
    rerender(thread({ id: 'conv-2', ownedWorktree: undefined }))
    await settle()
    expect(useToasts.getState().items).toHaveLength(0)
    tick(PR_ARCHIVE_OFFER_MS * 2)
    expect(archive).not.toHaveBeenCalled()
    rerender(thread())
    act(() => report(status('MERGED')))
    expect(useToasts.getState().items).toHaveLength(1)
  })

  it('closed comes up too; an open PR and a conversation without its own worktree are left alone', async () => {
    const { rerender } = await mount()
    act(() => report(status('OPEN')))
    expect(useToasts.getState().items).toHaveLength(0)
    act(() => report(status('CLOSED')))
    expect(titles()).toEqual(['Pull request #41 was closed'])
    act(() => useToasts.setState({ items: [] }))
    rerender(thread({ id: 'conv-2', ownedWorktree: undefined }))
    act(() => report(status('MERGED')))
    expect(useToasts.getState().items).toHaveLength(0)
  })
})
