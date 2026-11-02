import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { ThreadEmptyState } from '../src/components/Threads/ThreadEmptyState'

afterEach(cleanup)

const thread = (extra: object) => ({ id: 't', workspaceId: 'w', projectId: 'p', rootPath: 'C:/repos/.oxespace/worktrees/feature-a4-cd34', provider: 'claude', nativeSessionId: null, title: 'New conversation', pinned: false, status: 'idle', createdAt: 1, updatedAt: 1, ...extra }) as never

describe('the opening of a conversation in its own worktree (homologation A4)', () => {
  it('names the branch in the question, not the worktree folder with its random suffix', () => {
    render(<ThreadEmptyState thread={thread({ ownedWorktree: { path: 'C:/repos/.oxespace/worktrees/feature-a4-cd34', branch: 'feature/a4', baseCommit: 'abc' } })} branch="feature/a4" onStarter={() => {}} />)
    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent('feature/a4')
    expect(screen.getByRole('heading', { level: 2 })).not.toHaveTextContent('cd34')
  })

  it('names the folder when the conversation works in the project itself', () => {
    render(<ThreadEmptyState thread={thread({ rootPath: 'C:/repos/oxespace' })} onStarter={() => {}} />)
    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent('oxespace')
  })
})
