import { afterEach, describe, expect, it } from 'vitest'
import { openInMemoryDatabase, type AppDatabase } from '../../electron/main/db'
import { auditJsonl } from '../../electron/main/services/audit-export'

const databases: AppDatabase[] = []
afterEach(() => { for (const db of databases.splice(0)) db.close() })

describe('audit export', () => {
  it('writes every trail as JSON lines, oldest first, with the source and without secrets', () => {
    const db = openInMemoryDatabase(); databases.push(db)
    db.prepare("INSERT INTO thread_audit (thread_id, project_root, at, action, actor, summary, detail) VALUES ('t1', '/repo', 30, 'approve', 'user', 'Allowed Bash', 'curl -H \"Authorization: Bearer abcdefghijkl\"')").run()
    db.prepare("INSERT INTO agent_action_audit (ts, actor, tool, action, level, text, decision, outcome) VALUES (10, 'thread:t1', 'oxespace_git_change', 'push', 'confirm', 'git push https://me:ghp_abcdefghijklmnopqrstuvwx@github.com/o/r', 'approved', 'ok')").run()
    db.prepare("INSERT INTO oxequery_audit (ts, actor, connection_name, engine, environment, tool, text, decision, outcome, row_count) VALUES (20, 'thread:t1', 'shop', 'postgres', 'dev', 'oxespace_db_query', 'SELECT 1', 'auto', 'ok', 1)").run()
    const lines = auditJsonl(db).trim().split('\n').map(line => JSON.parse(line) as Record<string, unknown>)
    expect(lines.map(line => [line.source, line.at])).toEqual([['agent-action', 10], ['oxequery', 20], ['thread', 30]])
    expect(lines[0]).toMatchObject({ actor: 'thread:t1', tool: 'oxespace_git_change', decision: 'approved', text: 'git push https://me:[redacted]@github.com/o/r' })
    expect(lines[1]).toMatchObject({ connectionName: 'shop', rowCount: 1, text: 'SELECT 1' })
    expect(lines[2]).toMatchObject({ threadId: 't1', summary: 'Allowed Bash', detail: 'curl -H "Authorization: [redacted]"' })
    expect(lines[0]).not.toHaveProperty('workspaceId')
  })

  it('is empty when nothing was audited', () => {
    const db = openInMemoryDatabase(); databases.push(db)
    expect(auditJsonl(db)).toBe('')
  })
})
