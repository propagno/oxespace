import type { AppDatabase } from '../../db/index'
import {
  AGENT_ACTIVITY_SOURCES,
  type AgentActivityBadge,
  type AgentActivityBadgeQuery,
  type AgentActivityPage,
  type AgentActivityQuery,
  type AgentActivityRow,
  type AgentActivitySource,
  type AgentActivitySummary
} from '../../../../shared/types/agent-activity'
import { resolveAuditActor } from '../http-audit/store'

export interface AgentActivityDeps {
  isProductionHost?: (workspaceId: string, host: string) => boolean
  pendingFor?: (connectionId: string) => boolean
  now?: () => number
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

export function parseAgentActivityQuery(input?: unknown): AgentActivityQuery {
  if (input === undefined || input === null) return {}
  if (typeof input !== 'object' || Array.isArray(input)) throw new Error('Query must be an object')
  const q = input as Record<string, unknown>
  if (q.sources !== undefined) {
    if (!Array.isArray(q.sources) || q.sources.length === 0) throw new Error('sources must be a non-empty array')
    for (const s of q.sources) {
      if (!AGENT_ACTIVITY_SOURCES.includes(s as AgentActivitySource)) {
        throw new Error(`Unknown source: ${String(s)}`)
      }
    }
  }
  if (q.view !== undefined && q.view !== 'all' && q.view !== 'problems') {
    throw new Error(`Unknown view: ${String(q.view)}`)
  }
  if (q.agent !== undefined && (typeof q.agent !== 'string' || q.agent.length > 200)) {
    throw new Error('Invalid agent')
  }
  if (q.workspaceId !== undefined && (typeof q.workspaceId !== 'string' || q.workspaceId.length > 200)) {
    throw new Error('Invalid workspaceId')
  }
  if (q.cursor !== undefined && (typeof q.cursor !== 'string' || q.cursor.length > 200)) {
    throw new Error('Invalid cursor')
  }
  return q as AgentActivityQuery
}

export class AgentActivity {
  constructor(
    private readonly db: AppDatabase,
    private readonly deps: AgentActivityDeps = {}
  ) {}

  private now(): number {
    return this.deps.now ? this.deps.now() : Date.now()
  }

  private buildStatement(
    source: AgentActivitySource,
    query: AgentActivityQuery,
    limit: number
  ): { source: AgentActivitySource; sql: string; params: unknown[] } {
    const params: unknown[] = []
    let cursorClause = ''
    if (query.cursor && query.cursor.includes(':')) {
      const cursorTs = Number(query.cursor.split(':')[0])
      if (Number.isFinite(cursorTs)) {
        cursorClause = 'ts <= ?'
        params.push(cursorTs)
      }
    }

    let sql = ''
    switch (source) {
      case 'changes': {
        const where = cursorClause ? `WHERE ${cursorClause} ` : ''
        sql = `SELECT * FROM agent_action_audit INDEXED BY idx_agent_action_audit_ts ${where}ORDER BY ts DESC LIMIT ?`
        break
      }
      case 'databases': {
        const conds = ["tool NOT LIKE 'oxespace_container_%'"]
        if (cursorClause) conds.push(cursorClause)
        sql = `SELECT * FROM oxequery_audit INDEXED BY idx_oxequery_audit_ts WHERE ${conds.join(' AND ')} ORDER BY ts DESC LIMIT ?`
        break
      }
      case 'containers': {
        const conds = ["tool LIKE 'oxespace_container_%'"]
        if (cursorClause) conds.push(cursorClause)
        sql = `SELECT * FROM oxequery_audit INDEXED BY idx_oxequery_audit_ts WHERE ${conds.join(' AND ')} ORDER BY ts DESC LIMIT ?`
        break
      }
      case 'http': {
        const where = cursorClause ? `WHERE ${cursorClause} ` : ''
        sql = `SELECT * FROM agent_http_audit INDEXED BY idx_agent_http_audit_ts ${where}ORDER BY ts DESC LIMIT ?`
        break
      }
    }

    params.push(limit)
    return { source, sql, params }
  }

  listStatements(query: AgentActivityQuery = {}): Array<{ source: AgentActivitySource; sql: string; params: unknown[] }> {
    const q = parseAgentActivityQuery(query)
    const sources = q.sources && q.sources.length > 0 ? q.sources : [...AGENT_ACTIVITY_SOURCES]
    const limit = Math.min(200, Math.max(1, Math.trunc(q.limit ?? 50)))
    return sources.map(source => this.buildStatement(source, q, limit))
  }

