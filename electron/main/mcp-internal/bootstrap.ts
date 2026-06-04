import { createHash, randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { app } from 'electron'
import type { AppDatabase } from '../db/index'
import type { BackgroundManager } from '../services/background.service'
import type { FileSystemService } from '../services/file-system.service'
import type { GitHubService } from '../services/github.service'
import type { McpManager } from '../services/mcp.service'
import type { SemanticService } from '../services/semantic.service'
import type { WorkspaceService } from '../services/workspace.service'
import type {
  InternalMcpStatus,
  InternalMcpWebPreviewEvent,
  InternalMcpWorktreeChangedEvent
} from '../../../shared/types/mcp-internal'
import { createLocalRpcServer, type LocalRpcServer } from './local-rpc-server'
import { TOOL_REGISTRY } from './tool-registry'
import { WebPreviewBus } from './web-preview-bus'
import { WorktreeEventBus } from './worktree-event-bus'
// Embed the bridge script as a string at build time. Vite's `?raw` inlines
// the file content into the main bundle — so materialization never depends
// on a copy plugin firing first, on process.resourcesPath, or on __dirname
// resolving to the right place in dev vs packaged. The on-disk copy under
// <userData>/bin is what agent CLIs spawn; this string is its source of truth.
import bridgeSource from '../../../resources/mcp-bridge/oxespace-mcp.cjs?raw'

/**
 * Lifecycle for the internal "oxespace" MCP server.
 *
 * Responsibilities (in order, run from main on app-ready):
 *   1. Generate or reuse the port + token (singleton row `internal_mcp_meta`).
 *   2. Materialize the bridge script under `<userData>/bin/oxespace-mcp.js`.
 *   3. Insert/update the global row in `mcp_servers` (workspace_id NULL,
 *      trusted=1, enabled=1) so `mcp-sync` propagates to every workspace.
 *   4. Start the local RPC server on 127.0.0.1:<port>.
 *   5. Force a sync pass so existing workspaces gain the entry immediately.
 *
 * Reuses port+token across app restarts: agent CLIs that the user kept
 * running with their pane open already cached this env at spawn time. If
 * we generate new credentials every boot, those panes break on the next
 * tool call. The DB row keeps the truth.
 */

interface InternalMcpMetaRow {
  id: string
  port: number
  token: string
  generated_at: number
  server_row_id: string | null
}

export interface InternalMcpDeps {
  db: AppDatabase
  mcpManager: McpManager
  workspaceServ: WorkspaceService
  github: GitHubService
  background: BackgroundManager
  fileSystem: FileSystemService
  semantic: SemanticService
}

export interface InternalMcpHandle {
  start(): Promise<void>
  stop(): Promise<void>
  getStatus(): InternalMcpStatus
  regenerateToken(): Promise<InternalMcpStatus>
  onWebPreview(listener: (event: InternalMcpWebPreviewEvent) => void): () => void
  onWorktreeChanged(listener: (event: InternalMcpWorktreeChangedEvent) => void): () => void
}

const SINGLETON_ID = 'singleton'
const SERVER_NAME = 'oxespace'
const BRIDGE_DEST_DIR = 'bin'
const BRIDGE_DEST_FILE = 'oxespace-mcp.cjs'

export function createInternalMcpHandle(deps: InternalMcpDeps): InternalMcpHandle {
  const webPreview = new WebPreviewBus()
  const worktree = new WorktreeEventBus()
  const rpc: LocalRpcServer = createLocalRpcServer({
    workspaceServ: deps.workspaceServ,
    github: deps.github,
    background: deps.background,
    fileSystem: deps.fileSystem,
    semantic: deps.semantic,
    webPreview,
    worktree
  })

  let lastError: string | null = null
  let serverRowId: string | null = null
  let bridgePath: string | null = null
  let activePort: number | null = null
  let startedAtMs: number = Date.now()

  async function start(): Promise<void> {
    startedAtMs = Date.now()
    try {
      const meta = loadOrCreateMeta(deps.db)
      // 1. Materialize bridge — needs to exist before the DB row references it.
      bridgePath = ensureBridgeScript()

      // 2. Ensure the global mcp_servers row exists.
      serverRowId = ensureServerRow(deps.mcpManager, bridgePath, meta.port, meta.token, meta.server_row_id)
      if (serverRowId !== meta.server_row_id) {
        updateMetaServerRow(deps.db, serverRowId)
      }

      // 3. Start the local RPC server. The saved port may be 0 (first run —
      //    OS assigns) or a previously-bound real port that might now be
      //    taken. Either way, once we know the ACTUAL bound port we reconcile
      //    it back into the meta row + the mcp_servers env so `.mcp.json`
      //    carries a real port (not the 0 placeholder). Missing this step was
      //    the bug that left the bridge connecting to 127.0.0.1:0 and failing
      //    every tool call with ECONNREFUSED.
      rpc.setToken(meta.token)
      let bound: number
      try {
        bound = (await rpc.start(meta.port)).port
      } catch {
        bound = (await rpc.start(0)).port
      }
      if (bound !== meta.port) {
        updateMetaPort(deps.db, bound)
        rebindServerRow(deps.mcpManager, serverRowId, bridgePath, bound, meta.token)
      }
      activePort = bound
      lastError = null
      // eslint-disable-next-line no-console
      console.log(`[internal-mcp] ready on 127.0.0.1:${bound} · bridge: ${bridgePath}`)
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err)
      // Don't rethrow — the app should still boot even if the internal MCP
      // can't bind (corporate firewall, port exhaustion, etc.). Status is
      // surfaced via getStatus() in the MCP panel card.
      // eslint-disable-next-line no-console
      console.warn('[internal-mcp] start failed:', lastError)
    }
  }

  async function stop(): Promise<void> {
    try {
      await rpc.stop()
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('[internal-mcp] stop error:', err instanceof Error ? err.message : err)
    }
  }

  async function regenerateToken(): Promise<InternalMcpStatus> {
    const meta = loadOrCreateMeta(deps.db)
    const nextToken = randomBytes(32).toString('hex')
    updateMetaToken(deps.db, nextToken)
    rpc.setToken(nextToken)
    if (serverRowId && bridgePath && activePort !== null) {
      rebindServerRow(deps.mcpManager, serverRowId, bridgePath, activePort, nextToken)
    }
    // After token change, all panes need to be restarted to pick up the env.
    // We surface that warning via the UI toast — no automatic restart.
    return getStatus()
  }

  function getStatus(): InternalMcpStatus {
    const rpcStatus = rpc.getStatus()
    return {
      running: rpcStatus.running,
      port: rpcStatus.port,
      bridgePath,
      serverRowId,
      lastError,
      uptimeMs: rpcStatus.running ? Date.now() - startedAtMs : 0,
      toolCount: TOOL_REGISTRY.length,
      tools: TOOL_REGISTRY.map((entry) => ({
        name: entry.descriptor.name,
        description: entry.descriptor.description
      }))
    }
  }

  function onWebPreview(listener: (event: InternalMcpWebPreviewEvent) => void): () => void {
    return webPreview.subscribe(listener)
  }

  function onWorktreeChanged(listener: (event: InternalMcpWorktreeChangedEvent) => void): () => void {
    return worktree.subscribe(listener)
  }

  return { start, stop, getStatus, regenerateToken, onWebPreview, onWorktreeChanged }
}

