import { describe, expect, test, vi } from 'vitest'
import { GitService, type SpawnGitResult } from '../../electron/main/services/git.service'

function result(stdout = '', status = 0, stderr = ''): SpawnGitResult {
  return { stdout, stderr, status }
}

describe('GitService', () => {
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
