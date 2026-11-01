import type { AppDatabase } from '../db'
import { redactSecrets } from '../../../shared/secrets'

type Row = Record<string, unknown>

/** The audit trails a person can export: Thread permission decisions, agent actions, OxeQuery requests and the remote gateway. */
const SOURCES: Array<{ source: string; sql: string; time: string; texts: string[] }> = [
  { source: 'thread', time: 'at', texts: ['summary', 'detail'],
    sql: 'SELECT at, thread_id, project_root, action, actor, summary, detail FROM thread_audit' },
  { source: 'agent-action', time: 'ts', texts: ['text'],
    sql: 'SELECT ts, actor, workspace_id, tool, action, level, text_hash, text, decision, outcome, duration_ms, error_code FROM agent_action_audit' },
  { source: 'oxequery', time: 'ts', texts: ['text'],
    sql: 'SELECT ts, actor, connection_id, connection_name, engine, environment, tool, text_hash, text, decision, outcome, row_count, duration_ms, error_code FROM oxequery_audit' },
  { source: 'remote', time: 'ts', texts: ['detail'],
    sql: 'SELECT ts, action, outcome, device_id, remote_address, detail FROM remote_audit' }
]

const camel = (name: string): string => name.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase())

/**
 * Every audit entry still kept, oldest first, one JSON object per line. Each line says where it came from
 * (`source`) and when (`at`, epoch milliseconds); texts go through the same redaction as logs and diagnostics.
 */
export function auditJsonl(db: AppDatabase): string {
  const entries: Row[] = []
  for (const { source, sql, time, texts } of SOURCES) {
    let rows: Row[]
    try { rows = db.prepare(sql).all() as Row[] } catch { continue } // A table this database does not have yet.
    for (const row of rows) {
      const entry: Row = { source, at: row[time] }
      for (const [key, value] of Object.entries(row)) {
        if (key === time || value === null) continue
        entry[camel(key)] = texts.includes(key) && typeof value === 'string' ? redactSecrets(value) : value
      }
      entries.push(entry)
    }
  }
  entries.sort((a, b) => Number(a.at) - Number(b.at))
  return entries.map(entry => JSON.stringify(entry)).join('\n') + (entries.length ? '\n' : '')
}
