import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import type { Workspace, WorkspacePane } from '../../shared/types/workspace'
import { PaneBranchBadge } from '../../src/components/Workspace/PaneBranchBadge'
import { AppStatusBar } from '../../src/components/Workspace/AppStatusBar'
import { __resetGitBranchCacheForTests } from '../../src/hooks/useGitBranch'
import { paneGitContext } from '../../src/utils/paneGitContext'
import { useTerminalStore } from '../../src/store/terminal.store'

const pane = (id: string, rootPath: string | null) => ({ id, type: 'terminal', rootPath }) as WorkspacePane
const workspace = { id: 'branches', name: 'Project', rootPath: '/project', panes: [pane('a','/trees/auth'),pane('b','/trees/payment'),pane('c','/trees/frontend')] } as Workspace
const original = window.oxe
beforeEach(() => { __resetGitBranchCacheForTests() })
afterEach(() => { cleanup(); __resetGitBranchCacheForTests(); window.oxe = original })

test('three terminal branches follow pane roots without repeating the branch in the status bar', async () => {
  const getBranch = vi.fn(async ({ rootPath }: {rootPath:string}) => ({ branch: `feat/${rootPath.split('/').at(-1)}`, detached: false, shortSha: null }))
  window.oxe = { ...original, git: { ...original?.git, getBranch } }
  const view = render(<>{workspace.panes.map(p => <PaneBranchBadge key={p.id} workspace={workspace} pane={p} />)}<AppStatusBar workspace={workspace} activePaneId="b" /></>)
  await waitFor(() => expect(screen.getAllByText('feat/payment')).toHaveLength(1))
  expect(screen.getByText('feat/auth')).toBeTruthy()
  expect(screen.getByText('feat/frontend')).toBeTruthy()
  expect(screen.getByRole('contentinfo')).not.toHaveTextContent('feat/payment')
  expect(getBranch).toHaveBeenCalledTimes(3)
  expect(getBranch.mock.calls.some(([input]) => input.rootPath === '/project')).toBe(false)
  view.unmount()
  render(<PaneBranchBadge workspace={workspace} pane={workspace.panes[0]} />)
  await waitFor(() => expect(screen.getByText('feat/auth')).toBeTruthy())
})

test('focus refresh updates the pane badge, including detached HEAD and failures', async () => {
  const getBranch = vi.fn().mockResolvedValue({branch:'feat/auth',detached:false,shortSha:null})
  window.oxe = { ...original, git: { ...original?.git, getBranch } }
  render(<><PaneBranchBadge workspace={workspace} pane={workspace.panes[0]} /><AppStatusBar workspace={workspace} activePaneId="a" /></>)
  await waitFor(() => expect(screen.getAllByText('feat/auth')).toHaveLength(1))
  getBranch.mockResolvedValue({branch:null,detached:true,shortSha:'abc1234'})
  act(() => { window.dispatchEvent(new Event('focus')) })
  await waitFor(() => expect(screen.getAllByText('detached abc1234')).toHaveLength(1))
  getBranch.mockResolvedValue({branch:null,detached:false,shortSha:null,error:'Missing directory'})
  act(() => { window.dispatchEvent(new Event('focus')) })
  await waitFor(() => expect(screen.getAllByText('Branch unavailable')).toHaveLength(1))
  expect(screen.queryByText('feat/auth')).toBeNull()
})

test('shared-directory warning uses pane paths and Windows path casing', () => {
  const ws = { ...workspace, rootPath:'C:\\Project', panes:[pane('a',null),pane('b','c:/project/'),pane('c','C:\\Trees\\auth')] }
  expect(paneGitContext(ws,ws.panes[0])).toMatchObject({rootPath:'C:\\Project',sharedCount:2,moved:false})
  expect(paneGitContext(ws,ws.panes[2]).sharedCount).toBe(1)
})

test('the branch follows a worktree the agent reports working in, and only one of the same repository', () => {
  const ws = { ...workspace, rootPath: '/project', panes: [pane('a', null)] }
  const inTree = paneGitContext(ws, ws.panes[0], { cwd: '/project-trees/fix/src', checkoutRoot: '/project-trees/fix', sameRepository: true })
  expect(inTree).toMatchObject({ rootPath: '/project-trees/fix', launchRoot: '/project', moved: true, outside: null })
  // Reporting the launch directory itself is not a move.
  expect(paneGitContext(ws, ws.panes[0], { cwd: '/project/src', checkoutRoot: '/project', sameRepository: true })).toMatchObject({ rootPath: '/project', moved: false })
  // Another repository or no repository: keep the launch branch and say where the agent is.
  expect(paneGitContext(ws, ws.panes[0], { cwd: '/elsewhere', checkoutRoot: '/elsewhere', sameRepository: false })).toMatchObject({ rootPath: '/project', moved: false, outside: '/elsewhere' })
})

test('the badge reads the worktree the agent moved into and labels it', async () => {
  const getBranch = vi.fn(async ({ rootPath }: { rootPath: string }) => ({ branch: rootPath === '/trees/agent' ? 'agent/fix' : 'main', detached: false, shortSha: null }))
  window.oxe = { ...original, git: { ...original?.git, getBranch } }
  const ws = { ...workspace, rootPath: '/project', panes: [pane('m', null)] }
  useTerminalStore.getState().setLocation('m', { cwd: '/trees/agent', checkoutRoot: '/trees/agent', sameRepository: true })
  try {
    render(<PaneBranchBadge workspace={ws} pane={ws.panes[0]} />)
    await waitFor(() => expect(screen.getByText('agent/fix')).toBeTruthy())
    expect(screen.getByTestId('pane-branch-badge')).toHaveAttribute('data-moved', 'true')
    expect(screen.getByTestId('pane-branch-badge').getAttribute('title')).toContain('Terminal opened in /project')
    // When the agent ends, the pane is back on its own branch.
    act(() => { useTerminalStore.getState().setHookStatus('m', 'ended', 1) })
    await waitFor(() => expect(screen.getByText('main')).toBeTruthy())
  } finally { useTerminalStore.getState().removePane('m') }
})
