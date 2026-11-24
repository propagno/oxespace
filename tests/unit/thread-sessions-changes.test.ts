// @vitest-environment node
// OXE-412: since #906 the OxeChat sidebar reads the sessions (thread.sessions, OXE-170's +N −N on each row) whenever a
// conversation's status changes. listSessions summed each stored conversation's +N −N by reading every tool event into
// the main process and parsing its whole JSON, output included: with the memory-footprint's long conversations that
// grew the main heap by about 70 MB and left Windows' browser private memory over its 270 MB budget. The sums are now
// SQLite's, and the stored events are never parsed in JS for them.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { openInMemoryDatabase, type AppDatabase } from '../../electron/main/db'
import { listSessions, type SessionHost } from '../../electron/main/services/conversation/thread-sessions'
import type { ThreadEvent, ThreadSnapshot } from '../../shared/types/thread'

const opened: AppDatabase[] = []
afterEach(() => { vi.restoreAllMocks(); for (const db of opened.splice(0)) db.close() })

const TOOL_EVENTS = 400

function seed(): AppDatabase {
  const db = openInMemoryDatabase()
  opened.push(db)
  db.pragma('foreign_keys = OFF')
  const insertThread = db.prepare('INSERT INTO conversation_threads (id, workspace_id, thread_project_id, data_json, events_json, history_version) VALUES (?, ?, ?, ?, ?, ?)')
  const insertEvent = db.prepare('INSERT INTO conversation_events (thread_id, seq, data_json) VALUES (?, ?, ?)')
  const thread = (id: string) => JSON.stringify({ id, workspaceId: 'w', projectId: 'p', rootPath: '/r', provider: 'claude', title: id, status: 'idle', createdAt: 1, updatedAt: 1 })
  // A long stored conversation: tool events with a big output, a third of them with file changes, some not completed.
  insertThread.run('long', 'w', 'p', thread('long'), '[]', 1)
  for (let seq = 0; seq < TOOL_EVENTS; seq++) {
    const files = seq % 3 === 0 ? [{ path: `f${seq}.ts`, state: 'completed', additions: 2, deletions: 1 }, { path: `g${seq}.ts`, state: 'failed', additions: 50, deletions: 50 }] : undefined
    insertEvent.run('long', seq, JSON.stringify({ type: 'tool', id: `t${seq}`, name: 'commandExecution', state: 'completed', output: 'x'.repeat(4000), ...(files ? { files } : {}) }))
    insertEvent.run('long', TOOL_EVENTS + seq, JSON.stringify({ type: 'message', id: `m${seq}`, role: 'assistant', text: 'y'.repeat(2000) }))
  }
  // A conversation of an older build, its events still in the legacy column, and one with no file change at all.
  const legacy: ThreadEvent[] = [{ type: 'tool', id: 'l1', name: 'fileChange', state: 'completed', files: [{ path: 'a.ts', kind: 'update', state: 'completed', additions: 7, deletions: 3 }] } as unknown as ThreadEvent]
  insertThread.run('legacy', 'w', 'p', thread('legacy'), JSON.stringify(legacy), 0)
  insertThread.run('empty', 'w', 'p', thread('empty'), '[]', 1)
  return db
}

const host = (db: AppDatabase, cached: Record<string, ThreadSnapshot> = {}): SessionHost => ({
  db,
  cached: id => cached[id],
  read: () => { throw new Error('not read here') },
  save: () => { throw new Error('not written here') },
  create: () => { throw new Error('not created here') },
})

describe('OXE-412: the sessions read sums +N −N without parsing the stored events in the main process', () => {
  it('sums the completed file changes of every chat, stored, legacy and empty', () => {
    const sessions = listSessions(host(seed()))
    const changes = Object.fromEntries(sessions.map(session => [session.id, session.changes]))
    const withFiles = Math.ceil(TOOL_EVENTS / 3)
    expect(changes).toEqual({ long: { additions: 2 * withFiles, deletions: withFiles }, legacy: { additions: 7, deletions: 3 }, empty: { additions: 0, deletions: 0 } })
  })

  it("a long stored conversation's events are not parsed in JS to list the sessions", () => {
    const db = seed()
    const parse = vi.spyOn(JSON, 'parse')
    listSessions(host(db))
    // One parse per thread row (its data_json) and the legacy row's events, never one per stored event (800 here).
    expect(parse.mock.calls.length, 'JSON.parse calls while listing the sessions').toBeLessThan(20)
    expect(parse.mock.calls.some(([text]) => typeof text === 'string' && text.includes('x'.repeat(4000)))).toBe(false)
  })

  it('an open conversation still sums from its snapshot in memory, which is newer than the rows', () => {
    const db = seed()
    const events = [{ type: 'tool', id: 'live', name: 'fileChange', state: 'completed', files: [{ path: 'b.ts', kind: 'update', state: 'completed', additions: 11, deletions: 4 }] }] as unknown as ThreadEvent[]
    const snapshot = { thread: { id: 'long', workspaceId: 'w', projectId: 'p', rootPath: '/r', provider: 'claude', title: 'long', status: 'running', createdAt: 1, updatedAt: 2 }, events } as unknown as ThreadSnapshot
    const sessions = listSessions(host(db, { long: snapshot }))
    expect(sessions.find(session => session.id === 'long')?.changes).toEqual({ additions: 11, deletions: 4 })
  })
})
