import { afterEach, describe, expect, it, vi } from 'vitest'
// Registry first, as the app loads it: the handlers and the registry import each other.
import { TOOL_REGISTRY, type ToolContext } from '../../electron/main/mcp-internal/tool-registry'
import { AgentActions } from '../../electron/main/services/agent-actions/agent-actions'
import { ApprovalBroker, type ApprovalDecision, type ApprovalRequest } from '../../electron/main/services/agent-actions/approval-broker'
import { setPolicyStore } from '../../electron/main/services/policy'
import type { PolicyStore } from '../../electron/main/services/policy/policy-store'

vi.mock('../../electron/main/vendor/codegraph/mcp/tools', () => ({ ToolHandler: class { execute = vi.fn() } }))

const groups = [
  { id: 'g-mine', name: 'Checkout', members: [{ workspaceId: 'ws-1' }] },
  { id: 'g-other', name: 'Billing', members: [{ workspaceId: 'ws-2' }] }
]
vi.mock('../../electron/main/services/integration.service', () => ({
  IntegrationService: class {
    listGroups(workspaceId?: string | null) { return groups.filter(group => group.members.some(member => member.workspaceId === workspaceId)) }
    listHandoffs(groupId: string) { return [{ id: 'h1', groupId, title: 'API ready', content: 'see /v2' }] }
  }
}))

const sessions = [
  { sessionId: 'old', lastUpdatedMs: 1, filePath: '/home/me/.claude/projects/x/old.jsonl', firstMessagePreview: 'first' },
  { sessionId: 'new', lastUpdatedMs: 9, filePath: '/home/me/.claude/projects/x/new.jsonl', firstMessagePreview: 'second' }
]
const listSessions = vi.fn((_workspaceId: string, _root: string, _provider: string) => sessions)
vi.mock('../../electron/main/services/session.service', () => ({ SessionService: class { listSessions = listSessions } }))

const WS = { id: 'ws-1', rootPath: '/repo', name: 'repo', isActive: true, layout: '1x2', layoutPreset: 2, themeId: 'midnight', uiDensity: 'compact',
  defaultShellProfileId: 'pwsh', autoStart: false, editorWidthPercent: 40, panes: [{ id: 'p1' }, { id: 'p2' }] }

function setup(options: { decide?: ApprovalDecision; live?: boolean; owner?: { kind: 'pane' | 'thread'; id: string }; workspaceId?: string; app?: unknown; semantic?: unknown; db?: unknown } = {}) {
  const asked: ApprovalRequest[] = []
  const broker = new ApprovalBroker({ ask: async request => { asked.push(request); return options.decide ?? 'allow-once' } }, Date.now, 50)
  const execution = { id: 'e1', owner: options.owner ?? { kind: 'pane', id: 'p1' }, workspaceId: options.workspaceId ?? WS.id, canonicalRoot: '/repo', cwd: '/repo' }
  const ctx = {
    workspaceId: execution.workspaceId, executionId: 'e1', executionToken: 't',
    workspaceServ: { get: (id: string) => id === WS.id ? WS : null, list: () => [WS] },
    executions: { authenticate: () => { if (options.live === false) throw new Error('none'); return execution } },
    agentActions: new AgentActions({ broker }), app: options.app, semantic: options.semantic, db: options.db ?? {},
    github: { createWorktree: vi.fn(async () => ({ ok: true })), removeWorktree: vi.fn(async () => ({ ok: true })), resolveWorktreeBase: vi.fn(async () => ({ baseRef: 'origin/main' })) },
    background: { start: vi.fn(() => ({ id: 'job-1', status: 'running' })), list: () => [{ id: 'job-1' }], stop: vi.fn() },
    fileSystem: {}, worktree: { emitChanged: vi.fn() }
  } as unknown as ToolContext
  return { asked, ctx }
}

async function call(name: string, args: Record<string, unknown>, ctx: ToolContext) {
  const result = await TOOL_REGISTRY.find(entry => entry.descriptor.name === name)!.handler(args, ctx)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return JSON.parse(result.content[0].text) as { ok?: boolean; code?: string; result?: any; [key: string]: any }
}

afterEach(() => setPolicyStore(undefined as unknown as null))