  private mapRow(source: AgentActivitySource, raw: Record<string, unknown>): AgentActivityRow {
    const actor = resolveAuditActor(this.db, String(raw.actor ?? ''))
    const at = Number(raw.ts)
    const rawId = Number(raw.id)

    switch (source) {
      case 'changes': {
        const path = raw.path == null ? undefined : String(raw.path)
        const line = raw.line == null ? undefined : Number(raw.line)
        const added = raw.added == null ? undefined : Number(raw.added)
        const removed = raw.removed == null ? undefined : Number(raw.removed)
        const text = raw.text == null ? null : String(raw.text)
        const action = String(raw.action ?? '')
        const tool = String(raw.tool ?? '')
        const level = String(raw.level ?? 'write')
        const summary = path || text || action
        const target = path || tool || 'working tree'

        const row: AgentActivityRow = {
          id: `changes:${rawId}`,
          at,
          source: 'changes',
          actor,
          workspaceId: String(raw.workspace_id ?? ''),
          agent: '',
          summary,
          target,
          write: level === 'write' || level === 'confirm',
          decision: String(raw.decision ?? 'auto'),
          outcome: String(raw.outcome ?? 'ok'),
          errorCode: raw.error_code == null ? null : String(raw.error_code),
          detailRef: `changes:${rawId}`
        }
        if (path !== undefined) row.path = path
        if (line !== undefined) row.line = line
        if (added !== undefined) row.added = added
        if (removed !== undefined) row.removed = removed
        return row
      }
      case 'databases': {
        const text = raw.text == null ? '' : String(raw.text)
        const tool = String(raw.tool ?? '')
        const connName = raw.connection_name ? String(raw.connection_name) : (raw.connection_id ? String(raw.connection_id) : '')
        const isRead = /^\s*(SELECT|EXPLAIN|SHOW|DESCRIBE)\b/i.test(text)

        return {
          id: `databases:${rawId}`,
          at,
          source: 'databases',
          actor,
          workspaceId: '',
          agent: '',
          summary: text || tool,
          target: connName,
          write: !isRead,
          decision: String(raw.decision ?? 'auto'),
          outcome: String(raw.outcome ?? 'ok'),
          errorCode: raw.error_code == null ? null : String(raw.error_code),
          detailRef: `databases:${rawId}`
        }
      }
      case 'containers': {
        const text = raw.text == null ? '' : String(raw.text)
        const tool = String(raw.tool ?? '')
        const isRead = tool === 'oxespace_container_logs' || tool === 'oxespace_container_stats' || text.startsWith('logs')
        const summary = text || tool
        const target = text.replace(/^(start|stop|restart|logs|exec)\s+/i, '') || tool

        return {
          id: `containers:${rawId}`,
          at,
          source: 'containers',
          actor,
          workspaceId: '',
          agent: '',
          summary,
          target,
          write: !isRead,
          decision: String(raw.decision ?? 'auto'),
          outcome: String(raw.outcome ?? 'ok'),
          errorCode: raw.error_code == null ? null : String(raw.error_code),
          detailRef: `containers:${rawId}`
        }
      }
      case 'http': {
        const method = String(raw.method ?? 'GET').toUpperCase()
        const host = String(raw.host ?? '')
        const pathTemplate = String(raw.path_template ?? '/')
        const status = raw.status == null ? null : Number(raw.status)
        const write = !['GET', 'HEAD', 'OPTIONS'].includes(method)
        const outcome = status !== null && status >= 400 ? 'error' : 'ok'

        return {
          id: `http:${rawId}`,
          at,
          source: 'http',
          actor,
          workspaceId: String(raw.workspace_id ?? ''),
          agent: String(raw.agent ?? 'claude-code'),
          summary: `${method} ${host}${pathTemplate}`,
          target: host,
          write,
          decision: 'auto',
          outcome,
          status,
          errorCode: null,
          detailRef: `http:${rawId}`
        }
      }
    }
  }

