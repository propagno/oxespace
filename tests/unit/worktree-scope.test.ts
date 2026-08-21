import { describe, expect, it } from 'vitest'
import { parseWorktreeStatusPorcelainV2 } from '../../electron/main/services/github/parsers'
import { isSamePath, resolveWorkspaceScope } from '../../src/utils/workspaceScope'
import type { Workspace } from '../../shared/types/workspace'

type ScopeWorkspace = Pick<Workspace, 'rootPath' | 'panes'>

function pane(id: string, rootPath: string | null): Workspace['panes'][number] {
  return {
    id,
    workspaceId: 'ws',
    type: 'terminal',
    rowIndex: 0,
    columnIndex: 0,
    shellProfileId: null,
    status: 'idle',
    agentProfileId: null,
    agentName: null,
    displayName: null,
    createdAt: null,
    rootPath
  } as Workspace['panes'][number]
}

const WORKSPACE: ScopeWorkspace = {
  rootPath: 'C:\\work\\repo',
  panes: [
    pane('pane-main', null),
    pane('pane-hotfix', 'C:\\work\\worktrees\\repo-hotfix-1284'),
    pane('pane-echo', 'C:/work/repo')
  ]
}

describe('resolveWorkspaceScope', () => {
  it('falls back to the workspace root when no pane is active', () => {
    const scope = resolveWorkspaceScope(WORKSPACE, null)
    expect(scope.rootPath).toBe('C:\\work\\repo')
    expect(scope.isWorktree).toBe(false)
    expect(scope.paneId).toBeNull()
  })

  it('follows an active pane into its worktree', () => {
    const scope = resolveWorkspaceScope(WORKSPACE, 'pane-hotfix')
    expect(scope.rootPath).toBe('C:\\work\\worktrees\\repo-hotfix-1284')
    expect(scope.isWorktree).toBe(true)
    expect(scope.folderName).toBe('repo-hotfix-1284')
    expect(scope.paneId).toBe('pane-hotfix')
  })

  it('does not treat a pane pinned to the workspace root as a worktree', () => {
    // A pane can carry an explicit rootPath equal to the workspace root, in a
    // different separator style. Reporting that as a worktree would light up
    // the badge for a pane that has not moved anywhere.
    const scope = resolveWorkspaceScope(WORKSPACE, 'pane-echo')
    expect(scope.isWorktree).toBe(false)
  })

  it('ignores the active pane while pinned', () => {
    const scope = resolveWorkspaceScope(WORKSPACE, 'pane-hotfix', true)
    expect(scope.rootPath).toBe('C:\\work\\repo')
    expect(scope.isWorktree).toBe(false)
    expect(scope.pinned).toBe(true)
  })

  it('survives an active pane id that no longer exists', () => {
    const scope = resolveWorkspaceScope(WORKSPACE, 'pane-deleted')
    expect(scope.rootPath).toBe('C:\\work\\repo')
  })
})

describe('isSamePath', () => {
  it('ignores separator style, trailing slashes and case', () => {
    expect(isSamePath('C:\\work\\repo', 'C:/work/repo/')).toBe(true)
    expect(isSamePath('c:/WORK/repo', 'C:\\work\\Repo')).toBe(true)
    expect(isSamePath('C:/work/repo', 'C:/work/repo-2')).toBe(false)
  })
})

describe('parseWorktreeStatusPorcelainV2', () => {
  it('counts modified, renamed, unmerged and untracked entries', () => {
    const raw = [
      '# branch.oid 1a2b3c4d',
      '# branch.head hotfix/1284',
      '# branch.upstream origin/hotfix/1284',
      '# branch.ab +2 -1',
      '1 .M N... 100644 100644 100644 aaa bbb src/app.ts',
      '1 M. N... 100644 100644 100644 ccc ddd src/other.ts',
      '2 R. N... 100644 100644 100644 eee fff R100 new.ts\told.ts',
      'u UU N... 100644 100644 100644 100644 ggg hhh iii merge.ts',
      '? notes.md',
      '! ignored.log'
    ].join('\n')

    expect(parseWorktreeStatusPorcelainV2(raw)).toEqual({
      dirtyCount: 4,
      untrackedCount: 1,
      ahead: 2,
      behind: 1,
      noUpstream: false
    })
  })

  it('reports a branch with no upstream, which is what "never pushed" looks like', () => {
    const raw = ['# branch.oid 1a2b3c4d', '# branch.head chore/deps'].join('\n')
    expect(parseWorktreeStatusPorcelainV2(raw)).toEqual({
      dirtyCount: 0,
      untrackedCount: 0,
      ahead: 0,
      behind: 0,
      noUpstream: true
    })
  })

  it('reads a clean worktree as clean', () => {
    const raw = [
      '# branch.oid 1a2b3c4d',
      '# branch.head main',
      '# branch.upstream origin/main',
      '# branch.ab +0 -0'
    ].join('\r\n')
    expect(parseWorktreeStatusPorcelainV2(raw)).toMatchObject({ dirtyCount: 0, untrackedCount: 0, ahead: 0, noUpstream: false })
  })

  it('returns zeroes for empty output rather than throwing', () => {
    // tryGit swallows a non-zero exit into an empty string, so this is the
    // shape a probe against a missing or broken worktree actually produces.
    expect(parseWorktreeStatusPorcelainV2('')).toEqual({
      dirtyCount: 0,
      untrackedCount: 0,
      ahead: 0,
      behind: 0,
      noUpstream: true
    })
  })
})
