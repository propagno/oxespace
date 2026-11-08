// Frozen acceptance test for 1.5.0 A62 / N5 (OXE program, phase F4): the Pull request tab's "What the agent did" counts
// come from main: files from the task's places, and databases, HTTP calls (with how many went to production) and
// containers from the A10 sources, for this conversation and its agent panes only, plus the approvals the person gave.
// The window words them and leaves out zeros; "Add to description" is the window's (FE-A62).
// Written by the planner; the executor must not edit it.
// Spec: docs/roadmap-1.5/ccr-f4-places-pr.md §A62 (F3's AgentActivity read model, ccr-h1-http-audit.md §A10).
// Runs under Electron's Node ABI: npm run test:electron -- tests/acceptance/f4/a62-agent-summary.native.test.ts
import { afterEach, describe, expect, test } from 'vitest'
import { openInMemoryDatabase, type AppDatabase } from '../../../electron/main/db/index'
import { AgentActivity } from '../../../electron/main/services/agent-activity/read-model'
import { threadAgentSummary } from '../../../electron/main/services/agent-activity/thread-summary'
import type { ThreadEvent } from '../../../shared/types/thread'

const open: AppDatabase[] = []
afterEach(() => { for (const db of open.splice(0)) db.close() })
function database(): AppDatabase { const db = openInMemoryDatabase(); open.push(db); return db }

function change(db: AppDatabase, actor: string): void {
  db.prepare("INSERT INTO agent_action_audit (ts, actor, workspace_id, tool, action, level, text, decision, outcome) VALUES (10, ?, 'ws-1', 'oxespace_git_change', 'commit', 'write', 'commit', 'approved', 'ok')").run(actor)
}
function query(db: AppDatabase, actor: string, tool = 'oxespace_db_query'): void {
  db.prepare("INSERT INTO oxequery_audit (ts, actor, connection_id, connection_name, engine, environment, tool, text, decision, outcome) VALUES (10, ?, 'c-shop', 'shop', 'postgres', 'dev', ?, 'SELECT 1', 'auto', 'ok')").run(actor, tool)
}
let http = 0
function call(db: AppDatabase, actor: string, host: string): void {
  http++
  db.prepare("INSERT INTO agent_http_audit (ts, actor, workspace_id, agent, source, tool_use_id, call_index, tool, method, scheme, host, port, path_template, query_keys_json, header_names_json, has_body, insecure, plain_http_external, status, command_redacted, output_truncated) VALUES (10, ?, 'ws-1', 'claude-code', 'hook', ?, 0, 'curl', 'GET', 'https', ?, 443, '/v1', '[]', '[]', 0, 0, 0, 200, 'curl', 0)")
    .run(actor, `toolu_${http}`, host)
}
const resolved = (id: string, resolution: 'approved' | 'declined' | 'answered'): ThreadEvent => ({ type: 'request-resolved', id, state: 'resolved', resolution, resolvedAt: 1 })
const model = (db: AppDatabase) => new AgentActivity(db, { isProductionHost: (_workspace, host) => host === 'api.prod.example', pendingFor: () => false, now: () => 10_000 })

describe('A62 · what the agent did', () => {
  test('A62: AgentActivity.summary counts each source for the given actors only', () => {
    const db = database()
    change(db, 'thread:t1'); change(db, 'thread:other')
    query(db, 'thread:t1'); query(db, 'pane:p-agent'); query(db, 'pane:p-agent', 'oxespace_container_action'); query(db, 'pane:p-mine')
    call(db, 'pane:p-agent', 'api.prod.example'); call(db, 'thread:t1', 'api.dev.example'); call(db, 'pane:p-mine', 'api.prod.example')
    expect(model(db).summary({ actors: ['thread:t1', 'pane:p-agent'] })).toEqual({ changes: 1, databases: 2, containers: 1, http: 2, httpProduction: 1, failedSources: [] })
    expect(model(db).summary({ actors: [] })).toEqual({ changes: 0, databases: 0, containers: 0, http: 0, httpProduction: 0, failedSources: [] })
  })

  test('A62: the thread summary adds the files from its places and the approvals the person gave', () => {
    const db = database()
    query(db, 'thread:t1'); call(db, 'thread:t1', 'api.prod.example'); query(db, 'pane:p-agent', 'oxespace_container_action')
    const events = [resolved('r1', 'approved'), resolved('r2', 'declined'), resolved('r3', 'approved'), resolved('r4', 'answered')]
    expect(threadAgentSummary({ activity: model(db), threadId: 't1', agentPaneIds: ['p-agent'], files: 7, events })).toEqual({
      files: 7, databases: 1, http: 1, httpProduction: 1, containers: 1, approvals: 2, failedSources: []
    })
  })

  test('A62: another conversation\'s rows and the person\'s own panes never count', () => {
    const db = database()
    query(db, 'thread:t2'); call(db, 'pane:p-mine', 'api.dev.example'); query(db, 'thread:t1')
    expect(threadAgentSummary({ activity: model(db), threadId: 't1', agentPaneIds: [], files: 0, events: [] })).toEqual({
      files: 0, databases: 1, http: 0, httpProduction: 0, containers: 0, approvals: 0, failedSources: []
    })
  })

  test('A62: a source that fails is reported, not counted as zero', () => {
    const db = database()
    db.exec('DROP TABLE agent_http_audit')
    const summary = model(db).summary({ actors: ['thread:t1'] })
    expect(summary.http).toBeNull()
    expect(summary.httpProduction).toBeNull()
    expect(summary.failedSources).toEqual(['http'])
  })
})
