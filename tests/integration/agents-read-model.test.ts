// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'
import { openInMemoryDatabase } from '../../electron/main/db/index'
import { AgentSeenStore } from '../../electron/main/services/agents/agent-seen-store'
import { dbAgentSources } from '../../electron/main/services/agents/db-sources'
import { AgentsReadModel } from '../../electron/main/services/agents/read-model'
import { notifyAgentSource, onAgentSource, onAgentStop } from '../../electron/main/services/agents/source-events'
import type { PaneAgentState } from '../../shared/types/agent-state'
import type { AgentsChange } from '../../shared/types/ipc/agents'

const T0 = 1_800_000_000_000

/** A real database with the app's migrations; foreign keys off so a test can seed only the tables it reads. */
function database() {
  const db = openInMemoryDatabase()
  db.pragma('foreign_keys = OFF')
  return db
}

const stops: (() => void)[] = []
afterEach(() => { for (const stop of stops.splice(0)) stop(); vi.useRealTimers() })

describe('agent_seen (migration 088)', () => {
  it('keeps the newest mark per key, deletes with the source, and keeps at most the cap', () => {
    const db = database()
    const store = new AgentSeenStore(db, 3)
    expect(store.mark('conversation:t1', T0)).toEqual({ seenAt: T0, evicted: [] })
    expect(store.mark('conversation:t1', T0 - 5).seenAt).toBe(T0)
    expect(store.mark('conversation:t1', T0 + 5).seenAt).toBe(T0 + 5)
    store.mark('pane:a', T0 + 1); store.mark('pane:b', T0 + 2)
    // The cap reports what it evicted, so the read model forgets it in memory too.
    expect(store.mark('pane:c', T0 + 3)).toEqual({ seenAt: T0 + 3, evicted: ['pane:a'] })
    expect([...store.all().keys()].sort()).toEqual(['conversation:t1', 'pane:b', 'pane:c'])
    store.delete('pane:b')
    expect(store.get('pane:b')).toBeNull()
    expect(() => db.prepare('INSERT INTO agent_seen (agent_key, seen_at) VALUES (?, ?)').run('x'.repeat(201), 1)).toThrow()
    expect(() => db.prepare('INSERT INTO agent_seen (agent_key, seen_at) VALUES (?, ?)').run('pane:z', -1)).toThrow()
  })
})

