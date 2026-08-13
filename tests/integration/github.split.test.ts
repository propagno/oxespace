/**
 * Guards the one property the GitHubService split can silently lose.
 *
 * The four collaborators run over a single GhExec because the CLI and
 * repository caches live there. Give each its own kernel instead and everything
 * still compiles, every existing test still passes, and the app just starts
 * paying `gh auth status` + `gh api user` again on every tab switch — three
 * extra process spawns each time, invisible except as lag.
 *
 * So these assert on spawn counts across methods that belong to DIFFERENT
 * collaborators. github.service.test.ts covers behavior; this covers the seam.
 */
import { describe, expect, test, vi } from 'vitest'
import { openInMemoryDatabase } from '../../electron/main/db/index'
import { GitHubService } from '../../electron/main/services/github.service'

/** Answers whatever any of git/gh is asked with a plausible empty result. */
function makeSpawn() {
  return vi.fn().mockImplementation((command: string, args: string[]) => {
    if (command.includes('gh') && args[0] === 'api') {
      return Promise.resolve({ stdout: 'octocat', stderr: '', status: 0, error: undefined })
    }
    return Promise.resolve({ stdout: '[]', stderr: '', status: 0, error: undefined })
  })
}

function countGhAuthProbes(spawn: ReturnType<typeof makeSpawn>): number {
  return spawn.mock.calls.filter(([, args]) => (args as string[])[0] === 'auth').length
}

describe('GitHubService composition', () => {
  test('the CLI probe is paid once across collaborators, not once per collaborator', async () => {
    const db = openInMemoryDatabase()
    const spawn = makeSpawn()
    const service = new GitHubService(db, { spawnCommand: spawn, now: () => 1_700_000_000_000 })
    const input = { workspaceId: 'ws-1', rootPath: 'C:/repo' }

    // One call into each of the three gh-backed collaborators.
    await service.listPullRequests({ ...input, state: 'open' })  // review
    await service.listWorkflows(input)                            // actions
    await service.listReleases(input)                             // review

    // `now` is frozen, so the 30s TTL cannot expire between them. Four probes
    // here would mean four kernels.
    expect(countGhAuthProbes(spawn)).toBe(1)

    db.close()
  })

  test('concurrent callers in different collaborators share one in-flight probe', async () => {
    const db = openInMemoryDatabase()
    const spawn = makeSpawn()
    const service = new GitHubService(db, { spawnCommand: spawn, now: () => 1_700_000_000_000 })
    const input = { workspaceId: 'ws-1', rootPath: 'C:/repo' }

    // The GitHub panel opens several tabs at once; without in-flight dedupe
    // each would start its own probe before any of them could populate a cache.
    await Promise.all([
      service.listPullRequests({ ...input, state: 'open' }),
      service.listWorkflows(input),
      service.listReleases(input),
      service.listWorkflowRuns(input)
    ])

    expect(countGhAuthProbes(spawn)).toBe(1)

    db.close()
  })

  test('invalidateCaches reaches the kernel the collaborators actually read', async () => {
    const db = openInMemoryDatabase()
    const spawn = makeSpawn()
    let clock = 1_700_000_000_000
    const service = new GitHubService(db, { spawnCommand: spawn, now: () => clock })

    await service.listCommits({ workspaceId: 'ws-1', rootPath: 'C:/repo' })
    const before = spawn.mock.calls.filter(([, args]) => (args as string[])[0] === 'remote').length
    expect(before).toBeGreaterThan(0)

    service.invalidateCaches('C:/repo')
    clock += 1 // still well inside the 60s TTL, so only the invalidation can explain a refetch
    await service.listCommits({ workspaceId: 'ws-1', rootPath: 'C:/repo' })

    const after = spawn.mock.calls.filter(([, args]) => (args as string[])[0] === 'remote').length
    expect(after, 'the façade must invalidate the cache the review collaborator reads').toBeGreaterThan(before)

    db.close()
  })
})
