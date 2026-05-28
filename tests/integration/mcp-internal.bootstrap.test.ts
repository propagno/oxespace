import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

const userDataDir = mkdtempSync(join(tmpdir(), 'oxe-mcp-bootstrap-'))
let cleanupPaths: string[] = []

vi.mock('electron', () => ({
  app: {
    getPath: (key: string) => {
      if (key === 'userData') return userDataDir
      return userDataDir
    }
  },
  BrowserWindow: { getAllWindows: () => [] }
}))

import { openInMemoryDatabase } from '../../electron/main/db/index'
import { McpManager } from '../../electron/main/services/mcp.service'
import { WorkspaceService } from '../../electron/main/services/workspace.service'
import { GitHubService } from '../../electron/main/services/github.service'
import { BackgroundManager } from '../../electron/main/services/background.service'
import { FileSystemService } from '../../electron/main/services/file-system.service'
import { createInternalMcpHandle } from '../../electron/main/mcp-internal/bootstrap'

describe('Internal MCP bootstrap', () => {
  beforeEach(() => {
    cleanupPaths = []
  })

  afterEach(() => {
    for (const path of cleanupPaths) {
      try { rmSync(path, { recursive: true, force: true }) } catch { /* ignore */ }
    }
  })

  test('creates the global oxespace row + materializes bridge script on first start', async () => {
    const db = openInMemoryDatabase()
    const mcpManager = new McpManager(db)
    const handle = createInternalMcpHandle({
      db,
      mcpManager,
      workspaceServ: new WorkspaceService(db),
      github: new GitHubService(db),
      background: new BackgroundManager(db, { emitOutput: () => undefined, emitUpdate: () => undefined }),
      fileSystem: new FileSystemService()
    })
    await handle.start()
    cleanupPaths.push(join(userDataDir, 'bin'))

    const status = handle.getStatus()
    expect(status.running).toBe(true)
    expect(status.port).toBeGreaterThan(0)
    expect(status.bridgePath).toContain('oxespace-mcp.cjs')

    // DB row created with the right shape
    const row = db
      .prepare('SELECT name, transport, enabled, trusted, workspace_id, config_json FROM mcp_servers WHERE name = ?')
      .get('oxespace') as { name: string; transport: string; enabled: number; trusted: number; workspace_id: string | null; config_json: string }
    expect(row).toBeDefined()
    expect(row.workspace_id).toBeNull()
    expect(row.enabled).toBe(1)
    expect(row.trusted).toBe(1)
    expect(row.transport).toBe('stdio')
    const config = JSON.parse(row.config_json) as { command: string; args: string[]; env: Record<string, string> }
    expect(config.command).toBe('node')
    expect(config.args[0]).toContain('oxespace-mcp.cjs')
    expect(config.env.OXESPACE_MCP_PORT).toBe(String(status.port))
    // Regression guard: the env port must be the REAL bound port, never the
    // "0" OS-assign placeholder. A "0" here means the bridge connects to
    // 127.0.0.1:0 and every tool call fails with ECONNREFUSED.
    expect(config.env.OXESPACE_MCP_PORT).not.toBe('0')
    expect(Number(config.env.OXESPACE_MCP_PORT)).toBeGreaterThan(0)
    expect(config.env.OXESPACE_MCP_TOKEN).toMatch(/^[0-9a-f]{64}$/)

    // Bridge script materialized in userData/bin
    const bridgeOnDisk = readFileSync(status.bridgePath!, 'utf8')
    expect(bridgeOnDisk).toContain('oxespace-mcp')
    expect(bridgeOnDisk).toContain('OXESPACE_MCP_TOKEN')

    await handle.stop()
    db.close()
  })

  test('is idempotent — running start twice does not duplicate the row', async () => {
    const db = openInMemoryDatabase()
    const mcpManager = new McpManager(db)
    const make = () => createInternalMcpHandle({
      db,
      mcpManager,
      workspaceServ: new WorkspaceService(db),
      github: new GitHubService(db),
      background: new BackgroundManager(db, { emitOutput: () => undefined, emitUpdate: () => undefined }),
      fileSystem: new FileSystemService()
    })
    const first = make()
    await first.start()
    await first.stop()
    const second = make()
    await second.start()

    const rows = db.prepare("SELECT id FROM mcp_servers WHERE name = 'oxespace' AND workspace_id IS NULL").all()
    expect(rows).toHaveLength(1)
    await second.stop()
    db.close()
  })

  test('regenerateToken replaces the env token and re-syncs row', async () => {
    const db = openInMemoryDatabase()
    const mcpManager = new McpManager(db)
    const handle = createInternalMcpHandle({
      db,
      mcpManager,
      workspaceServ: new WorkspaceService(db),
      github: new GitHubService(db),
      background: new BackgroundManager(db, { emitOutput: () => undefined, emitUpdate: () => undefined }),
      fileSystem: new FileSystemService()
    })
    await handle.start()

    const before = db.prepare("SELECT config_json FROM mcp_servers WHERE name = 'oxespace'").get() as { config_json: string }
    const beforeToken = (JSON.parse(before.config_json) as { env: { OXESPACE_MCP_TOKEN: string } }).env.OXESPACE_MCP_TOKEN

    await handle.regenerateToken()

    const after = db.prepare("SELECT config_json FROM mcp_servers WHERE name = 'oxespace'").get() as { config_json: string }
    const afterToken = (JSON.parse(after.config_json) as { env: { OXESPACE_MCP_TOKEN: string } }).env.OXESPACE_MCP_TOKEN
    expect(afterToken).not.toBe(beforeToken)
    expect(afterToken).toMatch(/^[0-9a-f]{64}$/)

    await handle.stop()
    db.close()
  })
})
