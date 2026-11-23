// Frozen acceptance test for 1.5.2 OxeChat UX onda 2 (Jira OXE-323, A3–A5: the staged scope; the "last turn" scope and
// "review with another agent" wait for a design decision, see the program SPEC). Written by the planner; the executor
// must not edit it. The Changes panel compares a branch with its base or the uncommitted work against HEAD; a person
// reviewing what they are about to commit cannot see only the index. Contract:
// - shared/types/git.ts: GitCompareMode gains 'staged'. electron/main/ipc/validation.ts parseGitDiffInput accepts it.
// - electron/main/services/git.service.ts getDiffSummary(root, base, includeUncommitted, head, 'staged') lists the
//   index against HEAD only (`git diff --cached`), never the work tree nor untracked files, whatever includeUncommitted.
// - src/components/Changes/ChangesPanel.tsx: the scope Menu gains the check item "Staged changes" / "Alterações
//   preparadas" (code:changes.scope.staged), the same Menu item as the two scopes it has; choosing it asks
//   git.getDiffSummary with mode 'staged' and base HEAD.
// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { parseGitDiffInput } from '../../../electron/main/ipc/validation'
import { GitService, type SpawnGitResult } from '../../../electron/main/services/git.service'
import { useWorkspaceStore } from '../../../src/store/workspace.store'
import type { Workspace } from '../../../shared/types/workspace'
import { preloadOxe } from '../../acceptance/f4/crf4-8-preload'

vi.mock('../../../src/hooks/useGitBranch', () => ({ useGitBranch: () => ({ branch: 'main', detached: false, shortSha: null, error: null }) }))

const ok = (stdout: string): SpawnGitResult => ({ stdout, stderr: '', status: 0 })
afterEach(() => { cleanup(); vi.restoreAllMocks() })

describe('OXE-323 · the staged review scope', () => {
  test('GitService lists only the staged changes in the staged scope', async () => {
    const spawnGit = vi.fn(async (args: string[]) => {
      if (!args.includes('--cached')) return ok('')
      if (args.includes('--name-status')) return ok('M\0src/staged.ts\0')
      if (args.includes('--numstat')) return ok('3\t1\tsrc/staged.ts\0')
      return ok('')
    })
    const service = new GitService({ spawnGit } as never)
    const summary = await service.getDiffSummary('C:/repo', 'HEAD', true, undefined, 'staged' as never)
    expect(summary.files.map(file => file.path)).toEqual(['src/staged.ts'])
    const diffs = spawnGit.mock.calls.map(call => call[0] as string[]).filter(args => args.includes('diff'))
    expect(diffs.length).toBeGreaterThan(0)
    for (const args of diffs) expect(args, args.join(' ')).toContain('--cached')
    expect(spawnGit.mock.calls.some(call => (call[0] as string[]).includes('ls-files'))).toBe(false)
  })

  test('parseGitDiffInput accepts the staged mode', () => {
    expect(parseGitDiffInput({ workspaceId: 'ws-1', rootPath: 'C:/repo', base: 'HEAD', includeUncommitted: false, mode: 'staged' })).toMatchObject({ mode: 'staged' })
  })

  test('the scope menu offers Staged changes and asks for the staged diff', async () => {
    const user = userEvent.setup()
    const ipc = preloadOxe({
      'git.getBranch': () => ({ branch: 'main', shortSha: null }),
      'git.getDiffSummary': () => ({ files: [], additions: 0, deletions: 0, compiledAt: 1 }),
      'github.listBranches': () => [],
      'github.listWorktrees': () => [],
      'github.resolveWorktreeBase': () => ({ baseRef: 'main' })
    })
    const workspace = { id: 'ws-1', name: 'demo', rootPath: '/repo', defaultShellProfileId: null, panes: [] } as unknown as Workspace
    useWorkspaceStore.setState({ workspaces: [workspace], activeWorkspaceId: 'ws-1', shellProfiles: [] })
    const { WorkspaceReviewPanel } = await import('../../../src/components/Workspace/WorkspaceReviewPanel')
    render(<WorkspaceReviewPanel workspace={workspace} scope={{ rootPath: '/repo', isWorktree: false, folderName: 'repo', paneId: null } as never} isExpanded={false} onCollapse={() => undefined} onToggleExpanded={() => undefined} />)
    await screen.findByTestId('changes-panel', undefined, { timeout: 10_000 })

    await user.click(screen.getByRole('button', { name: /^Change scope:/ }))
    await user.click(await screen.findByRole('menuitemcheckbox', { name: 'Staged changes' }))
    await waitFor(() => {
      const asked = ipc.invoked.filter(([key]) => key === 'git.getDiffSummary').map(([, args]) => args[0] as { mode?: string; base?: string })
      expect(asked.at(-1)).toMatchObject({ mode: 'staged', base: 'HEAD' })
    })
  })
})
