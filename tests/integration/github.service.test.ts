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
})
