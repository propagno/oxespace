/**
 * Persisted permission rules for Thread approvals, and the audit trail of
 * who decided what. Rules are per project (`projectRoot`) or global (null).
 */
import { randomUUID } from 'node:crypto'
import { realpathSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import type { AppDatabase } from '../../db'
import type { ThreadAuditEntry, ThreadPermissionRule, ThreadRequest, ThreadRequestPolicy } from '../../../../shared/types/thread'
import { evaluatePermission } from './kernel/permission-policy'
import { warmShellParser } from './shell-parse'

/**
 * Follows links and junctions. A file that does not exist yet is resolved
 * through its nearest existing folder, so a new file under a junction that
 * points outside the project is still seen as outside.
 */
function realpath(path: string): string {
  const rest: string[] = []
  let current = path
  for (let depth = 0; depth < 64; depth += 1) {
    try { return join(realpathSync.native(current), ...rest) } catch {
      const parent = dirname(current)
      if (parent === current) return path
      rest.unshift(basename(current))
      current = parent
    }
  }
  return path
}

const MAX_PATTERN = 500
const TOOL_PATTERN = /^[A-Za-z0-9_.-]{1,100}\/(\*|[A-Za-z0-9_.-]{1,200})$/
const MAX_RULES = 500
const AUDIT_RETENTION_MS = 180 * 24 * 60 * 60 * 1000
const MAX_AUDIT_TEXT = 2000

interface RuleRow { id: string; project_root: string | null; kind: ThreadPermissionRule['kind']; pattern: string; decision: 'allow' | 'deny'; created_at: number }
interface AuditRow { id: number; thread_id: string | null; project_root: string | null; at: number; action: ThreadAuditEntry['action']; actor: ThreadAuditEntry['actor']; summary: string; detail: string | null }

const toRule = (row: RuleRow): ThreadPermissionRule => ({ id: row.id, projectRoot: row.project_root, kind: row.kind, pattern: row.pattern, decision: row.decision, createdAt: row.created_at })
const toAudit = (row: AuditRow): ThreadAuditEntry => ({
  id: row.id, at: row.at, action: row.action, actor: row.actor, summary: row.summary,
  ...(row.thread_id ? { threadId: row.thread_id } : {}), ...(row.project_root ? { projectRoot: row.project_root } : {}), ...(row.detail ? { detail: row.detail } : {})
})

/** The shape the renderer may send when adding a rule; anything else is refused before it reaches the store. */
export function parsePermissionRuleInput(rule: unknown): { kind: ThreadPermissionRule['kind']; pattern: string; decision: ThreadPermissionRule['decision']; scope: 'project' | 'global' } {
  if (!rule || typeof rule !== 'object' || Array.isArray(rule)) throw Error('Invalid permission rule')
  const value = rule as Record<string, unknown>
  if (value.kind !== 'command' && value.kind !== 'path' && value.kind !== 'tool') throw Error('Invalid permission rule kind')
  if (value.decision !== 'allow' && value.decision !== 'deny') throw Error('Invalid permission rule decision')
  if (value.scope !== 'project' && value.scope !== 'global') throw Error('Invalid permission rule scope')
  if (typeof value.pattern !== 'string') throw Error('Invalid permission rule pattern')
  return { kind: value.kind, pattern: value.pattern, decision: value.decision, scope: value.scope }
}

/** Rejects rules that would silently allow everything. */
export function validatePermissionRule(kind: string, pattern: string, decision: string): string {
  if (kind !== 'command' && kind !== 'path' && kind !== 'tool') throw Error('Unknown rule kind')
  if (decision !== 'allow' && decision !== 'deny') throw Error('Unknown rule decision')
  const value = pattern.trim()
  if (!value || value.length > MAX_PATTERN || value.includes('\0')) throw Error(`A rule must contain 1 to ${MAX_PATTERN} characters`)
  const regex = value.match(/^\/(.+)\/([a-z]*)$/)
  if (regex) {
    try { new RegExp(regex[1], regex[2]) } catch { throw Error('The rule is not a valid regular expression') }
  }
  if (kind === 'tool' && !TOOL_PATTERN.test(value)) throw Error('Name an MCP tool as server/tool, or every tool of a server as server/*')
  if (decision === 'allow') {
    if (kind === 'command' && regex && /^(\.\*|\.\+|\^?\.\*\$?)$/.test(regex[1])) throw Error('A rule that allows every command is not accepted')
    if (kind === 'path' && /^(\*\*?(\/\*\*?)*|\.)$/.test(value)) throw Error('A rule that allows edits to every file is not accepted; name a folder such as src/**')
  }
  return value
}

export class ThreadPermissionStore {
  constructor(private readonly db: AppDatabase) {
    // Approvals decided before the grammar has loaded fall back to the text splitter.
    void warmShellParser()
  }

  /** Rules that apply to a project: its own plus the global ones. */
  rules(projectRoot: string): ThreadPermissionRule[] {
    return (this.db.prepare('SELECT * FROM permission_rules WHERE project_root IS NULL OR project_root = ? ORDER BY created_at').all(projectRoot) as RuleRow[]).map(toRule)
  }

  /** The policy verdict for an approval in a project; undefined when no rule can reason about it. */
  evaluate(projectRoot: string, request: Pick<ThreadRequest, 'kind' | 'command' | 'paths' | 'toolName'>): ThreadRequestPolicy | undefined {
    if (request.kind !== 'approval') return undefined
    return evaluatePermission(request, projectRoot, this.rules(projectRoot), { realpath }, { readOnlyList: this.autoApproveReads() })
  }

  /**
   * Whether the built-in read-only list approves commands without asking. On unless a person turned it off;
   * if the setting cannot be read the list is off, so a database problem only ever means more questions.
   */
  autoApproveReads(): boolean {
    try {
      const row = this.db.prepare("SELECT value FROM thread_settings WHERE key = 'auto_approve_reads'").get() as { value: string } | undefined
      return row ? row.value !== '0' : true
    } catch { return false }
  }

  setAutoApproveReads(enabled: boolean): boolean {
    this.db.prepare("INSERT INTO thread_settings (key, value, updated_at) VALUES ('auto_approve_reads', ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at")
      .run(enabled ? '1' : '0', Date.now())
    return enabled
  }

  add(input:{ projectRoot: string | null; kind: ThreadPermissionRule['kind']; pattern: string; decision: ThreadPermissionRule['decision'] }): ThreadPermissionRule {
    const pattern = validatePermissionRule(input.kind, input.pattern, input.decision)
    const existing = this.db.prepare("SELECT * FROM permission_rules WHERE COALESCE(project_root, '') = COALESCE(?, '') AND kind = ? AND pattern = ? AND decision = ?")
      .get(input.projectRoot, input.kind, pattern, input.decision) as RuleRow | undefined
    if (existing) return toRule(existing)
    const count = (this.db.prepare('SELECT COUNT(*) AS count FROM permission_rules').get() as { count: number }).count
    if (count >= MAX_RULES) throw Error(`At most ${MAX_RULES} permission rules can be saved`)
    const rule: ThreadPermissionRule = { id: randomUUID(), projectRoot: input.projectRoot, kind: input.kind, pattern, decision: input.decision, createdAt: Date.now() }
    this.db.prepare('INSERT INTO permission_rules (id, project_root, kind, pattern, decision, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(rule.id, rule.projectRoot, rule.kind, rule.pattern, rule.decision, rule.createdAt)
    return rule
  }

  remove(ruleId: string): ThreadPermissionRule | undefined {
    const row = this.db.prepare('SELECT * FROM permission_rules WHERE id = ?').get(ruleId) as RuleRow | undefined
    if (row) this.db.prepare('DELETE FROM permission_rules WHERE id = ?').run(ruleId)
    return row ? toRule(row) : undefined
  }

  audit(entry: Omit<ThreadAuditEntry, 'id' | 'at'> & { at?: number }): void {
    const at = entry.at ?? Date.now()
    this.db.prepare('INSERT INTO thread_audit (thread_id, project_root, at, action, actor, summary, detail) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(entry.threadId ?? null, entry.projectRoot ?? null, at, entry.action, entry.actor, entry.summary.slice(0, MAX_AUDIT_TEXT), entry.detail?.slice(0, MAX_AUDIT_TEXT) ?? null)
  }

  auditLog(filter: { threadId?: string; projectRoot?: string; before?: number; limit?: number } = {}): ThreadAuditEntry[] {
    const where: string[] = [], values: unknown[] = []
    if (filter.threadId) { where.push('thread_id = ?'); values.push(filter.threadId) }
    if (filter.projectRoot) { where.push('project_root = ?'); values.push(filter.projectRoot) }
    if (filter.before) { where.push('at < ?'); values.push(filter.before) }
    const limit = Math.min(Math.max(filter.limit ?? 200, 1), 1000)
    return (this.db.prepare(`SELECT * FROM thread_audit ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY at DESC, id DESC LIMIT ?`).all(...values, limit) as AuditRow[]).map(toAudit)
  }

  prune(now = Date.now()): number {
    return this.db.prepare('DELETE FROM thread_audit WHERE at < ?').run(now - AUDIT_RETENTION_MS).changes
  }
}
