import { describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { TOOL_REGISTRY, type ToolContext } from '../../electron/main/mcp-internal/tool-registry'
import { APP_WRITE_TOOLS, APP_WRITE_TOOL_NAMES } from '../../electron/main/mcp-internal/app-write-tools'
import { APP_READ_TOOLS } from '../../electron/main/mcp-internal/app-read-tools'
import { GIT_TOOLS } from '../../electron/main/mcp-internal/git-tools'
import { AgentActions } from '../../electron/main/services/agent-actions/agent-actions'
import { ApprovalBroker, type ApprovalDecision, type ApprovalRequest } from '../../electron/main/services/agent-actions/approval-broker'
import { THREAD_MCP_TOOLS, THREAD_READ_ONLY_MCP_TOOLS } from '../../electron/main/services/conversation/thread-mcp'

const WS = { id: 'ws-1', rootPath: '/repo', name: 'repo', isActive: true, panes: [] }

function setup(options: { decide?: ApprovalDecision; live?: boolean; owner?: { kind: 'pane' | 'thread'; id: string }; workspaceId?: string; app?: ToolContext['app']; threads?: unknown; db?: unknown; git?: unknown } = {}) {
  const asked: ApprovalRequest[] = []
  const broker = new ApprovalBroker({ ask: async request => { asked.push(request); return options.decide ?? 'allow-once' } }, Date.now, 50)
  const execution = { id: 'e1', owner: options.owner ?? { kind: 'pane', id: 'p1' }, workspaceId: options.workspaceId ?? WS.id, canonicalRoot: '/repo', cwd: '/repo' }
  const ctx = {
    workspaceId: execution.workspaceId, executionId: 'e1', executionToken: 't',
    workspaceServ: { get: (id: string) => id === WS.id ? WS : null, list: () => [WS] },
    executions: { authenticate: () => { if (options.live === false) throw new Error('none'); return execution } },
    agentActions: new AgentActions({ broker }), app: options.app, threads: options.threads, db: options.db, git: options.git
  } as unknown as ToolContext
  return { asked, ctx }
}

async function call(name: string, args: Record<string, unknown>, ctx: ToolContext) {
  const entry = APP_WRITE_TOOLS.find(tool => tool.descriptor.name === name)!
  const result = await entry.handler(args, ctx)
  return JSON.parse(result.content[0].text) as { ok: boolean; code?: string; result?: unknown }
}

describe('write tools', () => {
  it('are never retried by the bridge nor offered to read-only Threads; task changes stay in Code workspaces', () => {
    const block = /const READ_ONLY_TOOLS = new Set\(\[([\s\S]*?)\]\)/.exec(readFileSync('resources/mcp-bridge/oxespace-mcp.cjs', 'utf8'))![1]
    for (const name of APP_WRITE_TOOL_NAMES) {
      expect(TOOL_REGISTRY.filter(entry => entry.descriptor.name === name)).toHaveLength(1)
      expect(block).not.toContain(`'${name}'`)
      expect(THREAD_READ_ONLY_MCP_TOOLS).not.toContain(name)
      expect(THREAD_MCP_TOOLS.includes(name)).toBe(name !== 'oxespace_tasks_change')
    }
  })

  it('expose nothing that belongs to the person', () => {
    // The app tools only; oxespace_delegation_control's "approve" accepts a delegated result, not a permission.
    const forbidden = /approve|respond|permission|access|login|logout|sign|token|secret|trust|credential|hook|update_app|quit|clipboard|voice|delete_workspace|write_terminal|type_into|auto_approve/i
    for (const entry of [...GIT_TOOLS, ...APP_READ_TOOLS, ...APP_WRITE_TOOLS]) {
      const action = (entry.descriptor.inputSchema as { properties?: { action?: { enum?: string[] } } }).properties?.action
      for (const name of action?.enum ?? []) expect(name, `${entry.descriptor.name}.${name}`).not.toMatch(forbidden)
    }
  })
})

describe('oxespace_git_change', () => {
  const github = () => ({ commit: vi.fn(async () => ({ ok: true })), push: vi.fn(async () => ({ ok: true })), checkoutBranch: vi.fn(async () => ({ ok: true })) })

  it('commits locally for a live agent and refuses a caller without an execution', async () => {
    const gh = github()
    expect(await call('oxespace_git_change', { action: 'commit', message: 'fix: x' }, setup({ app: { github: gh } as never }).ctx)).toMatchObject({ ok: true })
    expect(gh.commit).toHaveBeenCalledWith({ workspaceId: 'ws-1', rootPath: '/repo', message: 'fix: x' })
    expect(await call('oxespace_git_change', { action: 'commit', message: 'fix: x' }, setup({ live: false, app: { github: gh } as never }).ctx)).toMatchObject({ ok: false, code: 'no-execution' })
  })

  it('asks before a push, showing the branch, upstream and commit count', async () => {
    const gh = github()
    const git = { getStatus: async () => ({ branch: 'feat/x', upstream: 'origin/feat/x', ahead: 2, behind: 0, files: [], checkedAt: 0 }) }
    const { asked, ctx } = setup({ app: { github: gh } as never, git })
    expect(await call('oxespace_git_change', { action: 'push' }, ctx)).toMatchObject({ ok: true })
    expect(asked[0].text).toBe('git push\nfeat/x → origin/feat/x (2 commits ahead)\nin /repo')
    const denied = setup({ decide: 'deny', app: { github: gh } as never, git })
    gh.push.mockClear()
    expect(await call('oxespace_git_change', { action: 'push' }, denied.ctx)).toMatchObject({ ok: false, code: 'denied' })
    expect(gh.push).not.toHaveBeenCalled()
  })

  it('refuses a ref git could read as an option', async () => {
    expect(await call('oxespace_git_change', { action: 'checkout', name: '--orphan' }, setup({ app: { github: github() } as never }).ctx)).toMatchObject({ ok: false, code: 'invalid' })
  })
})

describe('oxespace_github_change', () => {
  it('shows the pull request exactly before opening it', async () => {
    const gh = { createPullRequest: vi.fn(async () => ({ ok: true })) }
    const { asked, ctx } = setup({ app: { github: gh } as never })
    expect(await call('oxespace_github_change', { action: 'create_pull_request', title: 'Add X', body: 'Why', base: 'main' }, ctx)).toMatchObject({ ok: true })
    expect(asked[0].text).toBe('Pull request into main from the current branch\nTitle: Add X\n\nWhy')
    expect(await call('oxespace_github_change', { action: 'create_pull_request', title: 'x', head: '-x' }, ctx)).toMatchObject({ ok: false, code: 'invalid' })
  })
})

describe('oxespace_threads_change', () => {
  const threads = [
    { id: 'self', projectId: 'p1', rootPath: '/repo', title: 'Self', status: 'idle' },
    { id: 'child', projectId: 'p1', rootPath: '/repo', title: 'Child', status: 'idle' },
    { id: 'peer', projectId: 'p1', rootPath: '/repo', title: 'Peer', status: 'idle' },
    { id: 'far', projectId: 'p2', rootPath: '/other', title: 'Far', status: 'idle' }
  ]
  const make = () => {
    const manager = { list: () => threads, send: vi.fn(async () => {}), work: { isWorkerOf: () => false } }
    const db = { prepare: () => ({ get: (_origin: string, destination: string) => destination === 'child' ? { 1: 1 } : undefined }) }
    return { manager, db }
  }
  const asThread = { owner: { kind: 'thread' as const, id: 'self' }, workspaceId: 'thread:p1' }

  it('sends to a Thread it created without asking, and asks for any other', async () => {
    const { manager, db } = make()
    const own = setup({ ...asThread, threads: Promise.resolve(manager), db })
    expect(await call('oxespace_threads_change', { action: 'send', threadId: 'child', text: 'go' }, own.ctx)).toMatchObject({ ok: true })
    expect(own.asked).toHaveLength(0)
    const other = setup({ ...asThread, threads: Promise.resolve(manager), db })
    expect(await call('oxespace_threads_change', { action: 'send', threadId: 'peer', text: 'go' }, other.ctx)).toMatchObject({ ok: true })
    expect(other.asked[0]).toMatchObject({ summary: 'thread:self wants to send a message to "Peer"', text: 'go' })
  })

  it('refuses itself and Threads of another project', async () => {
    const { manager, db } = make()
    const { ctx } = setup({ ...asThread, threads: Promise.resolve(manager), db })
    expect(await call('oxespace_threads_change', { action: 'send', threadId: 'self', text: 'x' }, ctx)).toMatchObject({ ok: false, code: 'invalid' })
    expect(await call('oxespace_threads_change', { action: 'send', threadId: 'far', text: 'x' }, ctx)).toMatchObject({ ok: false, code: 'not-found' })
    expect(manager.send).not.toHaveBeenCalled()
  })
})

describe('oxespace_tasks_change', () => {
  const task = { id: 'k1', workspaceId: 'ws-1', title: 'Ship', verifyCommand: 'npm test', dependsOn: [] }
  const tasks = () => ({ list: vi.fn(() => [task]), create: vi.fn(input => input), verify: vi.fn(async () => task), delete: vi.fn() })

  it('creates in the caller\'s Code workspace and refuses a Thread project', async () => {
    const service = tasks()
    expect(await call('oxespace_tasks_change', { action: 'create', title: 'New' }, setup({ app: { tasks: service } as never }).ctx)).toMatchObject({ ok: true, result: { workspaceId: 'ws-1', title: 'New' } })
    expect(await call('oxespace_tasks_change', { action: 'create', title: 'New' }, setup({ owner: { kind: 'thread', id: 't' }, workspaceId: 'thread:p1', app: { tasks: service } as never }).ctx)).toMatchObject({ ok: false, code: 'no-workspace' })
  })

  it('shows the verify command before running it', async () => {
    const service = tasks()
    const { asked, ctx } = setup({ app: { tasks: service } as never })
    expect(await call('oxespace_tasks_change', { action: 'verify', taskId: 'k1' }, ctx)).toMatchObject({ ok: true })
    expect(asked[0].text).toBe('npm test\nin /repo')
  })
})