  list(rawQuery: AgentActivityQuery): AgentActivityPage {
    const q = parseAgentActivityQuery(rawQuery)
    const sourcesToQuery: AgentActivitySource[] = q.sources && q.sources.length > 0 ? q.sources : [...AGENT_ACTIVITY_SOURCES]
    const limit = Math.min(200, Math.max(1, Math.trunc(q.limit ?? 50)))
    const failedSources: AgentActivitySource[] = []
    const allFetchedRows: AgentActivityRow[] = []

    // Fetch extra rows to ensure pagination across sources works smoothly
    const fetchLimit = limit * 2 + 10

    for (const source of sourcesToQuery) {
      try {
        const stmt = this.buildStatement(source, q, fetchLimit)
        const rawRows = this.db.prepare(stmt.sql).all(...stmt.params) as Array<Record<string, unknown>>
        for (const raw of rawRows) {
          const row = this.mapRow(source, raw)
          if (q.workspaceId && row.workspaceId !== q.workspaceId) continue
          if (q.agent && row.agent.toLowerCase() !== q.agent.toLowerCase()) continue
          if (q.view === 'problems') {
            const isProblem =
              row.outcome === 'error' ||
              row.decision === 'denied' ||
              row.decision === 'refused' ||
              (row.source === 'http' && row.status !== null && row.status !== undefined && row.status >= 400)
            if (!isProblem) continue
          }
          allFetchedRows.push(row)
        }
      } catch {
        failedSources.push(source)
      }
    }

    const sourceRank = (s: AgentActivitySource) => AGENT_ACTIVITY_SOURCES.indexOf(s)
    allFetchedRows.sort((a, b) => {
      if (b.at !== a.at) return b.at - a.at
      if (a.source !== b.source) return sourceRank(a.source) - sourceRank(b.source)
      const numA = Number(a.id.split(':')[1])
      const numB = Number(b.id.split(':')[1])
      return numB - numA
    })

    let candidateRows = allFetchedRows
    if (q.cursor && q.cursor.includes(':')) {
      const parts = q.cursor.split(':')
      const cursorAt = Number(parts[0])
      const cursorSource = parts[1] as AgentActivitySource
      const cursorNumId = Number(parts[2])
      if (Number.isFinite(cursorAt)) {
        candidateRows = candidateRows.filter(r => {
          if (r.at < cursorAt) return true
          if (r.at > cursorAt) return false
          const rankR = sourceRank(r.source)
          const rankC = sourceRank(cursorSource)
          if (rankR > rankC) return true
          if (rankR < rankC) return false
          const num = Number(r.id.split(':')[1])
          return num < cursorNumId
        })
      }
    }

    const rows = candidateRows.slice(0, limit)
    let nextCursor: string | null = null
    if (candidateRows.length > limit) {
      const last = rows[rows.length - 1]
      const rawNumId = last.id.split(':')[1]
      nextCursor = `${last.at}:${last.source}:${rawNumId}`
    }

    return {
      rows,
      cursor: nextCursor,
      failedSources
    }
  }

  detail(id: string): Record<string, unknown> | null {
    if (typeof id !== 'string' || !id.includes(':')) return null
    const [source, rawIdStr] = id.split(':')
    const rawId = Number(rawIdStr)
    if (!Number.isFinite(rawId)) return null

    switch (source) {
      case 'http': {
        const raw = this.db.prepare('SELECT * FROM agent_http_audit WHERE id = ?').get(rawId) as Record<string, unknown> | undefined
        if (!raw) return null
        const workspaceId = String(raw.workspace_id ?? '')
        const host = String(raw.host ?? '')
        const isProd = this.deps.isProductionHost ?? (() => false)
        return {
          source: 'http',
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
          sourceKind: raw.source === 'rollout' ? 'rollout' : 'hook',
          production: Boolean(isProd(workspaceId, host))
        }
      }
      case 'changes': {
        const raw = this.db.prepare('SELECT * FROM agent_action_audit WHERE id = ?').get(rawId) as Record<string, unknown> | undefined
        if (!raw) return null
        return {
          source: 'changes',
          tool: String(raw.tool ?? ''),
          action: String(raw.action ?? ''),
          level: String(raw.level ?? ''),
          text: raw.text == null ? null : String(raw.text),
          decision: String(raw.decision ?? ''),
          outcome: String(raw.outcome ?? ''),
          durationMs: raw.duration_ms == null ? null : Number(raw.duration_ms),
          errorCode: raw.error_code == null ? null : String(raw.error_code),
          path: raw.path == null ? null : String(raw.path),
          line: raw.line == null ? null : Number(raw.line),
          added: raw.added == null ? null : Number(raw.added),
          removed: raw.removed == null ? null : Number(raw.removed)
        }
      }
      case 'databases':
      case 'containers': {
        const raw = this.db.prepare('SELECT * FROM oxequery_audit WHERE id = ?').get(rawId) as Record<string, unknown> | undefined
        if (!raw) return null
        return {
          source,
          tool: String(raw.tool ?? ''),
          connectionId: raw.connection_id == null ? null : String(raw.connection_id),
          connectionName: raw.connection_name == null ? null : String(raw.connection_name),
          engine: raw.engine == null ? null : String(raw.engine),
          environment: raw.environment == null ? null : String(raw.environment),
          text: raw.text == null ? null : String(raw.text),
          decision: String(raw.decision ?? ''),
          outcome: raw.outcome == null ? null : String(raw.outcome),
          rowCount: raw.row_count == null ? null : Number(raw.row_count),
          durationMs: raw.duration_ms == null ? null : Number(raw.duration_ms),
          errorCode: raw.error_code == null ? null : String(raw.error_code)
        }
      }
      default:
        return null
    }
  }

