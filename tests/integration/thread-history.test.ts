import { afterEach, describe, expect, it } from 'vitest'
import { openInMemoryDatabase, type AppDatabase } from '../../electron/main/db'
import { ThreadHistory } from '../../electron/main/services/conversation/thread-history'
import type { ThreadSnapshot } from '../../shared/types/thread'

const databases: AppDatabase[] = []
afterEach(() => { for (const db of databases.splice(0)) db.close() })
function fixture() {
  const db = openInMemoryDatabase(); databases.push(db)
  db.prepare("INSERT INTO workspaces (id, name, root_path, layout, default_shell_profile_id) VALUES ('ws', 'Repo', '/repo', '1x1', 'builtin-claude')").run()
  db.prepare("INSERT INTO thread_projects (id, identity, root_path, display_name, created_at, updated_at) VALUES ('project', '/repo', '/repo', 'Repo', 1, 1)").run()
  const snapshot: ThreadSnapshot = { thread: { id: 'thread', workspaceId: 'ws', projectId: 'project', rootPath: '/repo', provider: 'codex', nativeSessionId: null, title: 'Legacy', pinned: false, status: 'idle', createdAt: 1, updatedAt: 1 }, events: [{ type: 'message', id: 'user', role: 'user', text: 'Keep this history' }] }
  db.prepare('INSERT INTO conversation_threads (id, workspace_id, thread_project_id, data_json, events_json) VALUES (?, ?, ?, ?, ?)').run('thread', 'ws', 'project', JSON.stringify(snapshot.thread), JSON.stringify(snapshot.events))
  return { db, snapshot, history: new ThreadHistory(db) }
}
const patch = '--- a/file.ts\n+++ b/file.ts\n@@ -1,2 +1,2 @@\n-old\n+new\n context\n'
describe('indexed Thread history', () => {
  it('reads a conversation\'s metadata without its events, and leaves a pre-journal row to read()', () => {
    const f = fixture()
    // A legacy row has no journal yet: the metadata read declines so the caller migrates it first.
    expect(f.history.readThread('thread')).toBeUndefined()
    f.history.read('thread')
    expect(f.history.readThread('thread')).toMatchObject({ id: 'thread', provider: 'codex', rootPath: '/repo' })
    expect(() => f.history.readThread('missing')).toThrow('Thread not found')
  })
  it('keeps actionable requests outside the renderer history window until resolved', () => {
    const f = fixture()
    f.snapshot.thread.status = 'approval'
    const request = { id: 'input', nativeId: 'input', nativeMethod: 'mcpServer/elicitation/request', kind: 'elicitation' as const, title: 'Memory confirmation', generation: 1, createdAt: 1, state: 'pending' as const }
    f.snapshot.events.push({ type: 'request', id: request.id, request }, ...Array.from({ length: 300 }, (_, index) => ({ type: 'tool' as const, id: `tool-${index}`, name: 'commandExecution', state: 'completed' as const, detail: 'check' })))
    f.history.write(f.snapshot)
    const window = f.history.readWindow('thread', 20)
    expect(window.events).toHaveLength(20)
    expect(window.events.some(event => event.type === 'request')).toBe(false)
    expect(window.pendingRequests).toEqual([request])
    const event = f.snapshot.events.find(event => event.type === 'request')!
    if (event.type === 'request') event.request.state = 'resolved'
    f.history.write(f.snapshot)
    expect(f.history.readWindow('thread', 20).pendingRequests).toEqual([])
  })
  it('lists pending requests across conversations waiting for approval, as titles only', () => {
    const f = fixture()
    const request = { id: 'run', nativeId: 'run', nativeMethod: 'item/commandExecution/requestApproval', kind: 'approval' as const, title: 'Run the tests', command: 'npm test', generation: 1, createdAt: 5, state: 'pending' as const }
    const resolved = { ...request, id: 'old', title: 'Earlier', state: 'resolved' as const }
    f.snapshot.events.push({ type: 'request', id: resolved.id, request: resolved }, { type: 'request', id: request.id, request })
    f.history.write(f.snapshot)
    // Not waiting: its pending event is not reported.
    expect(f.history.pendingRequestsAll()).toEqual([])
    f.snapshot.thread.status = 'approval'
    f.history.write(f.snapshot)
    expect(f.history.pendingRequestsAll()).toEqual([{ threadId: 'thread', workspaceId: 'ws', threadTitle: 'Legacy', requestId: 'run', kind: 'approval', title: 'Run the tests', createdAt: 5 }])
  })
  it('exports persisted earlier pages without changing the live journal and clears them explicitly on native replacement', () => {
    const f = fixture()
    f.history.read('thread')
    const older = { type: 'message', id: 'older', role: 'user', text: 'Earlier native history' } as const
    f.history.prependNative('thread', [older])
    f.history.prependNative('thread', [older])
    expect(f.history.readImported('thread').events).toEqual([older, ...f.snapshot.events])
    expect(f.history.read('thread').events).toEqual(f.snapshot.events)
    const reopened = new ThreadHistory(f.db)
    expect(reopened.page('thread').events).toEqual([older, ...f.snapshot.events])
    reopened.clearNativePages('thread')
    expect(reopened.readImported('thread').events).toEqual(f.snapshot.events)
  })
  it('imports legacy messages exactly once, without inventing execution times', () => {
    const f = fixture()
    expect(f.history.read('thread').events).toEqual(f.snapshot.events)
    expect(f.history.read('thread').turns).toEqual([])
    expect(f.db.prepare('SELECT events_json, history_version FROM conversation_threads').get()).toEqual({ events_json: '[]', history_version: 1 })
    expect(f.db.prepare('SELECT COUNT(*) AS count FROM conversation_events').get()).toEqual({ count: 1 })
  })
  it('keeps patches out of snapshots, isolates ownership and survives a new reader', () => {
    const f = fixture()
    f.snapshot.events.push({ type: 'tool', id: 'edit', name: 'fileChange', state: 'completed', detail: 'file.ts', files: [{ path: 'file.ts', source: 'native-patch', kind: 'update', state: 'completed', patch }] })
    f.history.write(f.snapshot)
    const snapshot = new ThreadHistory(f.db).read('thread'), tool = snapshot.events[1]
    expect(JSON.stringify(snapshot)).not.toContain('--- a/file.ts')
    expect(tool).toMatchObject({ files: [{ additions: 1, deletions: 1 }] })
    if (tool.type !== 'tool') throw Error('Missing tool')
    const artifactId = tool.files![0].artifactId!
    expect(f.history.artifact('thread', artifactId)).toMatchObject({ content: patch, truncated: false, bytes: Buffer.byteLength(patch) })
    expect(() => f.history.artifact('another-thread', artifactId)).toThrow('not available')
    f.history.write(snapshot)
    expect(f.db.prepare('SELECT COUNT(*) AS count FROM conversation_artifacts').get()).toEqual({ count: 1 })
    expect(f.db.prepare('SELECT turn_id FROM conversation_events WHERE seq = 1').get()).toEqual({ turn_id: 'user' })
  })
  it('marks oversized evidence partial and does not publish misleading totals', () => {
    const f = fixture()
    f.snapshot.events.push({ type: 'tool', id: 'large', name: 'fileChange', state: 'completed', detail: '', files: [{ path: 'large', source: 'native-patch', kind: 'update', state: 'completed', patch: patch + '+x\n'.repeat(190000) }] })
    f.history.write(f.snapshot)
    const tool = f.history.read('thread').events[1]
    if (tool.type !== 'tool') throw Error('Missing tool')
    expect(tool.files![0]).toMatchObject({ truncated: true })
    expect(tool.files![0].additions).toBeUndefined()
    expect(f.history.artifact('thread', tool.files![0].artifactId!).bytes).toBeLessThanOrEqual(512 * 1024 + 3)
  })
  it('replaces rewound history and cascades private evidence when the Thread is deleted', () => {
    const f = fixture()
    f.snapshot.events.push({ type: 'tool', id: 'edit', name: 'fileChange', state: 'completed', detail: '', files: [{ path: 'a', source: 'native-patch', kind: 'update', state: 'completed', patch }] })
    f.history.write(f.snapshot)
    f.snapshot.events = []
    f.history.write(f.snapshot)
    expect(f.history.read('thread').events).toEqual([])
    f.db.prepare("DELETE FROM conversation_threads WHERE id = 'thread'").run()
    expect(f.db.prepare('SELECT COUNT(*) AS count FROM conversation_artifacts').get()).toEqual({ count: 0 })
  })
  it('does not rewrite unchanged event rows when only a streamed answer changes', () => {
    const f = fixture()
    f.snapshot.events.push({ type: 'message', id: 'assistant', role: 'assistant', text: 'First' })
    f.history.write(f.snapshot)
    f.db.exec('CREATE TABLE updates (seq INTEGER); CREATE TRIGGER track_updates AFTER UPDATE ON conversation_events BEGIN INSERT INTO updates VALUES (NEW.seq); END;')
    f.snapshot.events[1] = { type: 'message', id: 'assistant', role: 'assistant', text: 'First second' }
    f.history.write(f.snapshot)
    expect(f.db.prepare('SELECT seq FROM updates').all()).toEqual([{ seq: 1 }])
  })
  it('updates Thread metadata without scanning or touching event and turn rows', () => {
    const f = fixture()
    f.snapshot.turns = [{ id: 'user', sequence: 1, startedAt: 1, status: 'completed', configuration: { access: 'read-only', networkAccess: false, approvalPolicy: 'on-request', mode: 'default', hooksEnabled: false } }]
    f.history.rewriteHistory(f.snapshot)
    f.db.exec(`
      CREATE TABLE history_touches (table_name TEXT);
      CREATE TRIGGER track_event_touch AFTER UPDATE ON conversation_events BEGIN INSERT INTO history_touches VALUES ('event'); END;
      CREATE TRIGGER track_turn_touch AFTER UPDATE ON conversation_turns BEGIN INSERT INTO history_touches VALUES ('turn'); END;
    `)
    f.snapshot.thread.title = 'Renamed without history rewrite'
    f.history.updateThreadMetadata(f.snapshot.thread)

    expect(f.history.read('thread')).toMatchObject({ thread: { title: 'Renamed without history rewrite' }, events: f.snapshot.events, turns: f.snapshot.turns })
    expect(f.db.prepare('SELECT * FROM history_touches').all()).toEqual([])
  })
  it('persists stable v2 envelopes and updates only the declared event tail', () => {
    const f = fixture()
    f.snapshot.events.push(
      { type: 'message', id: 'assistant', role: 'assistant', text: 'First' },
      { type: 'tool', id: 'tool', name: 'read', state: 'running', detail: 'file.ts' }
    )
    f.history.write(f.snapshot)
    const before = f.db.prepare('SELECT seq, event_id, generation, schema_version FROM conversation_event_envelopes ORDER BY seq').all()
    f.db.exec('CREATE TABLE envelope_updates (seq INTEGER); CREATE TRIGGER track_envelope_updates AFTER UPDATE ON conversation_event_envelopes BEGIN INSERT INTO envelope_updates VALUES (NEW.seq); END;')
    f.snapshot.events[2] = { type: 'tool', id: 'tool', name: 'read', state: 'completed', detail: 'file.ts' }
    f.history.write(f.snapshot, { eventsFrom: 2, operationId: 'operation' })
    expect(f.db.prepare('SELECT seq FROM envelope_updates').all()).toEqual([{ seq: 2 }])
    expect(f.db.prepare('SELECT seq, event_id, generation, schema_version FROM conversation_event_envelopes ORDER BY seq').all()).toEqual(before)
    expect(f.db.prepare('SELECT operation_id FROM conversation_event_envelopes WHERE seq = 2').get()).toEqual({ operation_id: 'operation' })
  })
  it('keeps operation transitions monotonic and preserves unknown recovery state', () => {
    const f = fixture()
    const operation = f.history.beginOperation({ id: 'op', threadId: 'thread', turnId: 'user', generation: 3, kind: 'turn' })
    expect(operation.state).toBe('created')
    expect(f.history.transitionOperation('thread', 'op', 'running')?.state).toBe('running')
    expect(f.history.transitionOperation('thread', 'op', 'sent')?.state).toBe('running')
    expect(f.history.settleOpenOperations('thread', 'unknown', 'restart')).toBe(1)
    expect(f.history.transitionOperation('thread', 'op', 'completed')?.state).toBe('unknown')
    expect(f.history.operations('thread')).toEqual([expect.objectContaining({ id: 'op', turnId: 'user', generation: 3, kind: 'turn', state: 'unknown', error: 'restart' })])
  })
  it('returns a bounded latest window and stable cursors for long conversations', () => {
    const f = fixture()
    f.snapshot.events = Array.from({ length: 1000 }, (_, index) => ({ type: 'message' as const, id: `m${index}`, role: index % 2 ? 'assistant' as const : 'user' as const, text: `Message ${index}` }))
    f.history.write(f.snapshot)
    const initial = f.history.readWindow('thread', 200)
    expect(initial.events).toHaveLength(200)
    expect(initial.events[0]).toMatchObject({ id: 'm800' })
    expect(initial.page).toEqual({ before: 800, hasMore: true, total: 1000, live: 1000 })
    const previous = f.history.page('thread', initial.page!.before, 200)
    expect(previous.events[0]).toMatchObject({ id: 'm600' })
    expect(previous.before).toBe(600)
  })
  it('refuses to persist a paginated renderer projection over complete history', () => {
    const f = fixture()
    f.snapshot.events = Array.from({ length: 12 }, (_, index) => ({ type: 'message' as const, id: `m${index}`, role: 'user' as const, text: `Message ${index}` }))
    f.history.write(f.snapshot)
    const projection = f.history.readWindow('thread', 5)
    expect(() => f.history.write(projection)).toThrow('paginated Thread projection')
    expect(f.history.read('thread').events).toHaveLength(12)
    expect(f.history.read('thread').events[0]).toMatchObject({ id: 'm0' })
  })
  it('keeps more than 10,000 and 2 MiB of history writable while renderer reads stay bounded', () => {
    const f = fixture()
    const body = 'x'.repeat(240)
    f.snapshot.events = Array.from({ length: 10020 }, (_, index) => ({ type: 'message' as const, id: `long-${index}`, role: index % 2 ? 'assistant' as const : 'user' as const, text: `${index}:${body}` }))
    f.history.write(f.snapshot)
    const window = f.history.readWindow('thread', 250)
    expect(window.events).toHaveLength(250)
    expect(window.page).toMatchObject({ hasMore: true, total: 10020 })
    const complete = f.history.read('thread')
    complete.events.push({ type: 'message', id: 'long-next', role: 'user', text: 'Continue after a long conversation' })
    f.history.write(complete)
    expect(f.history.page('thread', undefined, 1)).toMatchObject({ total: 10021, events: [{ id: 'long-next' }] })
    expect(f.history.page('thread', 1, 1).events).toMatchObject([{ id: 'long-0' }])
  })
  it('projects delivery state for sent turns and queued inputs', () => {
    const f = fixture()
    const sent = f.history.beginOperation({ threadId: 'thread', turnId: 'turn-1', generation: 1, kind: 'turn' })
    const lost = f.history.beginOperation({ threadId: 'thread', turnId: 'turn-2', generation: 1, kind: 'turn' })
    const queued = f.history.beginOperation({ threadId: 'thread', generation: 1, kind: 'queue' })
    f.snapshot.turns = [
      { id: 'turn-1', operationId: sent.id, sequence: 1, status: 'completed', configuration: {} },
      { id: 'turn-2', operationId: lost.id, sequence: 2, status: 'failed', configuration: {} }
    ]
    f.snapshot.events = [
      { type: 'message', id: 'turn-1', role: 'user', text: 'First' },
      { type: 'message', id: 'turn-2', role: 'user', text: 'Second' }
    ]
    f.snapshot.thread.queue = [{ id: 'queued-1', operationId: queued.id, text: 'Later', createdAt: 1, state: 'queued' }]
    f.history.write(f.snapshot)
    f.history.transitionOperation('thread', sent.id, 'acknowledged')
    f.history.transitionOperation('thread', lost.id, 'unknown', 'The app closed before the provider answered.')
    f.history.updateThreadMetadata(f.snapshot.thread)
    const window = f.history.readWindow('thread', 50)
    expect(window.deliveries).toMatchObject({
      'turn-1': { state: 'delivered' },
      'turn-2': { state: 'unconfirmed', error: 'The app closed before the provider answered.' },
      'queued-1': { state: 'sending' }
    })
  })
})

