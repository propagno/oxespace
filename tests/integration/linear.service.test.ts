import { beforeEach, describe, expect, it, vi } from 'vitest'
import { LinearService, sanitizeDirectoryName } from '../../electron/main/services/linear.service'
import type { AppDatabase } from '../../electron/main/db/index'
import type { GitHubService } from '../../electron/main/services/github.service'

vi.mock('electron', () => ({
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (value: string) => Buffer.from(`enc:${value}`, 'utf8'),
    decryptString: (buffer: Buffer) => buffer.toString('utf8').replace(/^enc:/, '')
  }
}))

/** Minimal stand-in for the two prepared statements the service uses. */
function makeDb(): AppDatabase {
  const rows = new Map<string, { payload: Buffer; encrypted: number; label: string | null }>()
  return {
    prepare: (sql: string) => ({
      run: (...args: unknown[]) => {
        if (sql.startsWith('DELETE')) rows.delete(args[0] as string)
        else rows.set(args[0] as string, { payload: args[1] as Buffer, encrypted: args[2] as number, label: args[3] as string })
        return { changes: 1 }
      },
      get: (provider: string) => rows.get(provider)
    })
  } as unknown as AppDatabase
}

function jsonResponse(body: unknown, status = 200): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as Response
}

const ISSUE = {
  id: 'issue-1',
  identifier: 'OXE-42',
  title: 'Fix the thing',
  description: null,
  url: 'https://linear.app/oxe/issue/OXE-42',
  branchName: 'eduardo/oxe-42-fix-the-thing',
  priority: 2,
  updatedAt: '2026-07-20T10:00:00.000Z',
  state: { name: 'In Progress', type: 'started', color: '#f2c94c' },
  assignee: { name: 'Eduardo' },
  team: { key: 'OXE' }
}

describe('LinearService', () => {
  let db: AppDatabase

  beforeEach(() => {
    db = makeDb()
  })

  it('validates the key before storing it, and stores it encrypted', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ data: { viewer: { name: 'Eduardo', email: 'e@x.com', organization: { name: 'OXE' } } } }))
    const service = new LinearService(db, {} as GitHubService, fetchMock as unknown as typeof fetch)

    const status = await service.setApiKey('lin_api_abc')

    expect(status).toMatchObject({ connected: true, encrypted: true, viewerName: 'Eduardo', organization: 'OXE' })
    const stored = (db.prepare('SELECT') as unknown as { get: (p: string) => { payload: Buffer } }).get('linear')
    expect(stored.payload.toString('utf8')).toBe('enc:lin_api_abc')
  })

  it('refuses to store a key the API rejects', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({}, 401))
    const service = new LinearService(db, {} as GitHubService, fetchMock as unknown as typeof fetch)

    await expect(service.setApiKey('bad')).rejects.toThrow(/rejected the API key/)
    expect((db.prepare('SELECT') as unknown as { get: (p: string) => unknown }).get('linear')).toBeUndefined()
  })

  it('reports not-connected without a stored credential', async () => {
    const service = new LinearService(db, {} as GitHubService, (async () => jsonResponse({})) as unknown as typeof fetch)
    await expect(service.getStatus()).resolves.toMatchObject({ connected: false, error: null })
  })

  it('surfaces GraphQL errors instead of returning empty lists', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ data: { viewer: { name: 'E', email: 'e@x.com' } } }))
      .mockResolvedValueOnce(jsonResponse({ errors: [{ message: 'rate limited' }] }))
    const service = new LinearService(db, {} as GitHubService, fetchMock as unknown as typeof fetch)
    await service.setApiKey('lin_api_abc')

    await expect(service.listIssues({ scope: 'assigned' })).rejects.toThrow('rate limited')
  })

  it('filters out completed issues unless asked', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ data: { viewer: { name: 'E', email: 'e@x.com' } } }))
      .mockResolvedValueOnce(jsonResponse({ data: { issues: { nodes: [ISSUE] } } }))
    const service = new LinearService(db, {} as GitHubService, fetchMock as unknown as typeof fetch)
    await service.setApiKey('lin_api_abc')

    const issues = await service.listIssues({ scope: 'assigned' })

    const body = JSON.parse((fetchMock.mock.calls[1][1] as { body: string }).body)
    expect(body.variables.filter.state).toEqual({ type: { nin: ['completed', 'canceled'] } })
    expect(body.variables.filter.assignee).toEqual({ isMe: { eq: true } })
    expect(issues[0]).toMatchObject({ identifier: 'OXE-42', priorityLabel: 'High', stateName: 'In Progress' })
  })

  it('creates a worktree on the branch Linear suggests, creating the branch when new', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ data: { viewer: { name: 'E', email: 'e@x.com' } } }))
      .mockResolvedValueOnce(jsonResponse({ data: { issue: ISSUE } }))
    const createWorktree = vi.fn(async () => ({ ok: true, message: 'created' }))
    const gitHub = {
      listWorktrees: vi.fn(async () => []),
      listBranches: vi.fn(async () => [{ name: 'main' }]),
      createWorktree
    } as unknown as GitHubService

    const service = new LinearService(db, gitHub, fetchMock as unknown as typeof fetch)
    await service.setApiKey('lin_api_abc')

    const result = await service.createWorktreeFromIssue({ workspaceId: 'ws', rootPath: 'C:/repo', issueId: 'issue-1' })

    expect(createWorktree).toHaveBeenCalledWith({
      rootPath: 'C:/repo',
      branch: 'eduardo/oxe-42-fix-the-thing',
      path: 'wt-oxe-42',
      createBranch: true
    })
    expect(result).toMatchObject({ ok: true, branch: 'eduardo/oxe-42-fix-the-thing' })
  })

  it('reuses an existing worktree instead of failing', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ data: { viewer: { name: 'E', email: 'e@x.com' } } }))
      .mockResolvedValueOnce(jsonResponse({ data: { issue: ISSUE } }))
    const gitHub = {
      listWorktrees: vi.fn(async () => [{ branch: 'eduardo/oxe-42-fix-the-thing', path: 'C:/wt-oxe-42' }]),
      listBranches: vi.fn(async () => []),
      createWorktree: vi.fn()
    } as unknown as GitHubService

    const service = new LinearService(db, gitHub, fetchMock as unknown as typeof fetch)
    await service.setApiKey('lin_api_abc')

    const result = await service.createWorktreeFromIssue({ workspaceId: 'ws', rootPath: 'C:/repo', issueId: 'issue-1' })

    expect(gitHub.createWorktree).not.toHaveBeenCalled()
    expect(result.worktreePath).toBe('C:/wt-oxe-42')
  })
})

describe('sanitizeDirectoryName', () => {
  it('keeps worktree directory names inert', () => {
    expect(sanitizeDirectoryName('OXE-42')).toBe('wt-oxe-42')
    expect(sanitizeDirectoryName('../../etc/passwd')).toBe('wt-etc-passwd')
    expect(sanitizeDirectoryName('!!!')).toBe('wt-linear')
  })
})
