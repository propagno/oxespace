import type { AppDatabase } from '../../db/index'
import type { HttpAuditActor, HttpAuditPage, HttpAuditQuery, HttpAuditRow } from '../../../../shared/types/http-audit'
import { parseHttpCalls, redactCommand, statusFromOutput } from './parse'

export const HTTP_AUDIT_RETENTION_DAYS = 90
export const HTTP_AUDIT_MAX_ROWS = 50_000
const DAY_MS = 86_400_000
const MAX_PENDING_STARTS = 2048

export interface HttpAuditIngestInput {
  paneId?: string
  threadId?: string
  actor?: string
  workspaceId: string
  agent: string
  sessionId?: string | null
  at?: number
  record: unknown
  source?: 'hook' | 'rollout'
  durationMs?: number | null
}

export interface HttpAuditDeps {
  isProductionHost?: (workspaceId: string, host: string) => boolean
}

function parseJsonStringArray(raw: unknown): string[] {
  if (typeof raw !== 'string' || !raw) return []
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : []
  } catch {
    return []
  }
}

export function resolveAuditActor(db: AppDatabase, rawActor: string): HttpAuditActor {
  if (rawActor.startsWith('pane:')) {
    const id = rawActor.slice(5)
    try {
      const row = db.prepare('SELECT display_name FROM panes WHERE id = ?').get(id) as { display_name?: string | null } | undefined
      if (row) return { kind: 'pane', id, name: row.display_name?.trim() || id, gone: false }
    } catch {
      /* ignore */
    }
    return { kind: 'pane', id, name: id, gone: true }
  }
  if (rawActor.startsWith('thread:')) {
    const id = rawActor.slice(7)
    try {
      const row = db.prepare('SELECT data_json FROM conversation_threads WHERE id = ?').get(id) as { data_json?: string } | undefined
      if (row?.data_json) {
        const parsed = JSON.parse(row.data_json) as { title?: string }
        return { kind: 'thread', id, name: parsed.title?.trim() || id, gone: false }
      }
    } catch {
      /* ignore */
    }
    return { kind: 'thread', id, name: id, gone: true }
  }
  return { kind: 'unknown', id: rawActor, name: rawActor, gone: true }
}

export function mapHttpAuditRow(
  db: AppDatabase,
  raw: Record<string, unknown>,
  isProductionHost: (workspaceId: string, host: string) => boolean
): HttpAuditRow {
  const workspaceId = String(raw.workspace_id ?? '')
  const host = String(raw.host ?? '')
  return {
    id: Number(raw.id),
    at: Number(raw.ts),
    actor: resolveAuditActor(db, String(raw.actor ?? '')),
    workspaceId,
    agent: String(raw.agent ?? 'claude-code'),
    sourceKind: raw.source === 'rollout' ? 'rollout' : 'hook',
    tool: String(raw.tool ?? 'curl'),
    method: String(raw.method ?? 'GET'),
    scheme: String(raw.scheme ?? 'https'),
    host,
    port: Number(raw.port ?? 443),
    pathTemplate: String(raw.path_template ?? '/'),
    queryKeys: parseJsonStringArray(raw.query_keys_json),
    headerNames: parseJsonStringArray(raw.header_names_json),
    hasBody: Number(raw.has_body) === 1,
    bodyBytes: raw.body_bytes == null ? null : Number(raw.body_bytes),
    status: raw.status == null ? null : Number(raw.status),
    durationMs: raw.duration_ms == null ? null : Number(raw.duration_ms),
    insecure: Number(raw.insecure) === 1,
    plainHttpExternal: Number(raw.plain_http_external) === 1,
    commandRedacted: String(raw.command_redacted ?? ''),
    outputTruncated: Number(raw.output_truncated) === 1,
    production: Boolean(isProductionHost(workspaceId, host))
  }
}

export class HttpAuditLog {
  private readonly preToolStarts = new Map<string, number>()

  constructor(
    private readonly db: AppDatabase,
    private readonly now: () => number = Date.now,
    private readonly deps: HttpAuditDeps = {}
  ) {}

