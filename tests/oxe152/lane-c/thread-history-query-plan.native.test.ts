// Runs under Electron's Node ABI: npm run test:electron -- tests/oxe152/lane-c/thread-history-query-plan.native.test.ts
// OXE-351 (b): ThreadHistory's hot reads filter conversations and their events by JSON fields (json_extract). Without
// an index on those expressions SQLite reads every conversation, or every event of a conversation, and sorts turns in
// a temporary B-tree. The queries below are ThreadHistory's own, as written in thread-history.ts; each must be served by
// an index on its JSON expression. And ThreadHistory compiles each statement once, not on every call.
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { openInMemoryDatabase, type AppDatabase } from '../../../electron/main/db/index'
import { ThreadHistory } from '../../../electron/main/services/conversation/thread-history'

// `ordered`: the read of one conversation comes out in the index's order, so it needs no sort of its own.
const HOT: Record<string, { sql: string; params: unknown[]; index: RegExp; ordered: boolean }> = {
  'tool names of a conversation': {
    sql: "SELECT json_extract(data_json, '$.id') AS id, json_extract(data_json, '$.name') AS name FROM conversation_events WHERE thread_id = ? AND json_extract(data_json, '$.type') = 'tool' AND json_extract(data_json, '$.name') != 'Tool result' ORDER BY seq",
    params: ['t'],
    index: /USING INDEX conversation_events_type/,
    ordered: true,
  },
  'background events of a conversation': {
    sql: "SELECT data_json FROM conversation_events WHERE thread_id = ? AND json_extract(data_json, '$.type') = 'subagent' AND json_extract(data_json, '$.action') = 'Background command' ORDER BY seq",
    params: ['t'],
    index: /USING INDEX conversation_events_type/,
    ordered: true,
  },
  'pending requests of a conversation': {
    sql: "SELECT data_json FROM conversation_events WHERE thread_id = ? AND json_extract(data_json, '$.type') = 'request' AND json_extract(data_json, '$.request.state') = 'pending' ORDER BY seq LIMIT 100",
    params: ['t'],
    index: /USING INDEX conversation_events_type/,
    ordered: true,
  },
  'turns of a conversation in order': {
    sql: "SELECT data_json FROM conversation_turns WHERE thread_id = ? ORDER BY json_extract(data_json, '$.sequence')",
    params: ['t'],
    index: /USING INDEX conversation_turns_sequence/,
    ordered: true,
  },
  'pending requests of every waiting conversation': {
    sql: `SELECT t.data_json AS thread_json, e.data_json AS event_json
      FROM conversation_threads t CROSS JOIN conversation_events e ON e.thread_id = t.id
      WHERE json_extract(t.data_json, '$.status') = 'approval' AND json_extract(e.data_json, '$.type') = 'request' AND json_extract(e.data_json, '$.request.state') = 'pending'
      ORDER BY e.thread_id, e.seq LIMIT ?`,
    params: [200],
    index: /USING INDEX conversation_threads_status/,
    ordered: false,
  },
}

let db: AppDatabase
beforeEach(() => { db = openInMemoryDatabase() })
afterEach(() => { db.close() })

const plan = (sql: string, params: unknown[]): string[] =>
  (db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(...params) as Array<{ detail: string }>).map(row => row.detail)

describe('OXE-351 (b) · ThreadHistory reads use indexes on their JSON fields', () => {
  for (const [name, query] of Object.entries(HOT)) {
    test(`${name}: served by its index, with no full scan${query.ordered ? ' and no sort of its own' : ''}`, () => {
      const details = plan(query.sql, query.params)
      expect(details.join(' | '), 'the plan names the index on the JSON expression').toMatch(query.index)
      expect(details.filter(detail => /^SCAN (conversation_|t\b|e\b)/.test(detail) && !/USING (COVERING )?INDEX/.test(detail)), 'no full table scan').toEqual([])
      if (query.ordered) expect(details.filter(detail => /TEMP B-TREE/.test(detail)), 'no temporary sort').toEqual([])
    })
  }

  test('the waiting-conversation read joins events through the event-type index', () => {
    const details = plan(HOT['pending requests of every waiting conversation'].sql, [200]).join(' | ')
    expect(details).toMatch(/USING INDEX conversation_events_type/)
  })

  test('ThreadHistory compiles a hot statement once, however often it runs', () => {
    const history = new ThreadHistory(db)
    const prepare = vi.spyOn(db, 'prepare')
    history.pendingRequestRows()
    history.pendingRequestRows()
    history.pendingRequestRows(5)
    const compiled = prepare.mock.calls.filter(([sql]) => String(sql).includes("json_extract(t.data_json, '$.status') = 'approval'"))
    expect(compiled).toHaveLength(1)
  })
})
