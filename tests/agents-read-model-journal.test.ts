import { afterEach, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { openInMemoryDatabase, type AppDatabase } from '../electron/main/db'
import { AgentsReadModel } from '../electron/main/services/agents/agents-read-model'
import { ThreadHistory } from '../electron/main/services/conversation/thread-history'
import { ThreadPlaceObserver } from '../electron/main/services/conversation/thread-place-observer'
import type { ConversationThread, ThreadEvent, ThreadSnapshot, ThreadTurn } from '../shared/types/thread'

/*
 * OXE-413 · The OxeChat load test (e2e/perf/oxechat-load.spec.ts) found the main process's cost growing with every
 * streaming batch: the agents overview parsed the newest 200 events of every conversation on each change, and the tool
 * tabs ran ~30 git processes a second through places(). The overview now reads each journal incrementally, and the
 * tool tabs and the agent summary count files from the bookkeeping.
 */
const databases: AppDatabase[] = []
afterEach(() => { for (const db of databases.splice(0)) db.close() })

function setup() {
  const db = openInMemoryDatabase()
  databases.push(db)
  db.prepare("INSERT INTO workspaces (id, name, root_path, layout, default_shell_profile_id) VALUES ('ws', 'Test', '/repo', '1x1', 'builtin-codex')").run()
  db.prepare("INSERT INTO thread_projects (id, identity, root_path, display_name, created_at, updated_at) VALUES ('project', '/repo', '/repo', 'Test', 1, 1)").run()
  const model = () => new AgentsReadModel({ db, panes: () => [], threadRequests: () => [], now: () => 1_000 })
  return { db, history: new ThreadHistory(db), model }
}

function conversation(db: AppDatabase, id: string): ThreadSnapshot {
  const thread: ConversationThread = {
    id, workspaceId: 'ws', projectId: 'project', rootPath: '/repo', provider: 'claude', nativeSessionId: 'native-1', title: `Conversation ${id}`,
    pinned: false, status: 'running', createdAt: 1, updatedAt: 100, generation: 1
  }
  db.prepare('INSERT INTO conversation_threads (id, workspace_id, thread_project_id, data_json, events_json) VALUES (?, ?, ?, ?, ?)')
    .run(id, 'ws', 'project', JSON.stringify(thread), '[]')
  const turns: ThreadTurn[] = [{ id: `${id}-turn-1`, nativeId: 'n1', sequence: 1, startedAt: 10, status: 'running', configuration: {} } as ThreadTurn]
  return { thread, events: [], turns }
}

const message = (id: string, text: string): ThreadEvent => ({ type: 'message', id, role: 'assistant', text })
const strip = (overview: ReturnType<AgentsReadModel['overview']>) => overview.agents

describe('the agents overview reads conversation journals incrementally (OXE-413)', () => {
  it('reads only the rows written since, and matches a fresh read at every step', () => {
    const { db, history, model } = setup()
    const a = conversation(db, 'a'), b = conversation(db, 'b')
    for (let i = 0; i < 230; i++) a.events.push(message(`a${i}`, `answer ${i}`))
    b.events.push({ type: 'message', id: 'b-user', role: 'user', text: 'hello' })
    history.write(a)
    history.write(b)
    const live = model()
    const steps: Array<[string, () => void]> = [
      ['nothing changed', () => undefined],
      ['a delta grows the newest message', () => { (a.events[a.events.length - 1] as { text: string }).text += ' more'; history.persistFrom(a, a.events.length - 1) }],
      ['a new event past the 200 kept', () => { a.events.push(message('a-new', 'new')); history.persistFrom(a, a.events.length - 1) }],
      ['an older event updated in place', () => { a.events[a.events.length - 150] = message(`a${a.events.length - 150}`, 'rewritten'); history.persistFrom(a, a.events.length - 150) }],
      ['a turn ends', () => { a.turns![0] = { ...a.turns![0], status: 'completed', completedAt: 50 } as ThreadTurn; history.persistFrom(a, a.events.length) }],
      ['the history is truncated (a new epoch)', () => { a.events.splice(100); history.rewriteHistory(a) }],
      ['another conversation changes', () => { b.events.push(message('b-answer', 'hi')); history.persistFrom(b, b.events.length - 1) }]
    ]
    for (const [label, change] of steps) {
      change()
      expect(strip(live.overview()), label).toEqual(strip(model().overview()))
    }
  })

  it('reads nothing again for a conversation whose journal did not move', () => {
    const { db, history, model } = setup()
    const a = conversation(db, 'a')
    a.events.push(message('a0', 'answer'))
    history.write(a)
    const live = model()
    live.overview()
    // Statements are prepared on every overview; what matters is that no event read runs for an unchanged journal.
    const runs: string[] = []
    const prepare = db.prepare.bind(db)
    db.prepare = ((sql: string) => {
      const statement = prepare(sql)
      if (!/FROM conversation_events/.test(sql)) return statement
      return new Proxy(statement, {
        get(target, key) {
          const value = Reflect.get(target, key) as unknown
          if (key === 'all') return (...args: unknown[]) => { runs.push(sql); return (value as (...a: unknown[]) => unknown).apply(target, args) }
          return typeof value === 'function' ? (value as (...a: unknown[]) => unknown).bind(target) : value
        }
      })
    }) as typeof db.prepare
    try {
      live.overview()
      expect(runs).toEqual([])
      a.events.push(message('a1', 'next'))
      history.persistFrom(a, a.events.length - 1)
      live.overview()
      // Only the rows written since, never the newest 200 again.
      expect(runs).toHaveLength(1)
      expect(runs[0]).toContain('rev > ?')
    } finally { db.prepare = prepare }
  })
})

describe('the tool tabs and the agent summary count files without git (OXE-413)', () => {
  it('counts the files the conversation wrote from the bookkeeping', () => {
    const { db } = setup()
    conversation(db, 't')
    db.prepare("INSERT INTO thread_places (thread_id, id, kind, path, first_seen_at, writes) VALUES ('t', 'pl-root', 'root', '/repo', 1, 2)").run()
    db.prepare("INSERT INTO thread_place_writes (thread_id, place_id, path, kind, at) VALUES ('t', 'pl-root', 'index.ts', 'update', 2), ('t', 'pl-root', 'extra.ts', 'add', 3)").run()
    const observer = new ThreadPlaceObserver({ db } as unknown as ConstructorParameters<typeof ThreadPlaceObserver>[0])
    expect(observer.placeFileCount('t')).toBe(2)
    expect(observer.placeFileCount('other')).toBe(0)
  })

  it('the readers that run on every change never call places(), which reads each place with git (marked source check)', () => {
    const source = readFileSync(join(process.cwd(), 'electron/main/ipc/thread.ipc.ts'), 'utf8')
    const toolTabs = source.slice(source.indexOf('const toolTabs = async'), source.indexOf('return threadToolTabs('))
    const agentSummary = source.slice(source.indexOf('IPC_CHANNELS.thread.agentSummary'), source.indexOf('return threadAgentSummary('))
    for (const [name, body] of [['tool tabs', toolTabs], ['agent summary', agentSummary]] as const) {
      expect(body, name).toContain('placeFileCount(')
      expect(body, name).not.toMatch(/\.places\(/)
    }
  })
})

describe('the approval notifier reads only the pending requests (OXE-413)', () => {
  it('pendingRequestsOf gives what the window gives, without reading the window', () => {
    const { db, history } = setup()
    const a = conversation(db, 'a')
    for (let i = 0; i < 20; i++) a.events.push(message(`a${i}`, `answer ${i}`))
    history.write(a)
    expect(history.pendingRequestsOf('a')).toEqual(history.readWindow('a').pendingRequests ?? [])
    a.thread.status = 'approval'
    a.events.push({ type: 'request', id: 'r1', request: { id: 'r1', nativeId: 'n1', nativeMethod: 'can_use_tool', kind: 'approval', title: 'Run npm test', generation: 1, createdAt: 5, state: 'pending' } } as ThreadEvent)
    history.persistFrom(a, a.events.length - 1)
    expect(history.pendingRequestsOf('a').map(request => request.id)).toEqual(['r1'])
    expect(history.pendingRequestsOf('a')).toEqual(history.readWindow('a').pendingRequests ?? [])
    expect(() => history.pendingRequestsOf('missing')).toThrow()
  })

  it('the notifier that runs on every change uses it, not the whole window (marked source check)', () => {
    const source = readFileSync(join(process.cwd(), 'electron/main/index.ts'), 'utf8')
    const observer = source.slice(source.indexOf('delegatedThreadObserver.current = thread =>'), source.indexOf('seenApprovalNotifications.get(thread.id)'))
    expect(observer).toContain('pendingRequestsOf(thread.id)')
    expect(observer).not.toContain('readWindow(')
  })
})