describe('the read model on a real database', () => {
  it('reads conversations, pending requests, delegations and runs from their tables, and keeps a mark across a restart', () => {
    vi.useFakeTimers()
    vi.setSystemTime(T0 + 60_000)
    const db = database()
    const thread = (id: string, data: Record<string, unknown>) => db.prepare('INSERT INTO conversation_threads (id, workspace_id, thread_project_id, data_json) VALUES (?, ?, ?, ?)')
      .run(id, 'w1', 'p', JSON.stringify({ id, workspaceId: 'w1', projectId: 'p', rootPath: 'C:/repo', provider: 'codex', nativeSessionId: null, title: `Talk ${id}`, pinned: false, createdAt: T0, updatedAt: T0, ...data }))
    thread('t1', { status: 'approval' })
    thread('t2', { status: 'idle', lastTurnStatus: 'completed' })
    thread('t3', { status: 'idle', archived: true })
    // Looked at after its turn completed, then a metadata write (cost) moved updatedAt past the mark.
    thread('t4', { status: 'idle', lastTurnStatus: 'completed', updatedAt: T0 + 100 })
    db.prepare('INSERT INTO conversation_turns (thread_id, id, data_json) VALUES (?, ?, ?)').run('t4', 'turn-1', JSON.stringify({ id: 'turn-1', status: 'completed', completedAt: T0 + 10 }))
    db.prepare('INSERT INTO agent_seen (agent_key, seen_at) VALUES (?, ?)').run('conversation:t4', T0 + 50)
    db.prepare('INSERT INTO conversation_events (thread_id, seq, data_json) VALUES (?, ?, ?)').run('t1', 1, JSON.stringify({ type: 'request', request: { id: 'r1', kind: 'question', title: 'raw', state: 'pending', createdAt: T0, generation: 1 } }))
    db.prepare('INSERT INTO conversation_events (thread_id, seq, data_json) VALUES (?, ?, ?)').run('t1', 2, JSON.stringify({ type: 'request', request: { id: 'r0', kind: 'approval', title: 'raw', state: 'resolved', createdAt: T0, generation: 1 } }))
    db.prepare(`INSERT INTO work_runs (id, supervisor_thread_id, workspace_id, project_id, project_root, request_key, title, status, created_at, updated_at) VALUES ('run1', 't2', 'w1', 'p', 'C:/repo', 'k', 'Audit', 'running', ?, ?)`).run(T0, T0)
    const task = db.prepare(`INSERT INTO work_tasks (id, run_id, key, title, prompt, provider, access, status, thread_id, position) VALUES (?, 'run1', ?, 'x', 'x', 'codex', 'read-only', ?, ?, ?)`)
    task.run('k1', 'a', 'succeeded', 'w9', 0); task.run('k2', 'b', 'running', null, 1)
    db.prepare(`INSERT INTO delegations (id, origin_execution, request_key, workspace_id, payload) VALUES ('d1', 'e1', 'k', 'w1', ?)`)
      .run(JSON.stringify({ id: 'd1', workspaceId: 'w1', objective: 'Write the migration', state: 'blocked', requestedBy: 'person', agentProfileId: 'prof', updatedAt: T0, originPaneId: 'x', path: '', branch: '' }))
    const panes: PaneAgentState[] = [{ paneId: 'p1', workspaceId: 'w1', agent: 'claude', state: 'working', source: 'hook', seen: false, since: T0, stateChangeSeq: 1, completionSeq: 0 }]
    const sources = dbAgentSources({ db, panes: { list: () => panes, get: id => panes.find(item => item.paneId === id) ?? null }, approvals: { list: () => [] }, workspaces: () => [], profiles: () => [{ agentProfileId: 'prof', provider: 'claude' }] })
    const store = new AgentSeenStore(db)
    const changes: AgentsChange[] = []
    const build = () => {
      const model = new AgentsReadModel({ sources, seen: store, subscribe: onAgentSource, subscribeStops: listener => onAgentStop(listener), publish: change => changes.push(change), nudge: () => undefined,
        focused: () => true, markPaneSeen: () => undefined, timers: { needsYouMs: 120_000, noReportMs: 10_000 } })
      model.start()
      stops.push(() => model.stop())
      return model
    }
    const model = build()
    const rows = Object.fromEntries(model.overview().rows.map(row => [row.key, row]))
    expect(Object.keys(rows).sort()).toEqual(['conversation:t1', 'conversation:t2', 'conversation:t4', 'delegation:d1', 'pane:p1', 'work:run1'])
    // The restart since is the turn's completion, not updatedAt: the person's earlier look still counts.
    expect(rows['conversation:t4']).toMatchObject({ state: 'idle', since: T0 + 10, seen: true })
    expect(rows['conversation:t1']).toMatchObject({ state: 'needs-you', pendingRequest: { via: 'thread', id: 'r1', title: { code: 'agents.request.question' }, more: 0 } })
    expect(rows['conversation:t2']).toMatchObject({ state: 'finished' })
    expect(rows['delegation:d1']).toMatchObject({ state: 'needs-you', provider: 'claude' })
    expect(rows['work:run1']).toMatchObject({ state: 'working', tasks: { done: 1, total: 2 }, parentKey: 'conversation:t2' })

    expect(model.markSeen({ key: 'conversation:t2' })).toMatchObject({ ok: true, state: 'idle', seenAt: T0 + 60_000 })
    expect(store.get('conversation:t2')).toBe(T0 + 60_000)
    model.stop()
    // A restart: a new model reads the mark back, so the conversation stays Idle.
    expect(build().overview().rows.find(row => row.key === 'conversation:t2')?.state).toBe('idle')

    // Deleting the conversation deletes its mark.
    db.prepare('DELETE FROM conversation_threads WHERE id = ?').run('t2')
    notifyAgentSource({ source: 'conversation', id: 't2', deleted: true })
    vi.advanceTimersByTime(1_000)
    expect(store.get('conversation:t2')).toBeNull()
    expect(changes.at(-1)?.removed).toEqual(['conversation:t2'])
  })
})
