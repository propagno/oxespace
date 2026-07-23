import { describe, expect, test } from 'vitest'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { openInMemoryDatabase } from '../../electron/main/db/index'
import { McpManager } from '../../electron/main/services/mcp.service'
import { WorkspaceService } from '../../electron/main/services/workspace.service'

describe('McpManager trust gates', () => {
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
    })).toThrow('Env sensível bloqueado')

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

    await expect(manager.start(server.id)).rejects.toThrow('Executável "definitely-missing-mcp-command" não encontrado')
    expect(health.some((event) => event.status === 'unhealthy' && event.message?.includes('não encontrado'))).toBe(true)

    db.close()
  })
})
