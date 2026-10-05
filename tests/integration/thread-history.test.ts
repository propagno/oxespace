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
    expect(initial.page).toEqual({ before: 800, hasMore: true, total: 1000 })
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
})
