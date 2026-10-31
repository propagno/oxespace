import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ThreadWorktreeFinishDialog } from '../src/components/Threads/ThreadWorktreeFinishDialog'
import { ThreadHeader } from '../src/components/Threads/ThreadHeader'
import { useThreadStore } from '../src/store/thread.store'
import { decideThreadWorktreeFinish, type ThreadWorktreeState } from '../shared/threadWorktree'
import type { ConversationThread } from '../shared/types/thread'

const original = window.oxe
const inspect = vi.fn(), finish = vi.fn()
const owned = { path: '/work/repo-worktrees/feature-x-ab12', branch: 'feature/x', projectRoot: '/work/repo', baseSha: 'a'.repeat(40), createdAt: 1 }
const thread = { id: 't1', title: 'Fix login', rootPath: owned.path, ownedWorktree: owned } as ConversationThread
const reading = (change: Partial<ThreadWorktreeState> = {}) => {
  const state = { missing: false, uncommitted: 0, untracked: 0, unpushed: 0, ...change }
  return { owned, state, decision: decideThreadWorktreeFinish(state) }
}

beforeEach(() => {
  inspect.mockReset(); finish.mockReset()
  window.oxe = { ...original, thread: { ...original?.thread, worktreeInspect: inspect, worktreeFinish: finish } } as typeof window.oxe
  vi.spyOn(useThreadStore.getState(), 'load').mockResolvedValue(undefined)
})
afterEach(() => { cleanup(); vi.restoreAllMocks(); window.oxe = original })

describe('ending a conversation that owns a worktree', () => {
  it('removes an empty worktree with the conversation after one confirmation', async () => {
    inspect.mockResolvedValue(reading())
    finish.mockResolvedValue({ removed: true })
    const onClose = vi.fn()
    render(<ThreadWorktreeFinishDialog thread={thread} action="archive" onClose={onClose} />)
    expect(await screen.findByText(/has no changes, so it is removed together with the conversation/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Archive and remove worktree' }))
    await waitFor(() => expect(finish).toHaveBeenCalledWith('t1', 'archive', 'auto'))
    await waitFor(() => expect(onClose).toHaveBeenCalled())
  })

  it('asks before touching work, and the first choice offered keeps it', async () => {
    inspect.mockResolvedValue(reading({ uncommitted: 2, untracked: 1, unpushed: 3 }))
    finish.mockResolvedValue({ removed: false, left: 'chosen' })
    render(<ThreadWorktreeFinishDialog thread={thread} action="archive" onOpenInCode={vi.fn().mockResolvedValue(undefined)} onClose={() => {}} />)
    expect(await screen.findByText('2 files with uncommitted changes')).toBeInTheDocument()
    expect(screen.getByText('1 new file that Git does not track yet')).toBeInTheDocument()
    expect(screen.getByText('3 commits that are not pushed')).toBeInTheDocument()
    expect(finish).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Archive and keep worktree' }))
    await waitFor(() => expect(finish).toHaveBeenCalledWith('t1', 'archive', 'keep'))
  })

  it('opens the worktree in Code without ending the conversation', async () => {
    inspect.mockResolvedValue(reading({ unpushed: 1 }))
    const openInCode = vi.fn().mockResolvedValue(undefined)
    const onClose = vi.fn()
    render(<ThreadWorktreeFinishDialog thread={thread} action="archive" onOpenInCode={openInCode} onClose={onClose} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Open in Code' }))
    await waitFor(() => expect(openInCode).toHaveBeenCalledWith(owned.path))
    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(finish).not.toHaveBeenCalled()
  })

  it('discards only after a second, explicit confirmation', async () => {
    inspect.mockResolvedValue(reading({ uncommitted: 1 }))
    finish.mockResolvedValue({ removed: true })
    render(<ThreadWorktreeFinishDialog thread={thread} action="delete" onClose={() => {}} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Discard work and remove…' }))
    expect(finish).not.toHaveBeenCalled()
    expect(screen.getByText(/deleted for good\. Commits stay on the branch/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Back' }))
    expect(await screen.findByRole('button', { name: 'Delete and keep worktree' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Discard work and remove…' }))
    fireEvent.click(screen.getByRole('button', { name: 'Discard and remove worktree' }))
    await waitFor(() => expect(finish).toHaveBeenCalledWith('t1', 'delete', 'discard'))
  })

  it('says so when Git could not be read, and keeping is still one click', async () => {
    inspect.mockResolvedValue(reading({ unreadable: true }))
    render(<ThreadWorktreeFinishDialog thread={thread} action="archive" onClose={() => {}} />)
    expect(await screen.findByText(/Git could not be read in this worktree/)).toBeInTheDocument()
    fireEvent.click(await screen.findByRole('button', { name: 'Archive and keep worktree' }))
    await waitFor(() => expect(finish).toHaveBeenCalledWith('t1', 'archive', 'keep'))
  })

  it('treats a failed reading as "cannot tell": keep or cancel, nothing removable', async () => {
    inspect.mockRejectedValue(new Error('boom'))
    render(<ThreadWorktreeFinishDialog thread={thread} action="archive" onClose={() => {}} />)
    expect(await screen.findByRole('button', { name: 'Archive and keep worktree' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Discard/ })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Archive and remove worktree' })).toBeNull()
  })

  it('shows why the conversation did not end when the main process refuses', async () => {
    inspect.mockResolvedValue(reading())
    finish.mockRejectedValue(new Error("Error invoking remote method 'thread:worktree-finish': Error: The active turn has not stopped. Try again after it finishes."))
    const onClose = vi.fn()
    render(<ThreadWorktreeFinishDialog thread={thread} action="archive" onClose={onClose} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Archive and remove worktree' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('The active turn has not stopped')
    expect(onClose).not.toHaveBeenCalled()
  })
})

describe('the conversation header', () => {
  it('shows the branch and a worktree badge for a conversation that owns one', () => {
    render(<ThreadHeader thread={thread} pending={false} running={false} onCommand={() => {}} onDelegate={() => {}} onPin={() => {}} onTogglePanel={() => {}} />)
    expect(screen.getByText('feature/x')).toBeInTheDocument()
    expect(screen.getByText('worktree')).toHaveAttribute('title', expect.stringContaining('feature/x'))
  })

  it('shows no worktree badge for an ordinary conversation', () => {
    render(<ThreadHeader thread={{ ...thread, ownedWorktree: undefined }} branch="main" pending={false} running={false} onCommand={() => {}} onDelegate={() => {}} onPin={() => {}} onTogglePanel={() => {}} />)
    expect(screen.getByText('main')).toBeInTheDocument()
    expect(screen.queryByText('worktree')).toBeNull()
  })
})
