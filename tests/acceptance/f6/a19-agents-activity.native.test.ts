// Frozen acceptance test for 1.5.0 A19 / T90 (OXE program, phase F6): the S7.1 agents read model carries `activity` on
// conversation rows only, built in main by threadActivity from the stored conversation. Written by the planner; the
// executor must not edit it. A real, migrated in-memory database, as in tests/integration/agents-read-model.test.ts.
// CCR: docs/roadmap-1.5/ccr-f6-conversation.md §A19.
// Runs under Electron's Node ABI: npm run test:electron -- tests/acceptance/f6/a19-agents-activity.native.test.ts
import { afterEach, describe, expect, test } from 'vitest'
import { openInMemoryDatabase, type AppDatabase } from '../../../electron/main/db'
import { AgentsReadModel } from '../../../electron/main/services/agents/agents-read-model'
import type { PaneAgentState } from '../../../shared/types/agent-state'
import type { ConversationThread, ThreadEvent } from '../../../shared/types/thread'

const databases: AppDatabase[] = []
afterEach(() => { for (const db of databases.splice(0)) db.close() })

function setup(panes: PaneAgentState[] = []) {
  const db = openInMemoryDatabase(); databases.push(db)
  db.prepare("INSERT INTO workspaces (id, name, root_path, layout, default_shell_profile_id) VALUES ('ws', 'Test', '/repo', '1x1', 'builtin-codex')").run()
  db.prepare("INSERT INTO thread_projects (id, identity, root_path, display_name, created_at, updated_at) VALUES ('project', '/repo', '/repo', 'Test', 1, 1)").run()
  return { db, model: new AgentsReadModel({ db, panes: () => panes, threadRequests: () => [], markPaneSeen: () => undefined, now: () => 10_000 }) }
}
function thread(db: AppDatabase, id: string, fields: Partial<ConversationThread>, events: ThreadEvent[]): void {
  const value: ConversationThread = {
    id, workspaceId: 'ws', projectId: 'project', rootPath: '/repo', provider: 'claude', nativeSessionId: 'native-1', title: 'A conversation',
    pinned: false, status: 'idle', createdAt: 1, updatedAt: 100, generation: 1, ...fields
  }
  db.prepare('INSERT INTO conversation_threads (id, workspace_id, thread_project_id, data_json, events_json) VALUES (?, ?, ?, ?, ?)').run(id, 'ws', 'project', JSON.stringify(value), JSON.stringify(events))
}

describe('A19 · T90 activity on the agents read model', () => {
  test('A19: a working conversation\'s row carries activity: working, with the running tool\'s verb and target', () => {
    const { db, model } = setup()
    thread(db, 't1', { status: 'running', turns: [{ id: 'turn-1', sequence: 0, status: 'running', startedAt: 9_000 }] } as Partial<ConversationThread>,
      [{ type: 'tool', id: 'e1', name: 'Edit', state: 'running', detail: '/repo/src/login.ts', files: [{ path: '/repo/src/login.ts', kind: 'update', source: 'tool-input', state: 'running' }] }])
    const row = model.overview().agents.find(entry => entry.kind === 'thread' && entry.id === 't1')
    expect(row?.activity).toMatchObject({ kind: 'working', verb: 'edit', text: 'src/login.ts' })
  })

  test('A19: a finished conversation\'s row carries done or ready; a pane row carries no activity', () => {
    const { db, model } = setup([{ paneId: 'pane-1', workspaceId: 'ws', agent: 'claude', state: 'working', source: 'hook', seen: false, since: 100, stateChangeSeq: 3, completionSeq: 0 } as PaneAgentState])
    thread(db, 't2', { status: 'idle', lastTurnStatus: 'completed' }, [{ type: 'message', id: 'a', role: 'assistant', text: 'Fixed it. More text.' }, { type: 'completed', status: 'completed' }])
    const overview = model.overview()
    expect(overview.agents.find(entry => entry.kind === 'thread' && entry.id === 't2')?.activity).toMatchObject({ kind: 'done', text: 'Fixed it.' })
    const pane = overview.agents.find(entry => entry.kind === 'pane')
    expect(pane).toBeDefined()
    expect(pane).not.toHaveProperty('activity')
  })
})
