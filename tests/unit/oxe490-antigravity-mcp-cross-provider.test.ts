// @vitest-environment node
import { randomUUID } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import { openInMemoryDatabase } from '../../electron/main/db'
import { AGENT_CHANGE_TOOLS, _resetAgentOwnersForTests } from '../../electron/main/mcp-internal/agent-tools'
import { APP_MANAGE_TOOLS } from '../../electron/main/mcp-internal/app-manage-tools'
import { APP_READ_TOOLS } from '../../electron/main/mcp-internal/app-read-tools'
import { APP_WRITE_TOOLS } from '../../electron/main/mcp-internal/app-write-tools'
import { findTool, type ToolContext } from '../../electron/main/mcp-internal/tool-registry'
import { AgentActions } from '../../electron/main/services/agent-actions/agent-actions'
import { ApprovalBroker, type ApprovalRequest } from '../../electron/main/services/agent-actions/approval-broker'
import type { ThreadManager } from '../../electron/main/services/conversation/thread-manager'
import { DelegationRepository } from '../../electron/main/services/delegation/delegation.repository'
import { ThreadDelegationHost } from '../../electron/main/services/delegation/thread-delegation-host'
import { ExecutionRegistry } from '../../electron/main/services/execution-registry'
import type { WorkspaceAccessLevel } from '../../shared/access-ceiling'
import type { DelegationTask } from '../../shared/types/delegation'
import type { ConversationThread, ThreadSnapshot } from '../../shared/types/thread'

const WS = { id: 'ws-1', rootPath: '/repo', name: 'repo', isActive: true, panes: [{ id: 'pane-1' }] }

function makeCtx(options: {
  owner?: { kind: 'pane' | 'thread'; id: string }
  workspaceId?: string
  root?: string
  access?: WorkspaceAccessLevel
  workspaceCeiling?: WorkspaceAccessLevel
  app?: ToolContext['app']
  threads?: unknown
  db?: unknown
  asked?: ApprovalRequest[]
} = {}): ToolContext {
  const owner = options.owner ?? { kind: 'pane', id: 'pane-1' }
  const ws = { ...WS, ...(options.workspaceCeiling ? { accessCeiling: options.workspaceCeiling } : {}) }
  const execution = {
    id: 'exec-1',
    owner,
    workspaceId: options.workspaceId ?? ws.id,
    canonicalRoot: options.root ?? '/repo',
    cwd: options.root ?? '/repo',
    ...(options.access ? { access: options.access } : {})
  }
  const asked = options.asked ?? []
  const broker = new ApprovalBroker({ ask: async req => { asked.push(req); return 'allow-once' } }, Date.now, 50)
  return {
    workspaceId: execution.workspaceId,
    executionId: 'exec-1',
    executionToken: 'tok-1',
    workspaceServ: { get: (id: string) => id === ws.id ? ws : null, list: () => [ws] },
    executions: { authenticate: () => execution },
    agentActions: new AgentActions({ broker }),
    app: options.app,
    threads: options.threads,
    db: options.db
  } as unknown as ToolContext
}

async function callDomain(name: string, args: Record<string, unknown>, ctx: ToolContext) {
  const entry = [...APP_READ_TOOLS, ...APP_WRITE_TOOLS, ...APP_MANAGE_TOOLS, ...AGENT_CHANGE_TOOLS]
    .find(tool => tool.descriptor.name === name)!
  const result = await entry.handler(args, ctx)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return JSON.parse(result.content[0].text) as { ok: boolean; code?: string; message?: string; result?: any }
}

