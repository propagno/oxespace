import http from 'node:http'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { openInMemoryDatabase } from '../../electron/main/db/index'
import { WorkspaceService } from '../../electron/main/services/workspace.service'
import { GitHubService } from '../../electron/main/services/github.service'
import { BackgroundManager } from '../../electron/main/services/background.service'
import { FileSystemService } from '../../electron/main/services/file-system.service'
import { createLocalRpcServer, type LocalRpcServer } from '../../electron/main/mcp-internal/local-rpc-server'
import { WebPreviewBus } from '../../electron/main/mcp-internal/web-preview-bus'
import { WorktreeEventBus } from '../../electron/main/mcp-internal/worktree-event-bus'

interface ServerCtx {
  server: LocalRpcServer
  port: number
  db: ReturnType<typeof openInMemoryDatabase>
  workspaceServ: WorkspaceService
}

const TOKEN = 'a'.repeat(64)

async function postRpc(port: number, headers: Record<string, string>, body: object): Promise<{ status: number; json: unknown }> {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body)
    const req = http.request(
      {
        host: '127.0.0.1',
        port,
        path: '/rpc',
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload), ...headers }
      },
      (res) => {
        let chunks = ''
        res.setEncoding('utf8')
        res.on('data', (c) => { chunks += c })
        res.on('end', () => {
          try { resolve({ status: res.statusCode ?? 0, json: JSON.parse(chunks) }) } catch { resolve({ status: res.statusCode ?? 0, json: chunks }) }
        })
      }
    )
    req.on('error', reject)
    req.write(payload)
    req.end()
  })
}

async function start(): Promise<ServerCtx> {
  const db = openInMemoryDatabase()
  const workspaceServ = new WorkspaceService(db)
  const server = createLocalRpcServer({
    workspaceServ,
    github: new GitHubService(db),
    background: new BackgroundManager(db, { emitOutput: () => undefined, emitUpdate: () => undefined }),
    fileSystem: new FileSystemService(),
    webPreview: new WebPreviewBus(),
    worktree: new WorktreeEventBus(),
    // Semantic/codegraph are unused by the RPC smoke tools exercised below.
    semantic: { isEnabled: () => false, queryDetailed: async () => ({ results: [] }) } as never,
    codegraph: {} as never
  })
  server.setToken(TOKEN)
  const { port } = await server.start(0)
  return { server, port, db, workspaceServ }
}

describe('Internal MCP local RPC server', () => {
  let ctx: ServerCtx
  beforeEach(async () => { ctx = await start() })
  afterEach(async () => { await ctx.server.stop(); ctx.db.close() })

  test('rejects requests without a bearer token', async () => {
    const { status, json } = await postRpc(ctx.port, {}, { jsonrpc: '2.0', id: 1, method: 'tools/list' })
    expect(status).toBe(401)
    expect((json as { ok: boolean }).ok).toBe(false)
  })

  test('rejects requests with the wrong token', async () => {
    const { status } = await postRpc(ctx.port, { Authorization: 'Bearer wrong' }, { jsonrpc: '2.0', id: 1, method: 'tools/list' })
    expect(status).toBe(401)
  })

  test('returns the tool catalogue on tools/list', async () => {
    const { status, json } = await postRpc(ctx.port, { Authorization: `Bearer ${TOKEN}` }, { jsonrpc: '2.0', id: 1, method: 'tools/list' })
    expect(status).toBe(200)
    const env = json as { jsonrpc: string; id: number; result: { tools: Array<{ name: string }> } }
    expect(env.jsonrpc).toBe('2.0')
    const names = env.result.tools.map((t) => t.name)
    expect(names).toContain('oxespace_list_workspaces')
    expect(names).toContain('oxespace_list_worktrees')
    expect(names).toContain('oxespace_open_web_preview')
    expect(names).toContain('oxespace_get_job_output')
  })

  test('returns -32601 for unknown methods', async () => {
    const { json } = await postRpc(ctx.port, { Authorization: `Bearer ${TOKEN}` }, { jsonrpc: '2.0', id: 42, method: 'bogus/method' })
    const env = json as { error: { code: number } }
    expect(env.error.code).toBe(-32601)
  })

  test('workspace-scoped tool without header returns actionable isError when no active workspace', async () => {
    const { json } = await postRpc(
      ctx.port,
      { Authorization: `Bearer ${TOKEN}` },
      { jsonrpc: '2.0', id: 7, method: 'tools/call', params: { name: 'oxespace_list_worktrees', arguments: {} } }
    )
    const env = json as { result: { isError?: boolean; content: Array<{ text: string }> } }
    expect(env.result.isError).toBe(true)
    expect(env.result.content[0].text).toMatch(/oxespace_list_workspaces|active workspace/i)
  })

  test('workspace-scoped tool without header falls back to the active workspace', async () => {
    const workspace = ctx.workspaceServ.create({ rootPath: process.cwd(), name: 'rpc-fallback' })
    ctx.workspaceServ.setActive(workspace.id)

    const { status, json } = await postRpc(
      ctx.port,
      { Authorization: `Bearer ${TOKEN}` },
      { jsonrpc: '2.0', id: 71, method: 'tools/call', params: { name: 'oxespace_list_panes', arguments: {} } }
    )
    expect(status).toBe(200)
    const env = json as { result: { isError?: boolean; content: Array<{ text: string }> } }
    expect(env.result.isError).toBeUndefined()
    expect(env.result.content[0].text).toBeDefined()
    // Should be a JSON array of panes (possibly empty for a fresh workspace)
    expect(env.result.content[0].text.trim().startsWith('[')).toBe(true)
  })

  test('stale workspace header falls back to the active workspace', async () => {
    const workspace = ctx.workspaceServ.create({ rootPath: process.cwd(), name: 'rpc-stale' })
    ctx.workspaceServ.setActive(workspace.id)

    const { status, json } = await postRpc(
      ctx.port,
      {
        Authorization: `Bearer ${TOKEN}`,
        'X-OXE-Workspace-Id': '00000000-0000-0000-0000-000000000000'
      },
      { jsonrpc: '2.0', id: 72, method: 'tools/call', params: { name: 'oxespace_list_panes', arguments: {} } }
    )
    expect(status).toBe(200)
    const env = json as { result: { isError?: boolean; content: Array<{ text: string }> } }
    expect(env.result.isError).toBeUndefined()
    expect(env.result.content[0].text.trim().startsWith('[')).toBe(true)
  })

  test('returns -32001 for an unknown tool', async () => {
    const { json } = await postRpc(
      ctx.port,
      { Authorization: `Bearer ${TOKEN}` },
      { jsonrpc: '2.0', id: 8, method: 'tools/call', params: { name: 'oxespace_does_not_exist', arguments: {} } }
    )
    const env = json as { error: { code: number } }
    expect(env.error.code).toBe(-32001)
  })

  test('list_workspaces does not require the workspace header', async () => {
    const { json } = await postRpc(
      ctx.port,
      { Authorization: `Bearer ${TOKEN}` },
      { jsonrpc: '2.0', id: 9, method: 'tools/call', params: { name: 'oxespace_list_workspaces', arguments: {} } }
    )
    const env = json as { result: { content: Array<{ text: string }> } }
    expect(env.result.content[0].text).toBeDefined()
  })
})
