import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import type { Workspace, WorkspacePane } from '../../shared/types/workspace'
import { PaneBranchBadge } from '../../src/components/Workspace/PaneBranchBadge'
import { AppStatusBar } from '../../src/components/Workspace/AppStatusBar'
import { __resetGitBranchCacheForTests } from '../../src/hooks/useGitBranch'
import { paneGitContext } from '../../src/utils/paneGitContext'

const pane = (id: string, rootPath: string | null) => ({ id, type: 'terminal', rootPath }) as WorkspacePane
const workspace = { id: 'branches', name: 'Project', rootPath: '/project', panes: [pane('a','/trees/auth'),pane('b','/trees/payment'),pane('c','/trees/frontend')] } as Workspace
const original = window.oxe
beforeEach(() => { __resetGitBranchCacheForTests() })
afterEach(() => { cleanup(); __resetGitBranchCacheForTests(); window.oxe = original })

test('three terminal branches agree with selected terminal status, not workspace root', async () => {
  const getBranch = vi.fn(async ({ rootPath }: {rootPath:string}) => ({ branch: `feat/${rootPath.split('/').at(-1)}`, detached: false, shortSha: null }))
  window.oxe = { ...original, git: { ...original?.git, getBranch } }
  const view = render(<>{workspace.panes.map(p => <PaneBranchBadge key={p.id} workspace={workspace} pane={p} />)}<AppStatusBar workspace={workspace} activePaneId="b" appVersion="test" /></>)
  await waitFor(() => expect(screen.getAllByText('feat/payment')).toHaveLength(2))
  expect(screen.getByText('feat/auth')).toBeTruthy()
  expect(screen.getByText('feat/frontend')).toBeTruthy()
  expect(getBranch).toHaveBeenCalledTimes(3)
  expect(getBranch.mock.calls.some(([input]) => input.rootPath === '/project')).toBe(false)
  view.unmount()
  render(<PaneBranchBadge workspace={workspace} pane={workspace.panes[0]} />)
  await waitFor(() => expect(screen.getByText('feat/auth')).toBeTruthy())
})

test('focus refresh updates all consumers, including detached HEAD and failures', async () => {
  const getBranch = vi.fn().mockResolvedValue({branch:'feat/auth',detached:false,shortSha:null})
  window.oxe = { ...original, git: { ...original?.git, getBranch } }
  render(<><PaneBranchBadge workspace={workspace} pane={workspace.panes[0]} /><AppStatusBar workspace={workspace} activePaneId="a" appVersion="test" /></>)
  await waitFor(() => expect(screen.getAllByText('feat/auth')).toHaveLength(2))
  getBranch.mockResolvedValue({branch:null,detached:true,shortSha:'abc1234'})
  act(() => { window.dispatchEvent(new Event('focus')) })
  await waitFor(() => expect(screen.getAllByText('detached abc1234')).toHaveLength(2))
  getBranch.mockResolvedValue({branch:null,detached:false,shortSha:null,error:'Missing directory'})
  act(() => { window.dispatchEvent(new Event('focus')) })
  await waitFor(() => expect(screen.getAllByText('Branch unavailable')).toHaveLength(2))
  expect(screen.queryByText('feat/auth')).toBeNull()
})

test('shared-directory warning uses pane paths and Windows path casing', () => {
  const ws = { ...workspace, rootPath:'C:\\Project', panes:[pane('a',null),pane('b','c:/project/'),pane('c','C:\\Trees\\auth')] }
  expect(paneGitContext(ws,ws.panes[0])).toEqual({rootPath:'C:\\Project',sharedCount:2})
  expect(paneGitContext(ws,ws.panes[2]).sharedCount).toBe(1)
})
