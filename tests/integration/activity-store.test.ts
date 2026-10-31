import { afterEach, describe, expect, it } from 'vitest'
import { openInMemoryDatabase, type AppDatabase } from '../../electron/main/db'
import { ActivityStore } from '../../electron/main/services/activity-store'
import type { ActivityEntry } from '../../shared/types/activity'

const NOW = 1_800_000_000_000
const databases: AppDatabase[] = []
afterEach(() => { for (const db of databases.splice(0)) db.close() })

function setup() {
  const db = openInMemoryDatabase(); databases.push(db)
  return { db, store: new ActivityStore(db, () => NOW) }
}

const entry = (id: string, at: number, over: Partial<ActivityEntry> = {}): ActivityEntry => ({ source: 'thread', id, kind: 'needs-you', target: { type: 'thread', threadId: id, workspaceId: 'thread:p1' }, title: `Conversation ${id}`, detail: 'Waiting for your decision.', at, ...over })
const rows = (db: AppDatabase) => db.prepare('SELECT * FROM activity_entries ORDER BY position').all()
const state = (db: AppDatabase) => db.prepare('SELECT * FROM activity_state').all()

describe('activity store (F30)', () => {
  it('starts empty', () => {
    expect(setup().store.recent()).toEqual({ entries: [], lastSeenAt: null })
  })

  it('stores entries of every source and reads them back newest first, after a reopen of the store', () => {
    const { db, store } = setup()
    const entries: ActivityEntry[] = [
      entry('t1', NOW - 5000),
      { source: 'code', id: 'pane-1', kind: 'failed', target: { type: 'pane', workspaceId: 'w1', paneId: 'pane-1' }, title: 'Claude', detail: 'Exited with an error.', at: NOW - 1000 },
      { source: 'background', id: 'job-1', kind: 'finished', target: { type: 'background', workspaceId: 'w1', jobId: 'job-1' }, title: 'npm test', at: NOW - 3000 },
      { source: 'quota', id: 'claude:5h', kind: 'quota', target: { type: 'quota', provider: 'claude' }, title: 'Claude is at 90%', at: NOW - 4000 },
      { source: 'update', id: '1.4.0', kind: 'update', target: { type: 'update', version: '1.4.0' }, title: 'OXESpace 1.4.0 is ready', at: NOW - 2000 },
      { source: 'mcp', id: 'srv', kind: 'needs-you', target: { type: 'mcp', serverId: 'srv' }, title: 'A server changed its tools', at: NOW }
    ]
    expect(store.record(entries)).toEqual({ ok: true, recorded: 6, ignored: 0 })
    const again = new ActivityStore(db, () => NOW).recent()
    expect(again.entries.map(item => item.id)).toEqual(['srv', 'pane-1', '1.4.0', 'job-1', 'claude:5h', 't1'])
    expect(again.entries.find(item => item.id === 't1')).toEqual(entries[0])
    expect(again.entries.find(item => item.id === 'job-1')).not.toHaveProperty('detail')
  })

  it('stores trimmed text', () => {
    const { store } = setup()
    store.record([{ ...entry('t1', NOW), title: '  Spaced  ', detail: '   ' }])
    expect(store.recent().entries).toEqual([{ ...entry('t1', NOW), title: 'Spaced', detail: undefined }])
    expect(store.recent().entries[0]).not.toHaveProperty('detail')
  })

  it('dedupes on source, id and kind, keeping the newer', () => {
    const { db, store } = setup()
    store.record([entry('t1', NOW - 100, { title: 'first' })])
    expect(store.record([entry('t1', NOW - 50, { title: 'newer' })])).toEqual({ ok: true, recorded: 1, ignored: 0 })
    expect(store.record([entry('t1', NOW - 500, { title: 'stale' })])).toEqual({ ok: true, recorded: 0, ignored: 1 })
    expect(store.record([entry('t1', NOW - 10, { kind: 'finished', title: 'finished' })])).toMatchObject({ recorded: 1 })
    expect(store.recent().entries.map(item => item.title)).toEqual(['finished', 'newer'])
    expect(rows(db)).toHaveLength(2)
  })

  it('keeps only the newest 200 overall', () => {
    const { db, store } = setup()
    store.record(Array.from({ length: 200 }, (_, index) => entry(`a${index}`, NOW - 10_000 - index)))
    expect(store.record(Array.from({ length: 50 }, (_, index) => entry(`b${index}`, NOW - index)))).toEqual({ ok: true, recorded: 50, ignored: 0 })
    const { entries } = store.recent()
    expect(entries).toHaveLength(200)
    expect(entries.slice(0, 50).every(item => item.id.startsWith('b'))).toBe(true)
    expect(entries.at(-1)!.id).toBe('a149')
    expect(rows(db)).toHaveLength(200)
    // Older than everything kept: valid, and not stored.
    expect(store.record([entry('ancient', 1)])).toEqual({ ok: true, recorded: 0, ignored: 1 })
    expect(store.recent().entries.some(item => item.id === 'ancient')).toBe(false)
  })

  it('leaves the stored list untouched when a call is refused', () => {
    const { db, store } = setup()
    store.record([entry('t1', NOW - 100), entry('t2', NOW - 200)])
    store.seen(NOW - 150)
    const before = { rows: rows(db), state: state(db) }
    const refused = [
      [entry('t1', NOW), entry('t3', NOW, { title: 'token=' + 'abcdef123456' })],
      [entry('t1', NOW), entry('t3', NOW, { detail: 'a‮b' })],
      [entry('t1', NOW), { ...entry('t3', NOW), read: true }],
      [entry('t1', NOW + 120_000)],
      Array.from({ length: 201 }, (_, index) => entry(`n${index}`, NOW)),
      'nonsense'
    ]
    for (const input of refused) expect(store.record(input)).toMatchObject({ ok: false })
    expect(store.seen(NOW + 120_000)).toMatchObject({ ok: false, refusal: 'future' })
    expect(store.seen('later')).toMatchObject({ ok: false, refusal: 'invalid' })
    expect({ rows: rows(db), state: state(db) }).toEqual(before)
  })

  it('moves the seen time forward only', () => {
    const { store } = setup()
    expect(store.seen(NOW - 1000)).toEqual({ ok: true, lastSeenAt: NOW - 1000 })
    expect(store.seen(NOW - 5000)).toEqual({ ok: true, lastSeenAt: NOW - 1000 })
    expect(store.seen(NOW + 60_000)).toEqual({ ok: true, lastSeenAt: NOW + 60_000 })
    expect(store.recent().lastSeenAt).toBe(NOW + 60_000)
  })

  it('rejects rows a writer other than the store might leave, at the schema', () => {
    const { db } = setup()
    expect(() => db.prepare("INSERT INTO activity_state (singleton, last_seen_at) VALUES (2, 1)").run()).toThrow()
    expect(() => db.prepare("INSERT INTO activity_entries (source, id, kind, target_json, title, at, position) VALUES ('thread', 'x', 'finished', '{}', 'x', -1, 0)").run()).toThrow()
  })
})