  ingest = (input: HttpAuditIngestInput): number => {
    try {
      if (!input || typeof input.record !== 'object' || input.record === null) return 0
      const record = input.record as Record<string, unknown>
      const eventName = typeof record.hook_event_name === 'string' ? record.hook_event_name : ''
      const toolUseId = typeof record.tool_use_id === 'string' ? record.tool_use_id.trim() : ''
      const at = typeof input.at === 'number' && Number.isFinite(input.at) ? Math.trunc(input.at) : this.now()

      if (eventName === 'PreToolUse') {
        if (toolUseId) {
          if (this.preToolStarts.size >= MAX_PENDING_STARTS) {
            const oldest = this.preToolStarts.keys().next().value
            if (oldest !== undefined) this.preToolStarts.delete(oldest)
          }
          this.preToolStarts.set(toolUseId, at)
        }
        return 0
      }

      if (eventName !== 'PostToolUse' || !toolUseId) return 0

      const toolName = typeof record.tool_name === 'string' ? record.tool_name.trim() : ''
      if (!/^(bash|powershell|pwsh|sh|shell|local_shell|local_shell_call)$/i.test(toolName)) return 0
      const shell: 'bash' | 'powershell' = /^(powershell|pwsh)$/i.test(toolName) ? 'powershell' : 'bash'

      const toolInput = record.tool_input && typeof record.tool_input === 'object'
        ? (record.tool_input as Record<string, unknown>)
        : null
      const command = typeof toolInput?.command === 'string' ? toolInput.command : ''
      if (!command.trim()) return 0

      const calls = parseHttpCalls(command, shell)
      if (calls.length === 0) return 0

      let durationMs: number | null = null
      if (typeof input.durationMs === 'number' && Number.isFinite(input.durationMs)) {
        durationMs = Math.max(0, Math.round(input.durationMs))
      } else if (this.preToolStarts.has(toolUseId)) {
        const startedAt = this.preToolStarts.get(toolUseId)!
        this.preToolStarts.delete(toolUseId)
        durationMs = Math.max(0, at - startedAt)
      }

      const toolResponse = record.tool_response && typeof record.tool_response === 'object'
        ? (record.tool_response as Record<string, unknown>)
        : null
      const stdoutHead = typeof toolResponse?.stdoutHead === 'string'
        ? toolResponse.stdoutHead
        : (typeof toolResponse?.stdout === 'string' ? toolResponse.stdout.slice(0, 4096) : '')
      const status = statusFromOutput(stdoutHead)
      const outputTruncated = toolResponse?.truncated === true ? 1 : 0
      const commandRedacted = redactCommand(command, shell).slice(0, 512)
      const actor = input.actor ?? (input.threadId ? `thread:${input.threadId}` : `pane:${input.paneId ?? 'unknown'}`)
      const workspaceId = String(input.workspaceId || '')
      const agent = String(input.agent || 'claude-code')
      const sessionId = typeof input.sessionId === 'string'
        ? input.sessionId
        : (typeof record.session_id === 'string' ? record.session_id : null)
      const source = input.source === 'rollout' ? 'rollout' : 'hook'

      const stmt = this.db.prepare(`
        INSERT OR IGNORE INTO agent_http_audit (
          ts, actor, workspace_id, agent, session_id, source, tool_use_id, call_index,
          tool, method, scheme, host, port, path_template, query_keys_json, header_names_json,
          has_body, body_bytes, status, duration_ms, insecure, plain_http_external,
          command_redacted, output_truncated
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)

      let added = 0
      this.db.transaction(() => {
        calls.forEach((call, callIndex) => {
          if (!call.host) return
          const info = stmt.run(
            at,
            actor,
            workspaceId,
            agent,
            sessionId,
            source,
            toolUseId,
            callIndex,
            call.tool,
            call.method,
            call.scheme,
            call.host,
            call.port,
            call.path,
            JSON.stringify(call.queryKeys),
            JSON.stringify(call.headerNames),
            call.hasBody ? 1 : 0,
            call.bodyBytes,
            status,
            durationMs,
            call.insecure ? 1 : 0,
            call.plainHttpExternal ? 1 : 0,
            commandRedacted,
            outputTruncated
          )
          if (info.changes > 0) added += 1
        })
      })()
      return added
    } catch {
      return 0
    }
  }

  list = (query: HttpAuditQuery): HttpAuditPage => {
    if (!query || typeof query !== 'object' || typeof query.workspaceId !== 'string' || !query.workspaceId.trim()) {
      throw new Error('Invalid workspaceId')
    }
    const view = query.view ?? 'all'
    if (view !== 'all' && view !== 'errors' && view !== 'flagged') {
      throw new Error(`Invalid HTTP audit view: ${String(view)}`)
    }
    if (query.actor !== undefined && (typeof query.actor !== 'string' || query.actor.length > 200)) {
      throw new Error('Invalid HTTP audit actor filter')
    }
    const limit = Math.min(200, Math.max(1, Math.trunc(query.limit ?? 50)))
    const isProd = this.deps.isProductionHost ?? (() => false)
    const needle = typeof query.filter === 'string' && query.filter.trim() ? query.filter.trim().toLowerCase() : ''

    const rawRows = (query.actor
      ? this.db
          .prepare('SELECT * FROM agent_http_audit WHERE workspace_id = ? AND actor = ? ORDER BY ts DESC, id DESC')
          .all(query.workspaceId, query.actor)
      : this.db
          .prepare('SELECT * FROM agent_http_audit WHERE workspace_id = ? ORDER BY ts DESC, id DESC')
          .all(query.workspaceId)) as Array<Record<string, unknown>>

    const matching: HttpAuditRow[] = []
    for (const raw of rawRows) {
      const row = mapHttpAuditRow(this.db, raw, isProd)
      if (view === 'errors' && !(row.status === null || row.status >= 400)) continue
      if (view === 'flagged' && !(row.production || row.insecure || row.plainHttpExternal)) continue
      if (needle && !row.host.toLowerCase().includes(needle) && !row.pathTemplate.toLowerCase().includes(needle)) continue
      matching.push(row)
    }

    const hostMap = new Map<string, { host: string; count: number; production: boolean }>()
    for (const row of matching) {
      const existing = hostMap.get(row.host)
      if (existing) existing.count += 1
      else hostMap.set(row.host, { host: row.host, count: 1, production: row.production })
    }
    const hosts = [...hostMap.values()].sort((a, b) => b.count - a.count)

    let afterCursor = matching
    if (typeof query.cursor === 'string' && query.cursor.includes(':')) {
      const [cTs, cId] = query.cursor.split(':').map(Number)
      if (Number.isFinite(cTs) && Number.isFinite(cId)) {
        afterCursor = matching.filter(r => r.at < cTs || (r.at === cTs && r.id < cId))
      }
    }

    const rows = afterCursor.slice(0, limit)
    const last = rows[rows.length - 1]
    const cursor = afterCursor.length > limit && last ? `${last.at}:${last.id}` : null
    return { rows, cursor, hosts }
  }

  prune = (now = this.now()): number => {
    try {
      const cutoff = now - HTTP_AUDIT_RETENTION_DAYS * DAY_MS
      let removed = 0
      this.db.transaction(() => {
        removed += this.db.prepare('DELETE FROM agent_http_audit WHERE ts < ?').run(cutoff).changes
        const count = (this.db.prepare('SELECT COUNT(*) AS n FROM agent_http_audit').get() as { n: number }).n
        if (count > HTTP_AUDIT_MAX_ROWS) {
          removed += this.db.prepare(`
            DELETE FROM agent_http_audit
            WHERE id NOT IN (
              SELECT id FROM agent_http_audit ORDER BY ts DESC, id DESC LIMIT ?
            )
          `).run(HTTP_AUDIT_MAX_ROWS).changes
        }
      })()
      return removed
    } catch {
      return 0
    }
  }
}
