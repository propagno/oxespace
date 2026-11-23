// Frozen acceptance test for OXE-369 A7, A8, A9, A11 (program 152sec, phase F1). Written by the planner; the executor must not edit it.
// Main validates a removal and stops the terminals inside it itself (removeWorktreeSafely, step 5). The window stops
// nothing, and moves panes only after the worktree left Git.
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { GitHubWorktree } from '../../../shared/types/github'
import type { Workspace, WorkspacePane } from '../../../shared/types/workspace'
import { WorktreePanelBody } from '../../../src/components/Worktree/WorktreePanelBody'
import { WorktreesPanel } from '../../../src/components/Worktree/WorktreesPanel'
import { useWorktreeStore } from '../../../src/store/worktree.store'
import { useWorkspaceStore } from '../../../src/store/workspace.store'

const ROOT = 'C:/repo'
const TREE = 'C:/repo-hotfix'
const worktree = (path: string, branch: string, isMain = false): GitHubWorktree =>
  ({ path, branch, head: 'abc1234', isMain, locked: false, prunable: false }) as unknown as GitHubWorktree
const pane = { id: 'pane-1', workspaceId: 'ws-1', type: 'terminal', rowIndex: 0, columnIndex: 0, rootPath: 'C:\\repo-hotfix\\src', displayName: 'Terminal 1' } as unknown as WorkspacePane
const CLEAN = { dirtyCount: 0, untrackedCount: 0, ahead: 0, behind: 0, noUpstream: false }

const original = window.oxe
const anything: ProxyHandler<object> = { get: (_target, key) => key === 'then' ? undefined : new Proxy(() => Promise.resolve(null), anything), apply: () => Promise.resolve(null) }
const stop = vi.fn(async () => undefined)
const setPaneRootPath = vi.fn(async () => undefined)
const getWorktreeStatus = vi.fn<() => Promise<unknown>>()
const removeWorktree = vi.fn<(input: unknown) => Promise<unknown>>()
const createWorktree = vi.fn<(input: unknown) => Promise<unknown>>()
let listed: GitHubWorktree[] = []
const realSetPaneRootPath = useWorkspaceStore.getState().setPaneRootPath

beforeEach(() => {
  for (const mock of [stop, setPaneRootPath, getWorktreeStatus, removeWorktree, createWorktree]) mock.mockClear()
  getWorktreeStatus.mockResolvedValue(CLEAN)
  removeWorktree.mockResolvedValue({ ok: true, message: 'removed' })
  listed = [worktree(ROOT, 'main', true), worktree(TREE, 'hotfix')]
  const github = { getWorktreeStatus, removeWorktree, createWorktree, listWorktrees: async () => listed, resolveWorktreeBase: async () => null }
  const bridge: Record<string, unknown> = { github: new Proxy(github, { get: (target, key) => key in target ? target[key as keyof typeof target] : () => Promise.resolve(null) }), terminal: { stop } }
  window.oxe = new Proxy(bridge, { get: (target, key) => key === 'then' ? undefined : key in target ? target[key as string] : new Proxy(() => Promise.resolve(null), anything) }) as unknown as typeof window.oxe
  useWorktreeStore.setState({ byRoot: { [ROOT]: listed }, loading: {}, error: {} })
  useWorkspaceStore.setState({ workspaces: [{ id: 'ws-1', name: 'repo', rootPath: ROOT, panes: [pane] } as unknown as Workspace], setPaneRootPath })
})
afterEach(() => {
  cleanup()
  useWorkspaceStore.setState({ workspaces: [], setPaneRootPath: realSetPaneRootPath })
  window.oxe = original
})

async function askRemove(): Promise<HTMLElement> {
  render(<WorktreePanelBody activePane={pane} workspaceId="ws-1" workspaceRootPath={ROOT} />)
  fireEvent.click(screen.getByRole('button', { name: 'Remove worktree hotfix' }))
  const title = await screen.findByText('Remove hotfix?')
  return title.closest('[role="dialog"], [role="alertdialog"]') as HTMLElement
}
async function confirm(dialog: HTMLElement): Promise<void> {
  const button = within(dialog).getByRole('button', { name: /^Remove/ })
  await waitFor(() => expect(button).toBeEnabled())
  fireEvent.click(button)
}