describe('OXE-490 · Antigravity cross-provider MCP discoverability and UX', () => {
  it('advertises Claude Code, Codex, and Antigravity across thread, usage, skill, and agent schemas', () => {
    const threadsTool = findTool('oxespace_threads')!
    const threadsChangeTool = findTool('oxespace_threads_change')!
    const usageTool = findTool('oxespace_usage')!
    const skillsChangeTool = findTool('oxespace_skills_change')!
    const threadCreateTool = findTool('oxespace_thread_create')!
    const listAgentsTool = findTool('oxespace_list_agents')!

    expect(threadsTool.descriptor.description).toMatch(/Claude Code.*Codex.*Antigravity/i)
    expect(threadsTool.descriptor.description).toMatch(/list/i)
    expect(threadsTool.descriptor.description).toMatch(/Read-Only/i)
    expect(threadsChangeTool.descriptor.description).toMatch(/Claude Code.*Codex.*Antigravity/i)
    expect(listAgentsTool.descriptor.description).toMatch(/Antigravity/i)

    const threadsProps = threadsTool.descriptor.inputSchema.properties as Record<string, { enum?: string[] }>
    expect(threadsProps.provider.enum).toEqual(['claude', 'codex', 'antigravity'])

    const usageProps = usageTool.descriptor.inputSchema.properties as Record<string, { enum?: string[] }>
    expect(usageProps.provider.enum).toEqual(['claude', 'codex', 'antigravity'])

    const skillsProps = skillsChangeTool.descriptor.inputSchema.properties as Record<string, { items?: { enum?: string[] }; maxItems?: number }>
    expect(skillsProps.agents.items?.enum).toEqual(['claude', 'codex', 'antigravity'])
    expect(skillsProps.agents.maxItems).toBe(3)

    const createProps = threadCreateTool.descriptor.inputSchema.properties as Record<string, { enum?: string[] }>
    expect(createProps.provider.enum).toEqual(['claude', 'codex', 'antigravity'])
  })

  it('lists Claude, Codex, and Antigravity threads together and keeps other projects strictly isolated', async () => {
    const threads: Partial<ConversationThread>[] = [
      { id: 't-claude', projectId: 'p1', rootPath: 'C:\\repo', title: 'Claude Session', provider: 'claude', status: 'idle', pinned: false, updatedAt: 10, access: 'workspace-write' },
      { id: 't-codex', projectId: 'p1', rootPath: 'C:/repo/', title: 'Codex Session', provider: 'codex', status: 'idle', pinned: false, updatedAt: 20, access: 'workspace-write' },
      { id: 't-agy', projectId: 'p1-alt', rootPath: 'c:/repo', title: 'Antigravity Session', provider: 'antigravity', status: 'running', pinned: false, updatedAt: 30, access: 'workspace-write' },
      { id: 't-other', projectId: 'p2', rootPath: 'C:/other-repo', title: 'Other Project AGY', provider: 'antigravity', status: 'idle', pinned: false, updatedAt: 40, access: 'workspace-write' }
    ]
    const manager = Promise.resolve({
      list: () => threads,
      read: (id: string) => ({ thread: threads.find(t => t.id === id), events: [], turns: [] })
    })

    const res = await callDomain('oxespace_threads', { action: 'list' }, makeCtx({
      owner: { kind: 'thread', id: 't-claude' },
      workspaceId: 'thread:p1',
      root: 'C:\\repo',
      threads: manager
    }))

    expect(res.ok).toBe(true)
    expect(res.result.items.map((t: { id: string; provider: string }) => [t.id, t.provider])).toEqual([
      ['t-agy', 'antigravity'],
      ['t-codex', 'codex'],
      ['t-claude', 'claude']
    ])
    expect(res.result.canSendToOtherThreads).toBeUndefined()
    expect(res.result.accessNote).toBeUndefined()
  })

  it('gives clear Read-Only guidance on list/read and omits it when writable so Claude/Codex can send to Antigravity', async () => {
    const threads: Partial<ConversationThread>[] = [
      { id: 't-ro', projectId: 'p1', rootPath: '/repo', title: 'Read Only Claude', provider: 'claude', status: 'idle', pinned: false, updatedAt: 10, access: 'read-only' },
      { id: 't-rw', projectId: 'p1', rootPath: '/repo', title: 'Writable Claude', provider: 'claude', status: 'idle', pinned: false, updatedAt: 15, access: 'workspace-write' },
      { id: 't-agy', projectId: 'p1', rootPath: '/repo', title: 'Antigravity Partner', provider: 'antigravity', status: 'idle', pinned: false, updatedAt: 25, access: 'workspace-write' }
    ]
    const send = vi.fn(async () => {})
    const manager = Promise.resolve({
      list: () => threads,
      read: (id: string) => ({ thread: threads.find(t => t.id === id), events: [{ type: 'message', role: 'assistant', text: 'Ready in AGY' }], turns: [] }),
      send
    })

    // 1. Read-Only thread calling list & read receives Antigravity session + plain-language Read-Only guidance.
    const roCtx = makeCtx({ owner: { kind: 'thread', id: 't-ro' }, workspaceId: 'thread:p1', threads: manager })
    const roList = await callDomain('oxespace_threads', { action: 'list' }, roCtx)
    expect(roList.ok).toBe(true)
    expect(roList.result.items.some((t: { id: string; provider: string }) => t.id === 't-agy' && t.provider === 'antigravity')).toBe(true)
    expect(roList.result.canSendToOtherThreads).toBe(false)
    expect(roList.result.accessNote).toContain('Read-Only')
    expect(roList.result.accessNote).toContain('Ask or Full Access')

    const roRead = await callDomain('oxespace_threads', { action: 'read', threadId: 't-agy' }, roCtx)
    expect(roRead.ok).toBe(true)
    expect(roRead.result.canSendToOtherThreads).toBe(false)
    expect(roRead.result.accessNote).toContain('Read-Only')
    expect(roRead.result.messages).toEqual([{ role: 'assistant', text: 'Ready in AGY' }])

    // Workspace ceiling read-only also surfaces the guidance even if the thread itself asked for workspace-write.
    const ceilingCtx = makeCtx({
      owner: { kind: 'thread', id: 't-rw' },
      workspaceId: 'thread:p1',
      workspaceCeiling: 'read-only',
      threads: manager
    })
    const ceilingList = await callDomain('oxespace_threads', { action: 'list' }, ceilingCtx)
    expect(ceilingList.result.canSendToOtherThreads).toBe(false)
    expect(ceilingList.result.accessNote).toContain('Read-Only')

    // 2. Writable thread gets NO Read-Only restriction note and CAN send directly to the Antigravity thread.
    const asked: ApprovalRequest[] = []
    const rwCtx = makeCtx({ owner: { kind: 'thread', id: 't-rw' }, workspaceId: 'thread:p1', threads: manager, asked })
    const rwList = await callDomain('oxespace_threads', { action: 'list' }, rwCtx)
    expect(rwList.ok).toBe(true)
    expect(rwList.result.canSendToOtherThreads).toBeUndefined()
    expect(rwList.result.accessNote).toBeUndefined()

    const sent = await callDomain('oxespace_threads_change', { action: 'send', threadId: 't-agy', text: 'Oi Antigravity!' }, rwCtx)
    expect(sent).toMatchObject({ ok: true, result: { sent: true } })
    expect(asked).toHaveLength(1)
    expect(send).toHaveBeenCalledWith('t-agy', 'Oi Antigravity!')
  })

  it('supports antigravity in oxespace_usage (credits & context), oxespace_skills_change, and oxespace_agents_change model flags', async () => {
    const getCredits = vi.fn(async (provider: string) => ({
      provider, available: true, installed: true, windows: [{ label: 'Session', usedPct: 12 }], observedAtMs: 1, error: null
    }))
    const getContext = vi.fn((provider: string) => ({
      provider, available: false, usedTokens: 0, limitTokens: 0, usedPct: 0, modelId: null, error: null
    }))
    const createSkill = vi.fn(input => ({ name: input.name, filePath: '/repo/.oxe/skills/agy.md', source: 'workspace' }))

    const usageCtx = makeCtx({ app: { credits: { getCredits } as never, contextUsage: { get: getContext } as never, skills: { createSkill, listSkills: vi.fn() } as never } })

    const credits = await callDomain('oxespace_usage', { action: 'credits', provider: 'antigravity' }, usageCtx)
    expect(credits).toMatchObject({ ok: true, result: { provider: 'antigravity', available: true } })
    expect(getCredits).toHaveBeenCalledWith('antigravity')

    const context = await callDomain('oxespace_usage', { action: 'context', provider: 'antigravity' }, usageCtx)
    expect(context).toMatchObject({ ok: true, result: { provider: 'antigravity', available: false, note: expect.stringMatching(/Antigravity/i) } })
    expect(getContext).toHaveBeenCalledWith('antigravity', '/repo', null)

    const skill = await callDomain('oxespace_skills_change', {
      action: 'create', name: 'agy-check', description: 'Check AGY', body: 'Run checks.', agents: ['claude', 'antigravity']
    }, usageCtx)
    expect(skill).toMatchObject({ ok: true })
    expect(createSkill).toHaveBeenCalledWith(expect.objectContaining({ agents: ['claude', 'antigravity'] }))

    // Agent pane start passes `--model <model>` for antigravity.
    const terminalStart = vi.fn(async () => {})
    const ws = { id: 'ws-1', rootPath: '/repo', name: 'repo', isActive: true, panes: [{ id: 'me', displayName: null }] }
    const agyAgents = {
      state: {
        list: () => [],
        get: () => null,
        explain: () => ({ state: null }),
        waitFor: vi.fn(async () => ({ state: { paneId: 'h1', workspaceId: 'ws-1', agent: 'antigravity', state: 'idle', source: 'screen', seen: true, since: 0, stateChangeSeq: 1, completionSeq: 0 }, timedOut: false }))
      },
      terminal: { peek: () => null, submit: vi.fn(), interrupt: vi.fn(), start: terminalStart, stop: vi.fn() },
      profiles: () => [{ agentProfileId: 'agy-1', provider: 'antigravity', name: 'Antigravity', command: 'agy', commandTemplate: '', isBuiltin: true }],
      resolve: () => ({ executable: 'agy', provider: 'antigravity' }),
      mcpArgs: () => [],
      createPane: () => { ws.panes.push({ id: 'h1', displayName: null }); return { workspace: ws, paneId: 'h1' } },
      setPaneAgent: () => ws,
      closePane: () => ws,
      workspaceChanged: vi.fn()
    }
    const agentCtx = {
      workspaceId: 'ws-1', executionId: 'e1', executionToken: 't',
      workspaceServ: { get: () => ws, list: () => [ws] },
      executions: { authenticate: () => ({ id: 'e1', owner: { kind: 'pane', id: 'me' }, workspaceId: 'ws-1', canonicalRoot: '/repo', cwd: '/repo' }) },
      agentActions: new AgentActions(),
      app: { agents: agyAgents }
    } as unknown as ToolContext
    try {
      const started = await callDomain('oxespace_agents_change', { action: 'start', agent: 'antigravity', model: 'gemini-4-carbon' }, agentCtx)
      expect(started).toMatchObject({ ok: true, result: { paneId: 'h1', ready: true } })
      expect(terminalStart).toHaveBeenCalledWith(expect.objectContaining({
        paneId: 'h1',
        launch: { executable: 'agy', args: ['--model', 'gemini-4-carbon'] }
      }))
    } finally {
      _resetAgentOwnersForTests()
    }
  })

  it('supports creating a cross-provider Antigravity handoff thread via oxespace_thread_create', async () => {
    const db = openInMemoryDatabase()
    try {
      const root = process.cwd()
      const now = Date.now()
      const originThread: ConversationThread = {
        id: randomUUID(), workspaceId: 'thread:p1', projectId: 'p1', rootPath: root,
        provider: 'claude', nativeSessionId: 'claude-native-1', title: 'Origin Claude', pinned: false,
        status: 'running', createdAt: now, updatedAt: now, generation: 1, access: 'workspace-write'
      }
      db.prepare('INSERT INTO thread_projects (id, identity, root_path, display_name, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
        .run('p1', root, root, 'Project', now, now)
      db.prepare('INSERT INTO thread_project_contexts (project_id, root_path) VALUES (?, ?)').run('p1', root)
      db.prepare('INSERT INTO conversation_threads (id, workspace_id, thread_project_id, data_json, events_json) VALUES (?, ?, ?, ?, ?)')
        .run(originThread.id, originThread.workspaceId, originThread.projectId, JSON.stringify(originThread), '[]')

      const snapshots = new Map<string, ThreadSnapshot>([[originThread.id, { thread: originThread, events: [] }]])
      const manager = {
        read: (id: string) => snapshots.get(id)!,
        create: (context: Pick<ConversationThread, 'workspaceId' | 'projectId' | 'rootPath' | 'provider'>) => {
          const thread: ConversationThread = {
            ...context, id: randomUUID(), nativeSessionId: null, title: 'New', pinned: false,
            status: 'idle', createdAt: now, updatedAt: now, generation: 1
          }
          db.prepare('INSERT INTO conversation_threads (id, workspace_id, thread_project_id, data_json, events_json) VALUES (?, ?, ?, ?, ?)')
            .run(thread.id, thread.workspaceId, thread.projectId, JSON.stringify(thread), '[]')
          const snap = { thread, events: [] }
          snapshots.set(thread.id, snap)
          return snap
        },
        send: vi.fn(async () => {})
      }
      const executions = new ExecutionRegistry()
      const env = executions.register({ owner: { kind: 'thread', id: originThread.id }, workspaceId: originThread.workspaceId, cwd: root })
      const ctx = {
        db, threads: Promise.resolve(manager), executions, workspaceId: originThread.workspaceId,
        executionId: env.OXESPACE_EXECUTION_ID, executionToken: env.OXESPACE_EXECUTION_TOKEN
      } as unknown as ToolContext

      const createTool = findTool('oxespace_thread_create')!
      const created = JSON.parse((await createTool.handler({ key: 'cross-agy-1', provider: 'antigravity' }, ctx)).content[0].text!) as { threadId: string; created: boolean; provider: string }
      expect(created).toMatchObject({ created: true, provider: 'antigravity' })
      expect(manager.read(created.threadId).thread.provider).toBe('antigravity')

      // Invalid provider is refused cleanly.
      await expect(createTool.handler({ key: 'cross-bad-1', provider: 'unknown' }, ctx)).rejects.toThrow(/claude, codex, or antigravity/i)
    } finally {
      db.close()
    }
  })

  it('persists and recovers Antigravity native session bindings in DelegationRepository and ThreadDelegationHost', async () => {
    const db = openInMemoryDatabase()
    try {
      const repo = new DelegationRepository(db)
      const now = Date.now()
      const task: DelegationTask = {
        id: 'task-agy-1', schemaVersion: 2, key: 'key-agy-1', agentProfileId: 'builtin-antigravity',
        objective: 'Run Antigravity delegation', handoff: 'Check parity', acceptance: 'All green',
        mode: 'isolated-change', surface: 'thread', branchIntent: { strategy: 'create', name: 'feat/agy-del' },
        workspaceId: 'ws-1', project: 'proj-1', originPaneId: 'pane-origin', originExecutionId: 'exec-origin',
        cwd: 'C:/repo', path: 'C:/repo-wt/agy', branch: 'feat/agy-del', baseSha: 'abc123',
        localChanges: '', state: 'interrupted', createdAt: now, updatedAt: now,
        nativeSession: {
          provider: 'antigravity',
          nativeSessionId: 'agy-session-uuid-1',
          canonicalRoot: 'C:/repo-wt/agy',
          generation: 1,
          observedAt: now,
          resumable: true
        }
      }
      repo.save(task)
      const binding = db.prepare('SELECT provider, native_session_id AS id, generation FROM delegation_session_bindings WHERE task_id = ?').get('task-agy-1')
      expect(binding).toEqual({ provider: 'antigravity', id: 'agy-session-uuid-1', generation: 1 })
      expect(repo.get('task-agy-1')?.recoveryActions).toContain('resume')

      const executions = new ExecutionRegistry()
      const current = {
        id: 'thread-agy-1', workspaceId: 'ws-1', projectId: 'proj-1', rootPath: 'C:/repo-wt/agy',
        provider: 'antigravity' as const, nativeSessionId: null as string | null, title: 'AGY Delegated',
        pinned: false, status: 'idle' as const, createdAt: now, updatedAt: now, generation: 1, queue: []
      }
      const manager = {
        create: vi.fn(() => ({ thread: current, events: [] })),
        configure: vi.fn(async () => ({ thread: current, events: [] })),
        read: vi.fn(() => ({ thread: current, events: [] })),
        send: vi.fn(async () => {
          executions.register({ owner: { kind: 'thread', id: current.id }, workspaceId: current.workspaceId, cwd: current.rootPath })
          current.nativeSessionId = 'agy-native-2'
          current.status = 'running'
        })
      } as unknown as ThreadManager

      const host = new ThreadDelegationHost(Promise.resolve(manager), executions, () => 'antigravity')
      const freshTask: DelegationTask = { ...task, id: 'task-agy-2', destinationThreadId: undefined, nativeSession: undefined }
      const started = await host.start(freshTask)
      expect(started).toMatchObject({ threadId: 'thread-agy-1', nativeSessionId: 'agy-native-2', provider: 'antigravity', generation: 1 })
      expect(await host.inspect({ ...freshTask, destinationThreadId: 'thread-agy-1' })).toMatchObject({
        provider: 'antigravity', nativeSessionId: 'agy-native-2', resumable: true
      })
    } finally {
      db.close()
    }
  })
})
