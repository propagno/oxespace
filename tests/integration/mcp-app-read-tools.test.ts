import { describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { TOOL_REGISTRY, type ToolContext } from '../../electron/main/mcp-internal/tool-registry'
import { APP_READ_TOOLS, APP_READ_TOOL_NAMES } from '../../electron/main/mcp-internal/app-read-tools'
import { THREAD_MCP_TOOLS, THREAD_READ_ONLY_MCP_TOOLS } from '../../electron/main/services/conversation/thread-mcp'

const WS = { id: 'ws-1', rootPath: '/repo', name: 'repo', isActive: true, panes: [{ id: 'pane-1' }] }

function ctx(app: ToolContext['app'], options: { owner?: { kind: 'pane' | 'thread'; id: string }; workspaceId?: string; root?: string; threads?: unknown } = {}): ToolContext {
  const owner = options.owner ?? { kind: 'pane', id: 'pane-1' }
  const execution = { id: 'e1', owner, workspaceId: options.workspaceId ?? WS.id, canonicalRoot: options.root ?? '/repo', cwd: options.root ?? '/repo' }
  return {
    workspaceId: execution.workspaceId, executionId: 'e1', executionToken: 't',
    workspaceServ: { get: (id: string) => id === WS.id ? WS : null, list: () => [WS] },
    executions: { authenticate: () => execution },
    app, threads: options.threads
  } as unknown as ToolContext
}

const tool = (name: string) => APP_READ_TOOLS.find(entry => entry.descriptor.name === name)!

async function call(name: string, args: Record<string, unknown>, context: ToolContext) {
  const result = await tool(name).handler(args, context)
  // The tools return JSON; the assertions walk it freely.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return JSON.parse(result.content[0].text) as { ok: boolean; code?: string; result?: any }
}

describe('read tools', () => {
  it('are registered once, read-only, retry-safe in the bridge and offered to Threads unless they need a Code workspace', () => {
    const bridge = readFileSync('resources/mcp-bridge/oxespace-mcp.cjs', 'utf8')
    for (const name of APP_READ_TOOL_NAMES) {
      expect(TOOL_REGISTRY.filter(entry => entry.descriptor.name === name)).toHaveLength(1)
      expect(bridge).toContain(`'${name}'`)
      const schema = tool(name).descriptor.inputSchema as { properties: { action: { enum: string[] } } }
      expect(tool(name).descriptor.description).not.toMatch(/\((write|confirm)\)/)
      expect(schema.properties.action.enum.length).toBeGreaterThan(0)
      const codeOnly = name === 'oxespace_tasks' || name === 'oxespace_terminal'
      expect(THREAD_MCP_TOOLS.includes(name)).toBe(!codeOnly)
      expect(THREAD_READ_ONLY_MCP_TOOLS.includes(name)).toBe(!codeOnly)
    }
  })

  it('say a missing service is unavailable', async () => {
    expect(await call('oxespace_linear', { action: 'teams' }, ctx({}))).toMatchObject({ ok: false, code: 'unavailable' })
  })
})

describe('oxespace_github', () => {
  it('passes the caller\'s directory and cleans CI logs', async () => {
    const github = {
      listPullRequests: vi.fn(async (input: unknown) => [input]),
      getRunLogs: vi.fn(async () => ({ logs: '\u001b[31mFAIL\u001b[0m token=abc123secret\nok', truncated: false, bytes: 10 }))
    }
    expect(await call('oxespace_github', { action: 'pull_requests' }, ctx({ github } as never))).toMatchObject({ ok: true, result: [{ rootPath: '/repo', state: 'open' }] })
    const logs = await call('oxespace_github', { action: 'run_logs', runId: 7 }, ctx({ github } as never))
    expect(logs.result.logs).toBe('FAIL token=***\nok')
    expect(github.getRunLogs).toHaveBeenCalledWith({ rootPath: '/repo', runId: 7, failedOnly: true })
    expect(await call('oxespace_github', { action: 'commit', oid: '--all' }, ctx({ github } as never))).toMatchObject({ ok: false, code: 'invalid' })
  })
})

describe('oxespace_threads', () => {
  const threads = [
    { id: 't1', projectId: 'p1', rootPath: '/repo', title: 'Mine', provider: 'claude', status: 'idle', pinned: false, updatedAt: 2 },
    { id: 't2', projectId: 'p1', rootPath: '/repo-wt', title: 'Sibling', provider: 'codex', status: 'idle', pinned: false, updatedAt: 3 },
    { id: 't3', projectId: 'p2', rootPath: '/other', title: 'Other project', provider: 'codex', status: 'idle', pinned: false, updatedAt: 4 }
  ]
  const manager = Promise.resolve({
    list: () => threads,
    read: (id: string) => ({ thread: threads.find(t => t.id === id), events: [{ type: 'message', role: 'assistant', text: 'hello' }], turns: [] }),
    usageSummary: vi.fn(() => ({ costUsd: 1 }))
  })

  it('lists the caller Thread\'s project, and a pane\'s directory', async () => {
    const fromThread = await call('oxespace_threads', { action: 'list' }, ctx({}, { owner: { kind: 'thread', id: 't1' }, workspaceId: 'thread:p1', threads: manager }))
    expect(fromThread.result.items.map((t: { id: string }) => t.id)).toEqual(['t2', 't1'])
    const fromPane = await call('oxespace_threads', { action: 'list' }, ctx({}, { threads: manager }))
    expect(fromPane.result.items.map((t: { id: string }) => t.id)).toEqual(['t1'])
  })

  it('reads a Thread of the project and refuses one of another project', async () => {
    const context = ctx({}, { owner: { kind: 'thread', id: 't1' }, workspaceId: 'thread:p1', threads: manager })
    expect(await call('oxespace_threads', { action: 'read', threadId: 't2' }, context)).toMatchObject({ ok: true, result: { thread: { id: 't2' }, messages: [{ text: 'hello' }] } })
    expect(await call('oxespace_threads', { action: 'read', threadId: 't3' }, context)).toMatchObject({ ok: false, code: 'not-found' })
  })
})

describe('oxespace_tasks and oxespace_terminal', () => {
  it('need a Code workspace', async () => {
    const tasks = { list: vi.fn(() => []), getReadyTaskIds: vi.fn(() => []), executions: vi.fn(() => []) }
    expect(await call('oxespace_tasks', { action: 'list' }, ctx({ tasks } as never, { owner: { kind: 'thread', id: 't1' }, workspaceId: 'thread:p1' }))).toMatchObject({ ok: false, code: 'no-workspace' })
    expect(await call('oxespace_tasks', { action: 'list' }, ctx({ tasks } as never))).toMatchObject({ ok: true })
    expect(await call('oxespace_tasks', { action: 'executions', taskId: 'x' }, ctx({ tasks } as never))).toMatchObject({ ok: false, code: 'not-found' })
  })

  it('reads a pane of this workspace, cleaned and masked, and nothing else', async () => {
    const terminal = { peek: vi.fn((paneId: string) => paneId === 'pane-1' ? { running: true, altScreen: false, data: 'PS> \u001b[32mok\u001b[0m\r\nexport API_KEY=sk-123456\r\n' } : null) }
    const output = await call('oxespace_terminal', { action: 'output', paneId: 'pane-1' }, ctx({ terminal } as never))
    expect(output.result.text).toBe('PS> ok\nexport API_KEY=***\n')
    expect(await call('oxespace_terminal', { action: 'output', paneId: 'pane-9' }, ctx({ terminal } as never))).toMatchObject({ ok: false, code: 'not-found' })
    terminal.peek.mockReturnValueOnce({ running: true, altScreen: true, data: 'x' })
    expect((await call('oxespace_terminal', { action: 'output', paneId: 'pane-1' }, ctx({ terminal } as never))).result).toMatchObject({ text: '' })
  })
})

describe('oxespace_mcp_servers', () => {
  it('never returns commands, environment or headers', async () => {
    const mcpServers = { list: () => [{ id: 's1', workspaceId: null, name: 'db', transport: 'stdio', enabled: true, trusted: true, health: 'unhealthy', healthMessage: 'auth failed password=hunter2', tools: [{ name: 'query' }], config: { command: 'npx', env: { TOKEN: 'secret' } } }] }
    const result = await call('oxespace_mcp_servers', { action: 'list' }, ctx({ mcpServers } as never))
    expect(JSON.stringify(result)).not.toContain('secret')
    expect(JSON.stringify(result)).not.toContain('hunter2')
    expect(result.result[0]).toMatchObject({ name: 'db', scope: 'global', tools: ['query'] })
  })
})

describe('oxespace_search', () => {
  it('searches the caller\'s directory and caps the files', async () => {
    const search = { search: vi.fn(async () => ({ files: [{ path: 'a' }, { path: 'b' }], totalMatches: 2, totalFiles: 2, truncated: false, elapsedMs: 1 })), listFiles: vi.fn() }
    const result = await call('oxespace_search', { action: 'text', query: 'foo', limit: 1 }, ctx({ search } as never))
    expect(result.result).toMatchObject({ files: [{ path: 'a' }], truncated: true })
    expect(search.search).toHaveBeenCalledWith(expect.objectContaining({ rootPath: '/repo', query: 'foo' }))
  })
})
