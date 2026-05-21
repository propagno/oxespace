import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { AppDatabase } from '../db/index'
import type { McpHttpConfig, McpServerConfig, McpStdioConfig } from '../../../shared/types/mcp'

/**
 * Materializes the workspace's enabled MCP servers into `<workspaceRoot>/.mcp.json`
 * so external agent CLIs (Claude Code, Copilot CLI ≥ 1.0, Cursor, etc.) can pick
 * them up on their next session start. This is the bridge between the OXESpace
 * MCP panel and the agent processes running in terminal panes — without it,
 * starting an MCP in OXESpace has no effect on the running CLI.
 *
 * Behavior:
 * - Global servers (workspace_id IS NULL) are written to every workspace's file.
 * - Only `enabled = 1` rows are included. Disabling in OXESpace removes the
 *   entry on next sync.
 * - We never blow away entries we didn't write: a sidecar snapshot
 *   (`.oxespace/mcp-managed.json`) records the names we own so disable/delete
 *   only touches OXESpace-managed keys.
 *
 * The agent CLI must restart its session to pick up the new file — the user
 * sees a hint in the MCP panel.
 */

interface ManagedRow {
  id: string
  workspace_id: string | null
  name: string
  transport: 'stdio' | 'http' | 'sse'
  config_json: string
  enabled: number
}

interface WorkspaceRootRow {
  id: string
  root_path: string
}

interface ManagedSnapshot {
  names: string[]
  updatedAtMs: number
}

const SNAPSHOT_DIR = '.oxespace'
const SNAPSHOT_FILE = 'mcp-managed.json'
const MCP_FILE = '.mcp.json'

export class McpConfigSync {
  constructor(private readonly db: AppDatabase) {}

  /**
   * Re-syncs `.mcp.json` for the given workspace. Safe to call multiple times.
   * Returns the absolute path that was written, or null when the workspace's
   * root is missing or no longer exists on disk.
   */
  syncWorkspace(workspaceId: string): string | null {
    const workspace = this.db
      .prepare('SELECT id, root_path FROM workspaces WHERE id = ?')
      .get(workspaceId) as WorkspaceRootRow | undefined
    if (!workspace || !workspace.root_path || !existsSync(workspace.root_path)) return null

    return this.writeMcpJson(workspace.root_path)
  }

  /**
   * Re-syncs every workspace. Use when a global server (workspace_id NULL) is
   * changed — it affects all workspaces.
   */
  syncAll(): void {
    const workspaces = this.db.prepare('SELECT id, root_path FROM workspaces').all() as WorkspaceRootRow[]
    for (const ws of workspaces) {
      if (ws.root_path && existsSync(ws.root_path)) this.writeMcpJson(ws.root_path)
    }
  }

  /**
   * Fan-out helper used by McpManager after mutations: if the server is
   * workspace-scoped sync only that workspace; if global sync all.
   */
  syncForServer(workspaceId: string | null): void {
    if (workspaceId === null) this.syncAll()
    else this.syncWorkspace(workspaceId)
  }