describe('oxespace_settings', () => {
  it('reads the Code workspace without panel sizes, and refuses a Thread', async () => {
    const { ctx } = setup()
    const { result } = await call('oxespace_settings', { action: 'workspace' }, ctx)
    expect(result).toEqual({ id: 'ws-1', name: 'repo', rootPath: '/repo', layout: '1x2', layoutPreset: 2, themeId: 'midnight', uiDensity: 'compact', defaultShellProfileId: 'pwsh', autoStart: false, paneCount: 2 })
    expect(await call('oxespace_settings', { action: 'workspace' }, setup({ owner: { kind: 'thread', id: 't1' }, workspaceId: 'thread:t1' }).ctx)).toMatchObject({ ok: false, code: 'no-workspace' })
  })

  it('shows the policy in force for the project, without file paths', async () => {
    const load = vi.fn(() => ({ sources: [{ layer: 'managed', path: 'C:/ProgramData/OXESpace/policy.json', organization: 'Acme', rules: [{ effect: 'deny', action: 'tool.use', resource: 'oxespace_db_execute' }] }], problems: [] }))
    setPolicyStore({ load } as unknown as PolicyStore)
    const { result } = await call('oxespace_settings', { action: 'policy' }, setup().ctx)
    expect(load).toHaveBeenCalledWith('/repo')
    expect(result).toEqual({ sources: [{ layer: 'managed', organization: 'Acme', rules: [{ effect: 'deny', action: 'tool.use', resource: 'oxespace_db_execute' }] }], problems: [] })
    setPolicyStore(null)
    expect((await call('oxespace_settings', { action: 'policy' }, setup().ctx)).result).toEqual({ sources: [], problems: [] })
  })

  it('reads the semantic index of a workspace or a Thread project, never the last query', async () => {
    const getStatus = vi.fn(() => ({ enabled: true, indexing: false, count: 3, lastError: null, lastQuery: { query: 'private words' } }))
    const workspace = await call('oxespace_settings', { action: 'semantic' }, setup({ semantic: { getStatus } }).ctx)
    expect(getStatus).toHaveBeenLastCalledWith('ws-1')
    expect(workspace.result).toEqual({ enabled: true, indexing: false, count: 3, lastError: null })
    await call('oxespace_settings', { action: 'semantic' }, setup({ semantic: { getStatus }, owner: { kind: 'thread', id: 't1' }, workspaceId: 'thread:t1' }).ctx)
    expect(getStatus).toHaveBeenLastCalledWith(expect.stringMatching(/^project:/))
  })
})

describe('oxespace_integration', () => {
  it('lists only this workspace\'s groups and their handoffs', async () => {
    const { ctx } = setup()
    expect((await call('oxespace_integration', { action: 'groups' }, ctx)).result.map((group: { id: string }) => group.id)).toEqual(['g-mine'])
    expect(await call('oxespace_integration', { action: 'handoffs', groupId: 'g-mine' }, ctx)).toMatchObject({ ok: true, result: [{ id: 'h1', groupId: 'g-mine' }] })
    expect(await call('oxespace_integration', { action: 'handoffs', groupId: 'g-other' }, ctx)).toMatchObject({ ok: false, code: 'not-found' })
    expect(await call('oxespace_integration', { action: 'handoffs' }, ctx)).toMatchObject({ ok: false, code: 'invalid' })
  })
})

describe('oxespace_threads native_sessions', () => {
  it('lists the folder\'s CLI sessions newest first, without transcript paths', async () => {
    const { result } = await call('oxespace_threads', { action: 'native_sessions', provider: 'codex', limit: 1 }, setup().ctx)
    expect(listSessions).toHaveBeenCalledWith('ws-1', '/repo', 'codex')
    expect(result).toEqual({ items: [{ sessionId: 'new', lastUpdatedMs: 9, firstMessagePreview: 'second' }], total: 2, truncated: true })
  })
})

