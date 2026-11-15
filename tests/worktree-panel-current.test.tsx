import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { GitHubWorktree } from '../shared/types/github'
import type { WorkspacePane } from '../shared/types/workspace'
import { WorktreePanelBody } from '../src/components/Worktree/WorktreePanelBody'
import { useWorktreeStore } from '../src/store/worktree.store'

/**
 * OXE-273: the Worktrees panel never marked the active pane's worktree as current when the pane's saved root and
 * git's list spelled the same folder differently (C:\repo-hotfix vs C:/repo-hotfix), so the row stayed clickable.
 */
const ROOT = 'C:/repo'
const worktree = (path: string, branch: string, isMain = false): GitHubWorktree =>
  ({ path, branch, head: 'abc1234', isMain, locked: false, prunable: false }) as unknown as GitHubWorktree
const pane = (rootPath: string | null): WorkspacePane =>
  ({ id: 'pane-1', rowIndex: 0, columnIndex: 0, rootPath, displayName: 'Terminal 1' }) as unknown as WorkspacePane

// Every window.oxe call the panel makes on mount (default branch, paths) answers with nothing.
const anything: ProxyHandler<object> = { get: (_target, key) => key === 'then' ? undefined : new Proxy(() => Promise.resolve(null), anything), apply: () => Promise.resolve(null) }

describe('the Worktrees panel marks the active pane\'s worktree (OXE-273)', () => {
  beforeEach(() => {
    window.oxe = new Proxy({}, anything) as unknown as typeof window.oxe
    useWorktreeStore.setState({
      byRoot: { [ROOT]: [worktree('C:/repo', 'main', true), worktree('C:/repo-hotfix', 'hotfix')] },
      loading: {},
      error: {},
      refresh: vi.fn(async () => undefined),
      status: vi.fn(async () => null)
    })
  })
  afterEach(() => cleanup())

  const row = (branch: string): HTMLElement => {
    const strong = screen.getAllByText(branch).find(node => node.closest('.worktree-menu-item-select'))
    return strong?.closest('.worktree-menu-item-select') as HTMLElement
  }

  test('the same folder spelled with other separators or case is the current row', () => {
    render(<WorktreePanelBody activePane={pane('C:\\REPO-HOTFIX')} workspaceId="ws-1" workspaceRootPath={ROOT} />)
    expect(row('hotfix')).toHaveAttribute('aria-current', 'true')
    expect(row('hotfix')).toBeDisabled()
    expect(row('main')).not.toHaveAttribute('aria-current')
  })

  test('a different folder is not current, and a pane at the root is on main', () => {
    render(<WorktreePanelBody activePane={pane('C:/repo-hotfix-2')} workspaceId="ws-1" workspaceRootPath={ROOT} />)
    expect(row('hotfix')).not.toHaveAttribute('aria-current')
    cleanup()
    render(<WorktreePanelBody activePane={pane(null)} workspaceId="ws-1" workspaceRootPath={ROOT} />)
    expect(row('main')).toHaveAttribute('aria-current', 'true')
    expect(row('hotfix')).not.toHaveAttribute('aria-current')
  })
})
