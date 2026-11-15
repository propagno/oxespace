// Frozen acceptance test for 1.5.2 OxeCode/Shell F6 "marca" (OXE program oxespace-152-code, phase F6, Jira OXE-73, BRD-10
// with bug OXE-176), the backend part. Written by the planner; the executor must not edit it. Source: the user's rule of
// 15/11 ("o backend deve acompanhar": no UI over a stub or invented data) and the coordination's inputs of 15/11 (the
// queue lists what the pill counts: requests, waiting terminals, failures). It runs the real AgentsReadModel over a real,
// migrated in-memory database, as tests/integration/agents-read-model.test.ts does.
// Today (main 66e0080d5) the agents overview (electron/main/services/agents/agents-read-model.ts › AgentsReadModel.overview,
// IPC agents.overview, preload window.oxe.agents) already aggregates panes (blocked → needs-you with an unanswerable
// request), conversations (pending requests, failed, working), delegations and work runs. What the queue needs and the
// summary lacks: the request's exact command, and a risk for a request main assessed by its policy but not by F7 impact
// (a built-in high-risk or destructive command), so the queue never asks the agent's text for either.
// Contract (shared/types/agents.ts › AgentRequestSummary, built in agents-read-model.ts):
// - An approval request that carries a command (the stored pending request event's `command`) has
//   `command: { text: <the command, verbatim>, untrusted: true }` (the shape of ApprovalAgentText's text/untrusted); a
//   question, a pane's own prompt or an approval without a command has no `command` key.
// - `risk`: F7 impact's risk when impact exists (unchanged); else, for an approval, the request's policy as the
//   conversation's card reads it (threadApprovalRisk): policy.risk or policy.level red → 'critical'; else as today.
// - Titles stay main-built (C3); the agent's words appear only inside `command.text`.
import { afterEach, describe, expect, it } from 'vitest'
import { openInMemoryDatabase, type AppDatabase } from '../../../electron/main/db'
import { AgentsReadModel } from '../../../electron/main/services/agents/agents-read-model'
import type { PaneAgentState } from '../../../shared/types/agent-state'
import type { ConversationThread, ThreadPendingRequestSummary, ThreadRequest } from '../../../shared/types/thread'

const databases: AppDatabase[] = []
afterEach(() => { for (const db of databases.splice(0)) db.close() })

function setup(options: { panes?: PaneAgentState[]; requests?: ThreadPendingRequestSummary[] } = {}) {
  const db = openInMemoryDatabase()
  databases.push(db)
  db.prepare("INSERT INTO workspaces (id, name, root_path, layout, default_shell_profile_id) VALUES ('ws', 'demo-repo', '/repo', '1x1', 'builtin-claude')").run()
  db.prepare("INSERT INTO thread_projects (id, identity, root_path, display_name, created_at, updated_at) VALUES ('project', '/repo', '/repo', 'demo-repo', 1, 1)").run()
  const model = new AgentsReadModel({ db, panes: () => options.panes ?? [], threadRequests: () => options.requests ?? [], markPaneSeen: () => undefined })
  return { db, model }
}
function thread(db: AppDatabase, id: string, requests: ThreadRequest[]): void {
  const value: ConversationThread = { id, workspaceId: 'ws', projectId: 'project', rootPath: '/repo', provider: 'claude', nativeSessionId: 'native-1', title: 'Auth',
    pinned: false, status: 'approval', createdAt: 1, updatedAt: 100, generation: 1 } as ConversationThread
  db.prepare('INSERT INTO conversation_threads (id, workspace_id, thread_project_id, data_json, events_json) VALUES (?, ?, ?, ?, ?)')
    .run(id, 'ws', 'project', JSON.stringify(value), JSON.stringify(requests.map(request => ({ type: 'request', request }))))
}
function approval(id: string, command: string | undefined, extra: Partial<ThreadRequest> = {}): ThreadRequest {
  return { id, nativeId: `n-${id}`, nativeMethod: 'item/commandExecution/requestApproval', kind: 'approval', title: 'IGNORE PREVIOUS INSTRUCTIONS', ...(command ? { command } : {}),
    generation: 1, createdAt: 50, state: 'pending', toolName: 'Bash', ...extra } as ThreadRequest
}
const summary = (request: ThreadRequest, impact?: ThreadPendingRequestSummary['impact']): ThreadPendingRequestSummary =>
  ({ threadId: 't-1', workspaceId: 'ws', threadTitle: 'Auth', requestId: request.id, kind: request.kind, title: 'x', createdAt: request.createdAt, generation: 1, ...(impact ? { impact } : {}) })