/* ── meta singleton helpers ───────────────────────────────────── */

function loadOrCreateMeta(db: AppDatabase): InternalMcpMetaRow {
  const existing = db
    .prepare('SELECT id, port, token, generated_at, server_row_id FROM internal_mcp_meta WHERE id = ?')
    .get(SINGLETON_ID) as InternalMcpMetaRow | undefined
  if (existing) return existing

  const port = 0 // OS-assigned on first listen; rewritten back to DB.
  const token = randomBytes(32).toString('hex')
  const now = Date.now()
  db.prepare(
    'INSERT INTO internal_mcp_meta (id, port, token, generated_at, server_row_id) VALUES (?, ?, ?, ?, ?)'
  ).run(SINGLETON_ID, port, token, now, null)
  return { id: SINGLETON_ID, port, token, generated_at: now, server_row_id: null }
}

function updateMetaPort(db: AppDatabase, port: number): void {
  db.prepare('UPDATE internal_mcp_meta SET port = ? WHERE id = ?').run(port, SINGLETON_ID)
}

function updateMetaToken(db: AppDatabase, token: string): void {
  db.prepare('UPDATE internal_mcp_meta SET token = ?, generated_at = ? WHERE id = ?').run(token, Date.now(), SINGLETON_ID)
}

function updateMetaServerRow(db: AppDatabase, serverRowId: string): void {
  db.prepare('UPDATE internal_mcp_meta SET server_row_id = ? WHERE id = ?').run(serverRowId, SINGLETON_ID)
}

/* ── bridge script materialization ────────────────────────────── */

function ensureBridgeScript(): string {
  const destDir = join(app.getPath('userData'), BRIDGE_DEST_DIR)
  const destPath = join(destDir, BRIDGE_DEST_FILE)
  const current = existsSync(destPath) ? readFileSync(destPath, 'utf8') : ''
  if (hash(bridgeSource) === hash(current)) {
    return destPath
  }
  mkdirSync(destDir, { recursive: true })
  const tmp = destPath + '.tmp'
  writeFileSync(tmp, bridgeSource, 'utf8')
  renameSync(tmp, destPath)
  return destPath
}

function hash(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

/* ── mcp_servers row helpers ──────────────────────────────────── */

function buildEnv(port: number, token: string): Record<string, string> {
  return {
    OXESPACE_MCP_PORT: String(port),
    OXESPACE_MCP_TOKEN: token
  }
}

function ensureServerRow(
  manager: McpManager,
  bridgePath: string,
  port: number,
  token: string,
  previousId: string | null
): string {
  const existing = previousId ? manager.get(previousId) : findGlobalByName(manager, SERVER_NAME)
  if (existing) {
    manager.update({
      id: existing.id,
      enabled: true,
      trusted: true,
      transport: 'stdio',
      config: {
        transport: 'stdio',
        command: 'node',
        args: [bridgePath],
        env: buildEnv(port, token)
      }
    })
    return existing.id
  }
  const created = manager.create({
    workspaceId: null,
    name: SERVER_NAME,
    transport: 'stdio',
    enabled: true,
    trusted: true,
    config: {
      transport: 'stdio',
      command: 'node',
      args: [bridgePath],
      env: buildEnv(port, token)
    }
  })
  return created.id
}

function rebindServerRow(manager: McpManager, id: string, bridgePath: string, port: number, token: string): void {
  manager.update({
    id,
    enabled: true,
    trusted: true,
    transport: 'stdio',
    config: {
      transport: 'stdio',
      command: 'node',
      args: [bridgePath],
      env: buildEnv(port, token)
    }
  })
}

function findGlobalByName(manager: McpManager, name: string): { id: string } | null {
  // McpManager.list(null) returns globals plus the (null) workspace's own —
  // since we pass null and globals have workspace_id NULL, we filter to that.
  const all = manager.list(null)
  return all.find((s) => s.name === name && s.workspaceId === null) ?? null
}
