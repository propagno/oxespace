import { afterAll, beforeAll, bench, describe } from 'vitest'
import { openInMemoryDatabase, type AppDatabase } from '../../electron/main/db'
import { ThreadHistory } from '../../electron/main/services/conversation/thread-history'
import type { ThreadSnapshot } from '../../shared/types/thread'

let db: AppDatabase
let history: ThreadHistory
const snapshots = new Map<number, ThreadSnapshot>()

beforeAll(() => {
  db = openInMemoryDatabase()
  db.prepare("INSERT INTO workspaces (id, name, root_path, layout, default_shell_profile_id) VALUES ('ws', 'Bench', '/repo', '1x1', 'builtin-codex')").run()
  db.prepare("INSERT INTO thread_projects (id, identity, root_path, display_name, created_at, updated_at) VALUES ('project', '/repo', '/repo', 'Bench', 1, 1)").run()
  history = new ThreadHistory(db)
  for (const size of [1_000, 100_000]) {
    const snapshot: ThreadSnapshot = {
      thread: { id: `thread-${size}`, workspaceId: 'ws', projectId: 'project', rootPath: '/repo', provider: 'codex', nativeSessionId: null, title: 'Bench', pinned: false, status: 'idle', createdAt: 1, updatedAt: 1, generation: 1 },
      events: Array.from({ length: size }, (_, index) => ({ type: 'message' as const, id: `m${index}`, role: index % 2 ? 'assistant' as const : 'user' as const, text: `Message ${index}` }))
    }
    snapshots.set(size, snapshot)
    db.prepare('INSERT INTO conversation_threads (id, workspace_id, thread_project_id, data_json, events_json) VALUES (?, ?, ?, ?, ?)').run(snapshot.thread.id, 'ws', 'project', JSON.stringify(snapshot.thread), '[]')
    history.write(snapshot)
  }
}, 120_000)

afterAll(() => db.close())

function appendTail(size: number): void {
  const snapshot = snapshots.get(size)!
  const from = snapshot.events.length
  snapshot.events.push({ type: 'message', id: `tail-${Date.now()}-${Math.random()}`, role: 'assistant', text: 'delta' })
  history.write(snapshot, { eventsFrom: from })
  snapshot.events.pop()
  history.write(snapshot, { eventsFrom: from })
}

describe('incremental Thread history', () => {
  bench('append tail with 1k persisted events', () => appendTail(1_000), { iterations: 20, time: 2_000 })
  bench('append tail with 100k persisted events', () => appendTail(100_000), { iterations: 20, time: 2_000 })
})
