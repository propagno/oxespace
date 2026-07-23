import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
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
  trusted: number
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

    // Resolve the workspace id up front — needed to inject
    // OXESPACE_WORKSPACE_ID into the internal MCP bridge's env so the
    // bridge knows which workspace it represents on its tool calls.
    const workspaceRow = this.db
      .prepare('SELECT id FROM workspaces WHERE root_path = ?')
      .get(workspaceRoot) as { id: string } | undefined

    // Servers visible to this workspace = global + own + enabled.
    const rows = this.db
      .prepare(
        `SELECT id, workspace_id, name, transport, config_json, enabled, trusted
         FROM mcp_servers
         WHERE enabled = 1
           AND trusted = 1
           AND (workspace_id IS NULL OR workspace_id = ?)`
      )
      .all(workspaceRow?.id ?? null) as ManagedRow[]

    const desiredEntries = new Map<string, unknown>()
    const desiredNames: string[] = []
    let internalServerKey: string | null = null
    for (const row of rows) {
      const isInternal = row.name === 'oxespace' && row.workspace_id === null
      const entry = serializeConfig(row.config_json, {
        injectWorkspaceId: isInternal && workspaceRow?.id ? workspaceRow.id : null
      })
      if (!entry) continue
      const key = sanitizeKey(row.name)
      // If two servers share a sanitized name we suffix to disambiguate.
      const finalKey = ensureUniqueKey(key, desiredEntries)
      desiredEntries.set(finalKey, entry)
      desiredNames.push(finalKey)
      if (isInternal) internalServerKey = finalKey
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

    // .mcp.json carries the internal bridge's machine-local token + port —
    // committing it leaks a secret AND is useless to teammates (their local
    // bridge has a different token). Keep it out of VCS in git repos.
    ensureGitignored(workspaceRoot, MCP_FILE)

    const snapshot: ManagedSnapshot = { names: desiredNames, updatedAtMs: Date.now() }
    const snapshotDir = join(workspaceRoot, SNAPSHOT_DIR)
    mkdirSync(snapshotDir, { recursive: true })
    writeFileSync(snapshotPath, JSON.stringify(snapshot, null, 2) + '\n', 'utf8')
    // Self-contained .gitignore so the snapshot dir never enters version
    // control — the snapshot is local state for OXESpace. (.mcp.json is kept out
    // of VCS separately via ensureGitignored above — it holds a local token.)
    const gitignorePath = join(snapshotDir, '.gitignore')
    if (!existsSync(gitignorePath)) {
      writeFileSync(gitignorePath, '# OXESpace internal state — do not commit\n*\n', 'utf8')
    }

    // Claude Code does NOT load project-scoped .mcp.json servers until the user
    // approves them — without this the server is listed but its tools never
    // appear (the reported "oxespace_hybrid_explore not available"). Approve our
    // managed servers for this project so they load on the next session.
    approveProjectServersInClaude(workspaceRoot, desiredNames)

    // Copilot CLI loads the server automatically but prompts once per tool
    // before running it. Pre-approve our read-only retrieval tools so the user
    // gets zero-friction access (mirrors the Claude approval above).
    if (internalServerKey) {
      approveOxespaceToolsInCopilot(workspaceRoot, internalServerKey, OXESPACE_COPILOT_TOOLS)
    }

    return mcpPath
  }
}

/**
 * Add our managed servers to Claude Code's per-project approval list
 * (`~/.claude.json` → projects.<root>.enabledMcpjsonServers). No-op if Claude
 * isn't set up. Atomic write, fresh read, only when something actually changes
 * (Claude rewrites this file too, so we minimise races).
 */
function approveProjectServersInClaude(workspaceRoot: string, serverNames: string[]): void {
  if (serverNames.length === 0) return
  const configPath = join(homedir(), '.claude.json')
  if (!existsSync(configPath)) return

  let doc: Record<string, unknown>
  try {
    const parsed = JSON.parse(readFileSync(configPath, 'utf8'))
    if (!isRecord(parsed)) return
    doc = parsed
  } catch {
    return
  }

  const projects = isRecord(doc.projects) ? { ...(doc.projects as Record<string, unknown>) } : {}
  // Claude keys projects by absolute path and stores forward slashes on Windows.
  const norm = (s: string) => s.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
  const wantKey = workspaceRoot.replace(/\\/g, '/')
  const existingKey = Object.keys(projects).find((k) => norm(k) === norm(wantKey))
  const key = existingKey ?? wantKey
  const proj = isRecord(projects[key]) ? { ...(projects[key] as Record<string, unknown>) } : {}

  const strArr = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [])
  const enabled = new Set(strArr(proj.enabledMcpjsonServers))
  const disabled = new Set(strArr(proj.disabledMcpjsonServers))

  let changed = !existingKey
  for (const name of serverNames) {
    if (!enabled.has(name)) { enabled.add(name); changed = true }
    if (disabled.has(name)) { disabled.delete(name); changed = true }
  }
  if (!changed) return

  proj.enabledMcpjsonServers = [...enabled]
  proj.disabledMcpjsonServers = [...disabled]
  projects[key] = proj
  doc.projects = projects

  try {
    const tmp = `${configPath}.oxespace.tmp`
    writeFileSync(tmp, JSON.stringify(doc, null, 2) + '\n', 'utf8')
    renameSync(tmp, configPath)
  } catch {
    // Best-effort: a transient lock from a running Claude shouldn't crash sync.
  }
}