  private writeMcpJson(workspaceRoot: string): string | null {
    const mcpPath = join(workspaceRoot, MCP_FILE)
    const snapshotPath = join(workspaceRoot, SNAPSHOT_DIR, SNAPSHOT_FILE)

    // Servers visible to this workspace = global + own + enabled.
    const rows = this.db
      .prepare(
        `SELECT id, workspace_id, name, transport, config_json, enabled
         FROM mcp_servers
         WHERE enabled = 1
           AND (workspace_id IS NULL OR workspace_id = (SELECT id FROM workspaces WHERE root_path = ?))`
      )
      .all(workspaceRoot) as ManagedRow[]

    const desiredEntries = new Map<string, unknown>()
    const desiredNames: string[] = []
    for (const row of rows) {
      const entry = serializeConfig(row.config_json)
      if (!entry) continue
      const key = sanitizeKey(row.name)
      // If two servers share a sanitized name we suffix to disambiguate.
      const finalKey = ensureUniqueKey(key, desiredEntries)
      desiredEntries.set(finalKey, entry)
      desiredNames.push(finalKey)
    }

    // Merge: read existing .mcp.json (if any), preserve keys the user added
    // manually, drop keys we previously managed but no longer want, add/update
    // our current set.
    const existing = readJsonSafe(mcpPath) ?? {}
    const rawServers = (existing as { mcpServers?: unknown }).mcpServers
    const mcpServers: Record<string, unknown> = isRecord(rawServers) ? { ...rawServers } : {}

    const previousSnapshot = readSnapshotSafe(snapshotPath)
    for (const oldName of previousSnapshot?.names ?? []) {
      if (!desiredEntries.has(oldName)) delete mcpServers[oldName]
    }
    for (const [key, value] of desiredEntries) {
      mcpServers[key] = value
    }

    const nextDoc = { ...(existing as object), mcpServers }
    writeFileSync(mcpPath, JSON.stringify(nextDoc, null, 2) + '\n', 'utf8')

    const snapshot: ManagedSnapshot = { names: desiredNames, updatedAtMs: Date.now() }
    const snapshotDir = join(workspaceRoot, SNAPSHOT_DIR)
    mkdirSync(snapshotDir, { recursive: true })
    writeFileSync(snapshotPath, JSON.stringify(snapshot, null, 2) + '\n', 'utf8')
    // Self-contained .gitignore so the snapshot dir never enters version
    // control — the snapshot is local state for OXESpace, while .mcp.json
    // itself is meant to be committed alongside the project.
    const gitignorePath = join(snapshotDir, '.gitignore')
    if (!existsSync(gitignorePath)) {
      writeFileSync(gitignorePath, '# OXESpace internal state — do not commit\n*\n', 'utf8')
    }

    return mcpPath
  }
}

function serializeConfig(configJson: string): unknown {
  let parsed: McpServerConfig
  try {
    parsed = JSON.parse(configJson) as McpServerConfig
  } catch {
    return null
  }
  if (parsed.transport === 'stdio') {
    const cfg = parsed as McpStdioConfig
    const entry: Record<string, unknown> = {
      command: cfg.command,
      args: cfg.args ?? []
    }
    if (cfg.env && Object.keys(cfg.env).length > 0) entry.env = cfg.env
    return entry
  }
  const cfg = parsed as McpHttpConfig
  const entry: Record<string, unknown> = {
    type: parsed.transport, // 'http' | 'sse' — Claude Code reads this discriminator
    url: cfg.url
  }
  if (cfg.headers && Object.keys(cfg.headers).length > 0) entry.headers = cfg.headers
  return entry
}

function sanitizeKey(name: string): string {
  // Agent CLIs are tolerant of names but a slug avoids surprises with spaces /
  // shell-special chars when the user references the server later.
  const slug = name.trim().toLowerCase().replace(/[^a-z0-9-_]+/g, '-').replace(/^-+|-+$/g, '')
  return slug || 'mcp-server'
}

function ensureUniqueKey(base: string, taken: Map<string, unknown>): string {
  if (!taken.has(base)) return base
  let counter = 2
  while (taken.has(`${base}-${counter}`)) counter += 1
  return `${base}-${counter}`
}

function readJsonSafe(path: string): unknown {
  if (!existsSync(path)) return null
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    return null
  }
}

function readSnapshotSafe(path: string): ManagedSnapshot | null {
  const value = readJsonSafe(path)
  if (!isRecord(value)) return null
  const names = Array.isArray((value as { names?: unknown }).names) ? (value as { names: unknown[] }).names.filter((n): n is string => typeof n === 'string') : []
  return { names, updatedAtMs: Number((value as { updatedAtMs?: unknown }).updatedAtMs) || 0 }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
