import { describe, expect, test, vi } from 'vitest'
import { openInMemoryDatabase } from '../../electron/main/db/index'
import { GitHubService } from '../../electron/main/services/github.service'
import { WorkspaceService } from '../../electron/main/services/workspace.service'

function makeSpawn(stdout = '', status = 0) {
  return vi.fn().mockResolvedValue({ stdout, stderr: '', status, error: undefined })
}

describe('GitHubService', () => {
  test('creates, lists, and deletes checkpoints', async () => {
    const db = openInMemoryDatabase()
    const ws = new WorkspaceService(db).create({ rootPath: 'C:/projects/repo', layoutPreset: 4 })
    const spawn = makeSpawn('main')
    const service = new GitHubService(db, { spawnCommand: spawn, now: () => 1_700_000_000_000 })

    const cp = await service.createCheckpoint({ workspaceId: ws.id, rootPath: 'C:/projects/repo', name: 'snap-1', description: 'before refactor' })
    expect(cp.workspaceId).toBe(ws.id)
    expect(cp.name).toBe('snap-1')
    expect(cp.description).toBe('before refactor')
    expect(cp.branch).toBe('main')
    expect(cp.createdAt).toBe(1_700_000_000_000)
    expect(typeof cp.id).toBe('string')

    const list = service.listCheckpoints({ workspaceId: ws.id, rootPath: 'C:/projects/repo' })
    expect(list).toHaveLength(1)
    expect(list[0].id).toBe(cp.id)

    const result = service.deleteCheckpoint({ checkpointId: cp.id })
    expect(result.ok).toBe(true)
    expect(service.listCheckpoints({ workspaceId: ws.id, rootPath: 'C:/projects/repo' })).toHaveLength(0)

    db.close()
  })

  test('checkpoints are isolated per workspace', async () => {
    const db = openInMemoryDatabase()
    const svc = new WorkspaceService(db)
    const ws1 = svc.create({ rootPath: 'C:/projects/a', layoutPreset: 4 })
    const ws2 = svc.create({ rootPath: 'C:/projects/b', layoutPreset: 4 })
    const service = new GitHubService(db, { spawnCommand: makeSpawn('main') })

    await service.createCheckpoint({ workspaceId: ws1.id, rootPath: 'C:/projects/a', name: 'snap-ws1' })
    await service.createCheckpoint({ workspaceId: ws2.id, rootPath: 'C:/projects/b', name: 'snap-ws2' })

    expect(service.listCheckpoints({ workspaceId: ws1.id, rootPath: 'C:/projects/a' })).toHaveLength(1)
    expect(service.listCheckpoints({ workspaceId: ws2.id, rootPath: 'C:/projects/b' })).toHaveLength(1)
    expect(service.listCheckpoints({ workspaceId: ws1.id, rootPath: 'C:/projects/a' })[0].name).toBe('snap-ws1')

    db.close()
  })

  test('connects and lists repositories', () => {
    const db = openInMemoryDatabase()
    const ws = new WorkspaceService(db).create({ rootPath: 'C:/projects/repo', layoutPreset: 4 })
    const service = new GitHubService(db, { spawnCommand: makeSpawn() })

    const connected = service.connectRepository({ workspaceId: ws.id, rootPath: 'C:/projects/repo', fullName: 'org/repo', url: 'https://github.com/org/repo' })
    expect(connected.workspaceId).toBe(ws.id)
    expect(connected.fullName).toBe('org/repo')
    expect(connected.url).toBe('https://github.com/org/repo')

    const repos = service.listConnectedRepositories({ workspaceId: ws.id, rootPath: 'C:/projects/repo' })
    expect(repos).toHaveLength(1)
    expect(repos[0].fullName).toBe('org/repo')

    db.close()
  })

  test('connecting the same repository twice upserts the url', () => {
    const db = openInMemoryDatabase()
    const ws = new WorkspaceService(db).create({ rootPath: 'C:/projects/repo', layoutPreset: 4 })
    const service = new GitHubService(db, { spawnCommand: makeSpawn() })

    service.connectRepository({ workspaceId: ws.id, rootPath: 'C:/projects/repo', fullName: 'org/repo' })
    service.connectRepository({ workspaceId: ws.id, rootPath: 'C:/projects/repo', fullName: 'org/repo', url: 'https://github.com/org/repo' })

    const repos = service.listConnectedRepositories({ workspaceId: ws.id, rootPath: 'C:/projects/repo' })
    expect(repos).toHaveLength(1)
    expect(repos[0].url).toBe('https://github.com/org/repo')

    db.close()
  })

  test('returns workflow run details with runtime jobs and steps', async () => {
    const runPayload = JSON.stringify({
      databaseId: 42,
      name: 'Workflow Sandbox',
      displayTitle: 'Workflow Sandbox #60',
      status: 'in_progress',
      conclusion: null,
      event: 'workflow_dispatch',
      headBranch: 'feature/test',
      url: 'https://github.com/org/repo/actions/runs/42',
      createdAt: '2026-05-20T17:32:00Z',
      jobs: [
        {
          databaseId: 10,
          name: 'call-build / Mend',
          status: 'in_progress',
          conclusion: null,
          startedAt: '2026-05-20T17:33:00Z',
          completedAt: null,
          steps: [
            { number: 1, name: 'Set up Maven', status: 'completed', conclusion: 'success', startedAt: '2026-05-20T17:33:01Z', completedAt: '2026-05-20T17:33:10Z' },
            { number: 2, name: 'Mend Scan', status: 'in_progress', conclusion: null, startedAt: '2026-05-20T17:33:11Z', completedAt: null }
          ]
        }
      ]
    })
    const spawn = vi.fn(async (_command: string, args: string[]) => {
      if (args[0] === '--version') return { stdout: 'gh version 2.0.0', stderr: '', status: 0, error: undefined }
      if (args[0] === 'auth') return { stdout: '', stderr: '', status: 0, error: undefined }
      if (args[0] === 'api') return { stdout: 'dudu\n', stderr: '', status: 0, error: undefined }
      if (args[0] === 'run' && args[1] === 'view') return { stdout: runPayload, stderr: '', status: 0, error: undefined }
      return { stdout: '', stderr: '', status: 0, error: undefined }
    })
    const service = new GitHubService({} as ReturnType<typeof openInMemoryDatabase>, { spawnCommand: spawn })

    const details = await service.getWorkflowRunDetails({ rootPath: 'C:/projects/repo', runId: 42 })

    expect(details.databaseId).toBe(42)
    expect(details.status).toBe('in_progress')
    expect(details.jobs).toHaveLength(1)
    expect(details.jobs[0].name).toBe('call-build / Mend')
    expect(details.jobs[0].steps[1]).toMatchObject({ name: 'Mend Scan', status: 'in_progress', conclusion: null })
    expect(spawn).toHaveBeenCalledWith(
      'gh',
      expect.arrayContaining(['run', 'view', '42', '--json']),
      expect.objectContaining({ cwd: 'C:/projects/repo' })
    )
  })

  test('listWorktrees marks the main worktree as isMain even when workspace.rootPath uses backslashes', async () => {
    // Reproduces the bug seen on Windows: the workspace was saved with
    // backslash separators ("C:\\Users\\dudu-") but `git worktree list
    // --porcelain` emits forward slashes ("C:/Users/dudu-"). Without
    // normalizing, isMain is never true and the renderer offered a remove
    // button for the primary worktree.
    const porcelain = [
      'worktree C:/Users/dudu-',
      'HEAD abc123',
      'branch refs/heads/master',
      '',
      'worktree C:/Users/dudu-feat',
      'HEAD def456',
      'branch refs/heads/feat/x'
    ].join('\n')
    const spawn = vi.fn().mockResolvedValue({ stdout: porcelain, stderr: '', status: 0, error: undefined })
    const service = new GitHubService({} as ReturnType<typeof openInMemoryDatabase>, { spawnCommand: spawn })

    const trees = await service.listWorktrees({ rootPath: 'C:\\Users\\dudu-' })
    expect(trees).toHaveLength(2)
    expect(trees[0]).toMatchObject({ branch: 'master', isMain: true })
    expect(trees[1]).toMatchObject({ branch: 'feat/x', isMain: false })
  })

  test('listWorktrees falls back to the first worktree as main when paths cannot be matched', async () => {
    // Safety net: if normalization still fails to align, porcelain emits
    // the main worktree first — never present a state with zero mains.
    const porcelain = [
      'worktree /tmp/symlink-target',
      'HEAD abc123',
      'branch refs/heads/main',
      '',
      'worktree /tmp/symlink-target-feat',
      'HEAD def456',
      'branch refs/heads/feat'
    ].join('\n')
    const spawn = vi.fn().mockResolvedValue({ stdout: porcelain, stderr: '', status: 0, error: undefined })
    const service = new GitHubService({} as ReturnType<typeof openInMemoryDatabase>, { spawnCommand: spawn })

    const trees = await service.listWorktrees({ rootPath: '/some/other/path' })
    expect(trees).toHaveLength(2)
    expect(trees[0].isMain).toBe(true)
    expect(trees[1].isMain).toBe(false)
  })

  test('fetch runs git fetch --all --prune', async () => {
    const spawn = vi.fn().mockResolvedValue({ stdout: '', stderr: '', status: 0, error: undefined })
    const service = new GitHubService({} as ReturnType<typeof openInMemoryDatabase>, { spawnCommand: spawn })

    const result = await service.fetch({ workspaceId: 'ws-1', rootPath: 'C:/projects/repo' })
    expect(result.ok).toBe(true)
    expect(spawn).toHaveBeenCalledWith(
      'git',
      ['fetch', '--all', '--prune'],
      expect.objectContaining({ cwd: 'C:/projects/repo' })
    )
  })

  test('pullFfOnly rejects dirty working trees and pulls when clean', async () => {
    const dirtySpawn = vi.fn(async (_cmd: string, args: string[]) => {
      if (args[0] === 'status') return { stdout: ' M src/a.ts\n', stderr: '', status: 0, error: undefined }
      return { stdout: '', stderr: '', status: 0, error: undefined }
    })
    const dirtyService = new GitHubService({} as ReturnType<typeof openInMemoryDatabase>, { spawnCommand: dirtySpawn })
    await expect(dirtyService.pullFfOnly({ workspaceId: 'ws-1', rootPath: 'C:/projects/repo' }))
      .rejects.toThrow(/commit ou stash/i)

    const cleanSpawn = vi.fn(async (_cmd: string, args: string[]) => {
      if (args[0] === 'status') return { stdout: '', stderr: '', status: 0, error: undefined }
      return { stdout: '', stderr: '', status: 0, error: undefined }
    })
    const cleanService = new GitHubService({} as ReturnType<typeof openInMemoryDatabase>, { spawnCommand: cleanSpawn })
    const result = await cleanService.pullFfOnly({ workspaceId: 'ws-1', rootPath: 'C:/projects/repo' })
    expect(result.ok).toBe(true)
    expect(cleanSpawn).toHaveBeenCalledWith(
      'git',
      ['pull', '--ff-only'],
      expect.objectContaining({ cwd: 'C:/projects/repo' })
    )
  })
})
