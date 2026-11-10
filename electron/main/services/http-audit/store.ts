import type { AppDatabase } from '../../db/index'
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
