import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import type { MainMessage } from '../shared/messages'
import type { ConversationThread } from '../shared/types/thread'
import { ThreadEmptyState } from '../src/components/Threads/ThreadEmptyState'

/** The opening of a conversation shows what creating its own worktree reported, until the person dismisses it. */

const thread = (id: string, notices?: MainMessage[]): ConversationThread => ({
  id, provider: 'claude', rootPath: '/repo-worktrees/feature-x', title: '', access: 'read-only',
  ownedWorktree: { path: '/repo-worktrees/feature-x', branch: 'feature/x', projectRoot: '/repo', baseSha: 'abc', createdAt: 1, ...(notices ? { notices } : {}) }
} as ConversationThread)

afterEach(() => { cleanup(); try { localStorage.clear() } catch { /* none */ } })

describe('ThreadEmptyState with a worktree of its own', () => {
  it('shows the notices, a refusal as an alert, and remembers the dismissal for that conversation', () => {
    const notices = [
      { code: 'worktree.createdFrom', params: { path: '/repo-worktrees/feature-x', branch: 'feature/x', base: 'main' } },
      { code: 'worktree.copyFiles.outsideRepo', params: { patterns: ['../outside.txt'] } }
    ] as MainMessage[]
    const first = render(<ThreadEmptyState thread={thread('t1', notices)} onStarter={() => {}} />)
    expect(screen.getByText('Worktree created at /repo-worktrees/feature-x (branch feature/x from main).')).toBeTruthy()
    expect(screen.getByRole('alert').textContent).toContain('../outside.txt')
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }))
    expect(screen.queryByRole('alert')).toBeNull()
    first.unmount()
    // Opened again: still dismissed. Another conversation still shows its own.
    render(<ThreadEmptyState thread={thread('t1', notices)} onStarter={() => {}} />)
    expect(screen.queryByRole('alert')).toBeNull()
    cleanup()
    render(<ThreadEmptyState thread={thread('t2', notices)} onStarter={() => {}} />)
    expect(screen.getByRole('alert')).toBeTruthy()
  })

  it('shows nothing extra without notices', () => {
    render(<ThreadEmptyState thread={thread('t3')} onStarter={() => {}} />)
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Dismiss' })).toBeNull()
  })
})