describe('OXE-369 · removing a worktree', () => {
  it('a refused worktree removal leaves terminals and pane roots untouched', async () => {
    removeWorktree.mockRejectedValue(new Error('The worktree is locked (git worktree lock). Unlock it before removing.'))
    await confirm(await askRemove())
    await waitFor(() => expect(removeWorktree).toHaveBeenCalled(), { timeout: 3_000 })
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(stop).not.toHaveBeenCalled()
    expect(setPaneRootPath).not.toHaveBeenCalled()
  })

  it('panes move to the main worktree only after the removal succeeded', async () => {
    let removedWhenMoved: boolean | null = null
    let removed = false
    removeWorktree.mockImplementation(async () => { removed = true; listed = [worktree(ROOT, 'main', true)]; return { ok: true, message: 'removed' } })
    setPaneRootPath.mockImplementationOnce(async () => { removedWhenMoved = removed; return undefined })
    await confirm(await askRemove())
    await waitFor(() => expect(setPaneRootPath).toHaveBeenCalledWith('pane-1', null), { timeout: 3_000 })
    expect(removedWhenMoved).toBe(true)
    expect(stop).not.toHaveBeenCalled()
  })

  it('panes also move when Git let go of the worktree and only its folder stayed', async () => {
    let removed = false
    removeWorktree.mockImplementation(async () => { removed = true; listed = [worktree(ROOT, 'main', true)]; throw new Error('Permission denied') })
    let removedWhenMoved: boolean | null = null
    setPaneRootPath.mockImplementationOnce(async () => { removedWhenMoved = removed; return undefined })
    await confirm(await askRemove())
    await waitFor(() => expect(setPaneRootPath).toHaveBeenCalledWith('pane-1', null), { timeout: 3_000 })
    expect(removedWhenMoved).toBe(true)
  })

  it('a failed status probe ends the checking state and never forces', async () => {
    getWorktreeStatus.mockRejectedValue(new Error('fatal: index file corrupt'))
    const dialog = await askRemove()
    const button = within(dialog).getByRole('button', { name: /^Remove/ })
    await waitFor(() => expect(button).toBeEnabled())
    expect(dialog).not.toHaveTextContent('Checking what this worktree holds')
    // It must not claim that the worktree is clean either.
    expect(dialog).not.toHaveTextContent('Everything here is committed and pushed')
    fireEvent.click(button)
    await waitFor(() => expect(removeWorktree).toHaveBeenCalledWith(expect.objectContaining({ path: TREE, force: false })))
  })

  it('an existing branch is not reported as an existing folder', async () => {
    createWorktree.mockRejectedValue(new Error("fatal: a branch named 'feature-x' already exists"))
    render(<WorktreePanelBody activePane={pane} workspaceId="ws-1" workspaceRootPath={ROOT} />)
    fireEvent.click(screen.getByRole('button', { name: 'New worktree' }))
    fireEvent.change(screen.getByLabelText('Branch name'), { target: { value: 'feature-x' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create worktree' }))
    await waitFor(() => expect(createWorktree).toHaveBeenCalled())
    expect(await screen.findByText(/branch.*already exists/i)).toBeInTheDocument()
    expect(document.body).not.toHaveTextContent('The folder')
  })

  it('switching repositories clears the rows and the pending removal at once', async () => {
    const row = { path: '/a-tree', branch: 'of-repo-a', conversation: null, merged: { by: 'git', value: true }, prNumber: null, changed: 0, diskBytes: 1, lastActivity: null, branchChanged: false }
    const list = vi.fn((input: { rootPath: string }) => input.rootPath === '/a' ? Promise.resolve([row]) : new Promise<never>(() => undefined))
    window.oxe = { worktreesPanel: { list, remove: vi.fn() } } as unknown as typeof window.oxe
    const view = render(<WorktreesPanel rootPath="/a" />)
    fireEvent.click(within((await screen.findByText('of-repo-a')).closest('tr') as HTMLElement).getByRole('button'))
    expect(await screen.findByText('Remove the worktree at /a-tree?')).toBeInTheDocument()
    view.rerender(<WorktreesPanel rootPath="/b" />)
    await waitFor(() => expect(screen.queryByText('Remove the worktree at /a-tree?')).toBeNull())
    expect(screen.queryByText('of-repo-a')).toBeNull()
  })
})