// The internal oxespace MCP's read-only retrieval tools — safe to auto-approve
// for Copilot execution. Deliberately excludes side-effecting tools (e.g. web
// preview capture), which the user should still approve interactively.
const OXESPACE_COPILOT_TOOLS = ['oxespace_hybrid_explore', 'oxespace_semantic_search']

/**
 * Pre-approve our read-only tools for Copilot CLI so it doesn't prompt on first
 * use. Copilot stores per-location approvals in `~/.copilot/permissions-config.json`
 * keyed by the native (backslash) path. No-op if Copilot isn't set up. Atomic,
 * fresh-read, only writes when something changes.
 */
function approveOxespaceToolsInCopilot(workspaceRoot: string, serverName: string, toolNames: string[]): void {
  if (toolNames.length === 0) return
  const copilotHome = process.env.COPILOT_HOME || join(homedir(), '.copilot')
  if (!existsSync(copilotHome)) return // Copilot not installed
  const configPath = join(copilotHome, 'permissions-config.json')

  let doc: Record<string, unknown> = {}
  if (existsSync(configPath)) {
    try {
      const parsed = JSON.parse(readFileSync(configPath, 'utf8'))
      if (isRecord(parsed)) doc = parsed
    } catch {
      return // don't clobber a file we can't parse
    }
  }

  const locations = isRecord(doc.locations) ? { ...(doc.locations as Record<string, unknown>) } : {}
  // Copilot keys locations by the native path (backslashes on Windows). Match an
  // existing key case/separator-insensitively, else use the root as-is.
  const norm = (s: string) => s.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
  const existingKey = Object.keys(locations).find((k) => norm(k) === norm(workspaceRoot))
  const key = existingKey ?? workspaceRoot
  const loc = isRecord(locations[key]) ? { ...(locations[key] as Record<string, unknown>) } : {}
  const approvals = Array.isArray(loc.tool_approvals)
    ? (loc.tool_approvals as unknown[]).filter(isRecord)
    : []

  const has = (tool: string) =>
    approvals.some((a) => a.kind === 'mcp' && a.serverName === serverName && a.toolName === tool)

  let changed = !existingKey
  for (const tool of toolNames) {
    if (!has(tool)) {
      approvals.push({ kind: 'mcp', serverName, toolName: tool })
      changed = true
    }
  }
  if (!changed) return

  loc.tool_approvals = approvals
  locations[key] = loc
  doc.locations = locations

  try {
    const tmp = `${configPath}.oxespace.tmp`
    writeFileSync(tmp, JSON.stringify(doc, null, 2) + '\n', 'utf8')
    renameSync(tmp, configPath)
  } catch {
    // Best-effort: a transient lock from a running Copilot shouldn't crash sync.
  }
}

interface SerializeOptions {
  injectWorkspaceId: string | null
}

function serializeConfig(configJson: string, options: SerializeOptions): unknown {
  let parsed: McpServerConfig
  try {
    parsed = JSON.parse(configJson) as McpServerConfig
  } catch {
    return null
  }
  if (parsed.transport === 'stdio') {
    const cfg = parsed as McpStdioConfig
    const env: Record<string, string> = { ...(cfg.env ?? {}) }
    // The internal "oxespace" MCP bridge needs to know its workspace at
    // spawn time — and the env varies per workspace, so we patch it here
    // (the DB row keeps only port + token, common across workspaces).
    if (options.injectWorkspaceId) {
      env.OXESPACE_WORKSPACE_ID = options.injectWorkspaceId
    }
    const entry: Record<string, unknown> = {
      command: cfg.command,
      args: cfg.args ?? []
    }
    if (Object.keys(env).length > 0) entry.env = env
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

/**
 * Idempotently ensure `entry` is in the workspace's .gitignore. Only acts on git
 * repos (presence of `.git`) so non-versioned folders aren't littered. Best-effort:
 * never throws — .gitignore hygiene must not break MCP sync.
 */
function ensureGitignored(workspaceRoot: string, entry: string): void {
  try {
    if (!existsSync(join(workspaceRoot, '.git'))) return
    const gitignorePath = join(workspaceRoot, '.gitignore')
    const content = existsSync(gitignorePath) ? readFileSync(gitignorePath, 'utf8') : ''
    if (content.split(/\r?\n/).some((line) => line.trim() === entry)) return
    const sep = content.length === 0 ? '' : content.endsWith('\n') ? '' : '\n'
    appendFileSync(gitignorePath, `${sep}\n# OXESpace internal MCP config — machine-local token, do not commit\n${entry}\n`)
  } catch {
    // Best-effort.
  }
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