  badge(query: AgentActivityBadgeQuery): AgentActivityBadge {
    if (!query || typeof query.connectionId !== 'string') {
      return { today: 0, waiting: false }
    }
    const now = this.now()
    const d = new Date(now)
    d.setHours(0, 0, 0, 0)
    const midnight = d.getTime()

    let today: number
    try {
      const row = this.db
        .prepare('SELECT COUNT(*) as c FROM oxequery_audit WHERE connection_id = ? AND ts >= ?')
        .get(query.connectionId, midnight) as { c: number } | undefined
      today = row ? Number(row.c) : 0
    } catch {
      today = 0
    }

    const waiting = Boolean(this.deps.pendingFor?.(query.connectionId))
    return { today, waiting }
  }

  summary({ actors }: { actors: readonly string[] }): AgentActivitySummary {
    if (!Array.isArray(actors) || actors.length === 0) {
      return { changes: 0, databases: 0, containers: 0, http: 0, httpProduction: 0, failedSources: [] }
    }
    const placeholders = actors.map(() => '?').join(', ')
    const failedSources: AgentActivitySource[] = []
    let changes: number | null = null
    let databases: number | null = null
    let containers: number | null = null
    let http: number | null = null
    let httpProduction: number | null = null

    try {
      const row = this.db
        .prepare(`SELECT COUNT(*) AS c FROM agent_action_audit WHERE actor IN (${placeholders})`)
        .get(...actors) as { c: number } | undefined
      changes = row ? Number(row.c) : 0
    } catch {
      failedSources.push('changes')
    }

    try {
      const row = this.db
        .prepare(`SELECT COUNT(*) AS c FROM oxequery_audit WHERE actor IN (${placeholders}) AND tool NOT LIKE 'oxespace_container_%'`)
        .get(...actors) as { c: number } | undefined
      databases = row ? Number(row.c) : 0
    } catch {
      failedSources.push('databases')
    }

    try {
      const row = this.db
        .prepare(`SELECT COUNT(*) AS c FROM oxequery_audit WHERE actor IN (${placeholders}) AND tool LIKE 'oxespace_container_%'`)
        .get(...actors) as { c: number } | undefined
      containers = row ? Number(row.c) : 0
    } catch {
      failedSources.push('containers')
    }

    try {
      const rows = this.db
        .prepare(`SELECT workspace_id, host, COUNT(*) AS c FROM agent_http_audit WHERE actor IN (${placeholders}) GROUP BY workspace_id, host`)
        .all(...actors) as Array<{ workspace_id: unknown; host: unknown; c: number }>
      const isProd = this.deps.isProductionHost ?? (() => false)
      let total = 0
      let prod = 0
      for (const row of rows) {
        const count = Number(row.c)
        total += count
        if (isProd(String(row.workspace_id ?? ''), String(row.host ?? ''))) prod += count
      }
      http = total
      httpProduction = prod
    } catch {
      failedSources.push('http')
    }

    return { changes, databases, containers, http, httpProduction, failedSources }
  }
}