describe('thread history incremental reads', () => {
  const user = (id: string, text = id): ThreadSnapshot['events'][number] => ({ type: 'message', id, role: 'user', text })

  it('returns only the rows written after the cursor, then resets after a truncation', () => {
    const f = fixture(), thread = f.snapshot.thread
    f.history.write({ thread, events: [user('a'), user('b')], turns: [] })
    const window = f.history.readWindow('thread')
    const cursor = window.sync!
    expect(cursor.revision).toBeGreaterThan(0)
    expect(window.page?.live).toBe(2)
    f.history.write({ thread, events: [user('a'), user('b'), user('c')], turns: [] }, { eventsFrom: 2 })
    expect(f.history.readSince('thread', cursor)).toMatchObject({ ok: true, live: 3, events: [{ seq: 2, event: { id: 'c' } }] })
    f.history.write({ thread, events: [user('a')], turns: [] })
    expect(f.history.readSince('thread', cursor)).toEqual({ ok: false, reset: 'epoch' })
  })

  it('reports an edited row, an unchanged cursor and a foreign epoch', () => {
    const f = fixture(), thread = f.snapshot.thread
    f.history.write({ thread, events: [user('a')], turns: [] })
    const cursor = f.history.readWindow('thread').sync!
    expect(f.history.readSince('thread', cursor)).toMatchObject({ ok: true, events: [] })
    f.history.write({ thread, events: [user('a', 'edited')], turns: [] }, { eventsFrom: 0 })
    expect(f.history.readSince('thread', cursor)).toMatchObject({ ok: true, events: [{ seq: 0, event: { text: 'edited' } }] })
    expect(f.history.readSince('thread', { epoch: 'other', revision: 0 })).toEqual({ ok: false, reset: 'epoch' })
  })
})

