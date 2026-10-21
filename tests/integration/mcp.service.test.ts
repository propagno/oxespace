import { describe, expect, test } from 'vitest'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { openInMemoryDatabase } from '../../electron/main/db/index'
import { McpManager } from '../../electron/main/services/mcp.service'
import { WorkspaceService } from '../../electron/main/services/workspace.service'

describe('McpManager trust gates', () => {
  test('internal MCP credentials are inherited, never written into tracked project config', async () => {
    const rootPath = await mkdtemp(join(tmpdir(), 'oxe-mcp-secret-'))
    const db = openInMemoryDatabase()
    try {
      new WorkspaceService(db).create({ rootPath, layoutPreset: 1 })
      const manager = new McpManager(db)
      manager.create({ workspaceId: null, name: 'oxespace', transport: 'stdio', enabled: true, trusted: true,
        config: { transport: 'stdio', command: 'node', args: ['bridge.cjs'], env: {
          OXESPACE_MCP_TOKEN: 'fixture-machine-secret', OXESPACE_EXECUTION_TOKEN: 'fixture-execution-secret', OXESPACE_MCP_PORT: '1234'
        } } })
      const config = await readFile(join(rootPath, '.mcp.json'), 'utf8')
      expect(config).not.toContain('fixture-machine-secret')
      expect(config).not.toContain('fixture-execution-secret')
      expect(config).toContain('1234')
    } finally { db.close(); await rm(rootPath, { recursive: true, force: true }) }
  })
  test('does not start untrusted servers', async () => {
    const db = openInMemoryDatabase()
    const manager = new McpManager(db)
    const server = manager.create({
      workspaceId: null,
      name: 'test',
      transport: 'stdio',
      config: { transport: 'stdio', command: 'node', args: ['server.js'], env: {} },
      enabled: true
    })

    await expect(manager.start(server.id)).rejects.toThrow('not trusted')
    db.close()
  })

  test('does not materialize or pre-approve untrusted servers for external CLIs', async () => {
    const rootPath = await mkdtemp(join(tmpdir(), 'oxespace-mcp-trust-'))
    const db = openInMemoryDatabase()
    try {
      const workspace = new WorkspaceService(db).create({ rootPath, layoutPreset: 1 })
      const manager = new McpManager(db)
      manager.create({
        workspaceId: workspace.id,
        name: 'untrusted-test',
        transport: 'stdio',
        config: { transport: 'stdio', command: 'node', args: ['server.js'], env: {} },
        enabled: true,
        trusted: false
      })

      const doc = JSON.parse(await readFile(join(rootPath, '.mcp.json'), 'utf8')) as { mcpServers: Record<string, unknown> }
      expect(doc.mcpServers['untrusted-test']).toBeUndefined()
    } finally {
      db.close()
      await rm(rootPath, { recursive: true, force: true })
    }
  })

  test('blocks sensitive env on untrusted servers', () => {
    const db = openInMemoryDatabase()
    const manager = new McpManager(db)

    expect(() => manager.create({
      workspaceId: null,
      name: 'secrets',
      transport: 'stdio',
      config: { transport: 'stdio', command: 'node', args: ['server.js'], env: { GITHUB_TOKEN: 'secret' } },
      enabled: true
    })).toThrow('Sensitive environment blocked')

    db.close()
  })

  test('reports spawn failures as controlled MCP health errors', async () => {
    const db = openInMemoryDatabase()
    const health: Array<{ status: string; message: string | null }> = []
    const manager = new McpManager(db, {
      emitHealth: (event) => health.push({ status: event.status, message: event.message })
    })
    const server = manager.create({
      workspaceId: null,
      name: 'missing',
      transport: 'stdio',
      config: { transport: 'stdio', command: 'definitely-missing-mcp-command', args: [], env: {} },
      enabled: true,
      trusted: true
    })

    await expect(manager.start(server.id)).rejects.toThrow('Executable "definitely-missing-mcp-command" not found')
    expect(health.some((event) => event.status === 'unhealthy' && event.message?.includes('not found'))).toBe(true)

    db.close()
  })

  test('a test lists the tools, lets the server go and is remembered on the row', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'oxe-mcp-test-'))
    const db = openInMemoryDatabase()
    try {
      const script = join(dir, 'server.cjs')
      await writeFile(script, [
        "process.stdin.setEncoding('utf8'); let buf = ''",
        "process.stdin.on('data', c => { buf += c; let i; while ((i = buf.indexOf('\\n')) >= 0) { const m = JSON.parse(buf.slice(0, i)); buf = buf.slice(i + 1)",
        "  if (m.method === 'initialize') reply(m.id, { protocolVersion: '2025-06-18' })",
        "  if (m.method === 'tools/list') reply(m.id, { tools: [{ name: 'echo', description: 'Echo', inputSchema: {} }] }) } })",
        "function reply(id, result) { process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, result }) + '\\n') }"
      ].join('\n'))
      const manager = new McpManager(db)
      const untrusted = manager.create({ workspaceId: null, name: 'u', transport: 'stdio', config: { transport: 'stdio', command: process.execPath, args: [script], env: {} }, enabled: true })
      await expect(manager.test(untrusted.id)).resolves.toMatchObject({ health: 'unhealthy', healthMessage: expect.stringContaining('Not trusted') })

      const server = manager.create({ workspaceId: null, name: 'echo', transport: 'stdio', config: { transport: 'stdio', command: process.execPath, args: [script], env: { ELECTRON_RUN_AS_NODE: '1' } }, enabled: true, trusted: true })
      const tested = await manager.test(server.id)
      expect(tested).toMatchObject({ health: 'healthy', tools: [{ name: 'echo' }] })
      expect(tested.testedAtMs).toEqual(expect.any(Number))
      // OXESpace does not keep a copy running beside the agent's.
      expect(manager.list(null).find(row => row.id === server.id)).toMatchObject({ health: 'healthy', tools: [{ name: 'echo' }] })
      expect((manager as unknown as { runtimes: Map<string, unknown> }).runtimes.size).toBe(0)
    } finally { db.close(); await rm(dir, { recursive: true, force: true }) }
  })
})
