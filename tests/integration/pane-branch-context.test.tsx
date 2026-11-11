import { expect, test } from 'vitest'
import type { Workspace, WorkspacePane } from '../../shared/types/workspace'
import { paneGitContext } from '../../src/utils/paneGitContext'

// The pane's branch badge is the Panes one (CR-F4-8), fed by main's terminal.branch; its behaviour is covered by the
// F4 acceptance tests (u44-u45, crf4-8-mount). This file keeps the git context the status bar still reads.
const pane = (id: string, rootPath: string | null) => ({ id, type: 'terminal', rootPath }) as WorkspacePane
const workspace = { id: 'branches', name: 'Project', rootPath: '/project', panes: [pane('a','/trees/auth'),pane('b','/trees/payment'),pane('c','/trees/frontend')] } as Workspace

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