describe('checkpoints', () => {
  const checkpoints = [{ id: 'c1', workspaceId: 'ws-1', name: 'before refactor', description: null, branch: 'main', baseCommit: 'abc', patch: 'diff --git a b', untrackedFiles: ['x.ts'], createdAt: 5 }]
  const github = () => ({ listCheckpoints: vi.fn(() => checkpoints), deleteCheckpoint: vi.fn(() => ({ ok: true, message: 'removed' })) })

  it('lists them for restore, without the patch', async () => {
    const service = github()
    const { result } = await call('oxespace_git', { action: 'checkpoints' }, setup({ app: { github: service } }).ctx)
    expect(service.listCheckpoints).toHaveBeenCalledWith({ workspaceId: 'ws-1', rootPath: '/repo' })
    expect(result).toEqual([{ id: 'c1', name: 'before refactor', description: null, branch: 'main', baseCommit: 'abc', createdAt: 5, patchChars: 14, untrackedFiles: 1 }])
  })

  it('deletes one of this workspace after a person approves it', async () => {
    const service = github()
    const { asked, ctx } = setup({ app: { github: service } })
    expect(await call('oxespace_git_change', { action: 'delete_checkpoint', checkpointId: 'c1' }, ctx)).toMatchObject({ ok: true })
    expect(asked[0]).toMatchObject({ summary: expect.objectContaining({ code: 'approvals.summary.mcpConfirm', params: expect.objectContaining({ tool: 'oxespace_git_change', action: 'delete_checkpoint' }) }), text: 'Delete checkpoint "before refactor"\nin /repo' })
    expect(service.deleteCheckpoint).toHaveBeenCalledWith({ checkpointId: 'c1' })
  })

  it('refuses another workspace\'s id and a declined request', async () => {
    const service = github()
    expect(await call('oxespace_git_change', { action: 'delete_checkpoint', checkpointId: 'c9' }, setup({ app: { github: service } }).ctx)).toMatchObject({ ok: false, code: 'not-found' })
    expect(await call('oxespace_git_change', { action: 'delete_checkpoint', checkpointId: 'c1' }, setup({ app: { github: service }, decide: 'deny' }).ctx)).toMatchObject({ ok: false, code: 'denied' })
    expect(service.deleteCheckpoint).not.toHaveBeenCalled()
  })
})

describe('workspace tools behind the policy door', () => {
  it('refuse a caller without a live execution and do nothing', async () => {
    const { ctx } = setup({ live: false })
    for (const [name, args] of [['oxespace_create_worktree', { path: '../wt', branch: 'x' }], ['oxespace_remove_worktree', { path: '../wt' }],
      ['oxespace_run_script', { scriptId: 'build' }], ['oxespace_stop_background_job', { jobId: 'job-1' }]] as const) {
      expect(await call(name, args, ctx), name).toMatchObject({ ok: false, code: 'no-execution' })
    }
    expect(ctx.github.createWorktree).not.toHaveBeenCalled()
    expect(ctx.github.removeWorktree).not.toHaveBeenCalled()
    expect(ctx.background.stop).not.toHaveBeenCalled()
  })

  it('create a worktree and stop a job for a live execution without asking', async () => {
    const { asked, ctx } = setup()
    await call('oxespace_create_worktree', { path: '../wt', branch: 'x' }, ctx)
    await call('oxespace_stop_background_job', { jobId: 'job-1' }, ctx)
    expect(ctx.github.createWorktree).toHaveBeenCalled()
    expect(ctx.background.stop).toHaveBeenCalledWith('job-1')
    expect(asked).toHaveLength(0)
  })

  it('remove a worktree only after a person approves the exact command', async () => {
    const declined = setup({ decide: 'deny' })
    expect(await call('oxespace_remove_worktree', { path: '../wt', force: true }, declined.ctx)).toMatchObject({ ok: false, code: 'denied' })
    expect(declined.asked[0].text).toBe('git worktree remove --force ../wt\nfrom /repo')
    expect(declined.asked[0].notes).toContainEqual({ code: 'approvals.note.worktree.forceDiscards', params: {} })
    expect(declined.ctx.github.removeWorktree).not.toHaveBeenCalled()
    const approved = setup()
    await call('oxespace_remove_worktree', { path: '../wt' }, approved.ctx)
    expect(approved.ctx.github.removeWorktree).toHaveBeenCalledWith({ rootPath: '/repo', path: '../wt', force: false })
  })
})