describe('Thread debug events', () => {
  function withTimeline() {
    const f = fixture()
    f.snapshot.events.push(
      { type: 'message', id: 'u1', role: 'user', text: 'Run the tests' },
      { type: 'tool', id: 't1', name: 'Bash', state: 'completed', detail: 'npm test', output: 'ok 12 passed', exitCode: 0, startedAt: 1000, completedAt: 1450 },
      { type: 'tool', id: 't2', name: 'Bash', state: 'failed', detail: 'npm run lint', output: 'error: unused variable', exitCode: 1, startedAt: 2000, completedAt: 2100 },
      { type: 'completed', status: 'completed' }
    )
    f.history.write(f.snapshot)
    return f
  }

  it('lists events with their envelopes, oldest first, with timing and exit codes', () => {
    const page = withTimeline().history.debugEvents('thread')
    expect(page.rows.map(row => row.type)).toEqual(expect.arrayContaining(['message', 'tool', 'completed']))
    expect(page.rows.map(row => row.seq)).toEqual([...page.rows.map(row => row.seq)].sort((a, b) => a - b))
    const tool = page.rows.find(row => row.label.startsWith('Bash npm test'))!
    expect(tool).toMatchObject({ type: 'tool', state: 'completed', durationMs: 450, exitCode: 0 })
    expect(tool.eventId).toBeTruthy()
    expect(JSON.parse(tool.payload)).toMatchObject({ output: 'ok 12 passed' })
    expect(page).toMatchObject({ hasMore: false, scanLimited: false })
  })

  it('filters by text across output, with exclusions', () => {
    const f = withTimeline()
    expect(f.history.debugEvents('thread', { filter: 'unused variable' }).rows.map(row => row.label)).toEqual(['Bash npm run lint'])
    expect(f.history.debugEvents('thread', { filter: 'tool, !lint' }).rows.map(row => row.label)).toEqual(['Bash npm test'])
    expect(f.history.debugEvents('thread', { filter: 'failed' }).rows).toHaveLength(1)
    expect(f.history.debugEvents('thread', { filter: 'nothing like this' }).rows).toEqual([])
  })

  it('pages older rows in with a sequence cursor', () => {
    const f = withTimeline()
    const newest = f.history.debugEvents('thread', { limit: 2 })
    expect(newest).toMatchObject({ hasMore: true })
    expect(newest.rows).toHaveLength(2)
    const older = f.history.debugEvents('thread', { before: newest.rows[0].seq, limit: 50 })
    expect(older.rows.every(row => row.seq < newest.rows[0].seq)).toBe(true)
    expect(older.rows.length + newest.rows.length).toBe(f.history.debugEvents('thread').rows.length)
  })

  it('clips a very large payload instead of sending it whole', () => {
    const f = fixture()
    f.snapshot.events.push({ type: 'tool', id: 'big', name: 'Bash', state: 'completed', detail: 'cat big.log', output: 'x'.repeat(60000) })
    f.history.write(f.snapshot)
    const row = f.history.debugEvents('thread').rows.find(item => item.label.startsWith('Bash cat'))!
    expect(row.payloadTruncated).toBe(true)
    expect(row.payload.length).toBeLessThanOrEqual(20000)
  })

  it('does not read another conversation', () => {
    const f = withTimeline()
    expect(f.history.debugEvents('someone-else').rows).toEqual([])
  })
})
