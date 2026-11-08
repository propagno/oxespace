// Frozen acceptance test for 1.5.0 A29 (OXE program, phase F8), FRONTEND's M5 on #717: Agora's needs-you card picks its
// buttons (Deny, then Allow when reversible, See impact when irreversible, or Answer for a question) from main-built
// facts, never by guessing from the risk word. Each request in the S7.1 agents overview carries its kind and F7's
// reversible and risk, or null when nothing assessed it. Written by the planner; the executor must not edit it.
// A real, migrated in-memory database and the real AgentsReadModel.
// CCR: docs/roadmap-1.5/ccr-f8-agora-history.md §A29.
// Runs under Electron's Node ABI: npm run test:electron -- tests/acceptance/f8/a29-agora-requests.native.test.ts
import { afterEach, describe, expect, test } from 'vitest'
import { openInMemoryDatabase, type AppDatabase } from '../../../electron/main/db'
import { AgentsReadModel } from '../../../electron/main/services/agents/agents-read-model'
import type { PaneAgentState } from '../../../shared/types/agent-state'
import type { ConversationThread, ThreadPendingRequestSummary } from '../../../shared/types/thread'

const databases: AppDatabase[] = []
afterEach(() => { for (const db of databases.splice(0)) db.close() })

function setup(requests: ThreadPendingRequestSummary[], panes: PaneAgentState[] = []) {
  const db = openInMemoryDatabase()
  databases.push(db)
  db.prepare("INSERT INTO workspaces (id, name, root_path, layout, default_shell_profile_id) VALUES ('ws', 'Test', '/repo', '1x1', 'builtin-claude')").run()
  db.prepare("INSERT INTO thread_projects (id, identity, root_path, display_name, created_at, updated_at) VALUES ('project', '/repo', '/repo', 'Test', 1, 1)").run()
  const thread: ConversationThread = {
    id: 't-1', workspaceId: 'ws', projectId: 'project', rootPath: '/repo', provider: 'claude', nativeSessionId: 'native-1', title: 'A conversation',
    pinned: false, status: 'approval', createdAt: 1, updatedAt: 100, generation: 1
  }
  db.prepare('INSERT INTO conversation_threads (id, workspace_id, thread_project_id, data_json, events_json) VALUES (?, ?, ?, ?, ?)').run('t-1', 'ws', 'project', JSON.stringify(thread), '[]')
  const model = new AgentsReadModel({ db, panes: () => panes, threadRequests: () => requests })
  const rows = model.overview().agents as Array<{ kind: string; id: string; requests: Array<Record<string, unknown>> }>
  return (kind: string, id: string) => rows.find(row => row.kind === kind && row.id === id)!.requests
}

const request = (requestId: string, kind: ThreadPendingRequestSummary['kind'], impact?: { risk: 'low' | 'medium' | 'high' | 'critical'; reversible: boolean }): ThreadPendingRequestSummary =>
  ({ threadId: 't-1', workspaceId: 'ws', threadTitle: 'A conversation', requestId, kind, title: 'x', createdAt: 50, generation: 1, ...(impact ? { impact } : {}) }) as ThreadPendingRequestSummary

describe('A29 · the needs-you card\'s facts', () => {
  test('A29: each conversation request carries its kind, and F7\'s risk and reversible', () => {
    const requests = setup([
      request('r-edit', 'approval', { risk: 'high', reversible: true }),
      request('r-push', 'approval', { risk: 'critical', reversible: false }),
      request('r-db', 'approval', { risk: 'high', reversible: false }),
      request('r-ask', 'question')
    ])('thread', 't-1')
    expect(requests.map(({ requestId, kind, risk, reversible }) => ({ requestId, kind, risk, reversible }))).toEqual([
      { requestId: 'r-edit', kind: 'approval', risk: 'high', reversible: true },
      { requestId: 'r-push', kind: 'approval', risk: 'critical', reversible: false },
      { requestId: 'r-db', kind: 'approval', risk: 'high', reversible: false },
      { requestId: 'r-ask', kind: 'question', risk: null, reversible: null }
    ])
  })

  test('A29: nothing assessed means null, never a guess: an approval without impact, an elicitation, a pane\'s own prompt', () => {
    const find = setup([request('r-plain', 'approval'), request('r-form', 'elicitation')], [
      { paneId: 'p-1', workspaceId: 'ws', agent: 'claude', state: 'blocked', since: 60, seen: false, stateChangeSeq: 3 } as unknown as PaneAgentState
    ])
    expect(find('thread', 't-1').map(({ kind, risk, reversible }) => ({ kind, risk, reversible }))).toEqual([
      { kind: 'approval', risk: null, reversible: null },
      { kind: 'question', risk: null, reversible: null }
    ])
    expect(find('pane', 'p-1')).toEqual([expect.objectContaining({ kind: 'approval', risk: null, reversible: null, answerable: false })])
  })
})