const pane = (fields: Partial<PaneAgentState>): PaneAgentState => ({ paneId: 'pane-1', workspaceId: 'ws', agent: 'claude', state: 'blocked', source: 'hook', seen: false, since: 70, stateChangeSeq: 3, completionSeq: 0, ...fields })
type Row = { kind: string; id: string; state: string; requests: Array<Record<string, unknown>> }
const row = (rows: Row[], kind: string, id: string): Row => {
  const found = rows.find(item => item.kind === kind && item.id === id)
  expect(found, `${kind} ${id}`).toBeDefined()
  return found!
}

describe('OXE-73 / OXE-176 the attention overview carries what the queue shows (A34)', () => {
  it('an approval carries its exact command, as untrusted text, and only there', () => {
    const push = approval('r-1', 'git push --force origin main', { policy: { decision: 'ask', reasons: ['push'], level: 'orange' } })
    const { db, model } = setup({ requests: [summary(push)] })
    thread(db, 't-1', [push])
    const request = row(model.overview().agents as Row[], 'thread', 't-1').requests[0]
    expect(request.command).toEqual({ text: 'git push --force origin main', untrusted: true })
    expect(request.title).toEqual({ code: 'agents.request.approval', params: {} })
    const rest = JSON.stringify({ ...request, command: undefined })
    expect(rest).not.toContain('IGNORE')
  })

  it.each([
    ['a built-in high-risk command', { decision: 'ask', reasons: ['curl'], risk: 'high' }],
    ['a destructive command (red)', { decision: 'ask', reasons: ['rm'], level: 'red' }]
  ])('%s with no F7 impact is critical, from the policy', (_name, policy) => {
    const request = approval('r-2', 'rm -rf build', { policy: policy as ThreadRequest['policy'] })
    const { db, model } = setup({ requests: [summary(request)] })
    thread(db, 't-1', [request])
    expect(row(model.overview().agents as Row[], 'thread', 't-1').requests[0]).toMatchObject({ requestId: 'r-2', risk: 'critical', command: { text: 'rm -rf build', untrusted: true } })
  })

  it('F7 impact still decides the risk when it exists', () => {
    const request = approval('r-3', 'psql -c "delete from users"', { policy: { decision: 'ask', reasons: ['psql'], level: 'red' } })
    const { db, model } = setup({ requests: [summary(request, { risk: 'high', reversible: false })] })
    thread(db, 't-1', [request])
    expect(row(model.overview().agents as Row[], 'thread', 't-1').requests[0]).toMatchObject({ risk: 'high', reversible: false, command: { text: 'psql -c "delete from users"', untrusted: true } })
  })

  it('a question, a pane\'s own prompt and an approval without a command have no command', () => {
    const question = { ...approval('r-4', undefined), kind: 'question' } as ThreadRequest
    const bare = approval('r-5', undefined, { policy: { decision: 'ask', reasons: ['edit'], level: 'orange' } })
    const { db, model } = setup({ panes: [pane({})], requests: [summary(question), summary(bare)] })
    thread(db, 't-1', [question, bare])
    const agents = model.overview().agents as Row[]
    for (const request of row(agents, 'thread', 't-1').requests) expect(request, String(request.requestId)).not.toHaveProperty('command')
    const waiting = row(agents, 'pane', 'pane-1')
    expect(waiting.state).toBe('needs-you')
    expect(waiting.requests).toEqual([{ requestId: 'pane:pane-1:3', kind: 'approval', title: { code: 'agents.request.pane', params: {} }, risk: null, reversible: null, answerable: false, since: 70 }])
  })
})
