import { describe, expect, test, vi } from 'vitest'
import { GitService, parseGitControlStatus, type SpawnGitResult } from '../../electron/main/services/git.service'

function result(stdout = '', status = 0, stderr = ''): SpawnGitResult {
  return { stdout, stderr, status }
}

describe('GitService', () => {
  test('parses porcelain v2 changes, conflicts, renames and branch divergence without losing paths', () => {
    const raw = [
      '# branch.oid abc', '# branch.head feature/test', '# branch.upstream origin/feature/test', '# branch.ab +2 -1',
      '1 .M N... 100644 100644 100644 aaa bbb src/file with spaces.ts',
      '2 R. N... 100644 100644 100644 aaa bbb R100 docs/new name.md', 'docs/old name.md',
      'u UU N... 100644 100644 100644 100644 aaa bbb ccc src/conflict.ts',
      '? new folder/', ''
    ].join('\0')
    const status = parseGitControlStatus(raw)
    expect(status).toMatchObject({ branch: 'feature/test', upstream: 'origin/feature/test', ahead: 2, behind: 1 })
    expect(status.files).toEqual([
      { path: 'src/file with spaces.ts', staged: false, unstaged: true, untracked: false, conflicted: false, status: '.M' },
      { path: 'docs/new name.md', staged: true, unstaged: false, untracked: false, conflicted: false, status: 'R.' },
      { path: 'src/conflict.ts', staged: true, unstaged: true, untracked: false, conflicted: true, status: 'UU' },
      { path: 'new folder/', staged: false, unstaged: true, untracked: true, conflicted: false, status: '?' }
    ])
  })

  test('reads local Git status without invoking GitHub CLI', async () => {
    const spawnGit = vi.fn().mockResolvedValue(result('# branch.head main\0? notes.md\0'))
    const service = new GitService({ spawnGit })
    await expect(service.getStatus('C:/repo')).resolves.toMatchObject({ branch: 'main', files: [{ path: 'notes.md', untracked: true }] })
    expect(spawnGit).toHaveBeenCalledTimes(1)
    expect(spawnGit.mock.calls[0][0]).toContain('--porcelain=v2')
  })
  test('reads the current branch from a normal work tree', async () => {
    const spawnGit = vi.fn()
      .mockResolvedValueOnce(result('true\n'))
      .mockResolvedValueOnce(result('codex/workspace-customization-release\n'))
    const service = new GitService({ spawnGit })

    await expect(service.getBranch('C:/repo')).resolves.toEqual({
      branch: 'codex/workspace-customization-release',
      detached: false,
      shortSha: null,
      error: null
    })
  })

  test('falls back to rev-parse when branch --show-current is empty', async () => {
    const spawnGit = vi.fn()
      .mockResolvedValueOnce(result('true\n'))
      .mockResolvedValueOnce(result('\n'))
      .mockResolvedValueOnce(result('feature/fallback\n'))
    const service = new GitService({ spawnGit })

    await expect(service.getBranch('C:/repo')).resolves.toMatchObject({
      branch: 'feature/fallback',
      detached: false,
      shortSha: null
    })
  })

  test('returns detached sha when HEAD is detached', async () => {
    const spawnGit = vi.fn()
      .mockResolvedValueOnce(result('true\n'))
      .mockResolvedValueOnce(result('\n'))
      .mockResolvedValueOnce(result('HEAD\n'))
      .mockResolvedValueOnce(result('', 1, 'not symbolic'))
      .mockResolvedValueOnce(result('abc1234\n'))
    const service = new GitService({ spawnGit })

    await expect(service.getBranch('C:/repo')).resolves.toEqual({
      branch: null,
      detached: true,
      shortSha: 'abc1234',
      error: null
    })
  })
})
