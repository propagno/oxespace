// Seeds a migrated OXESpace database with a realistic long-Thread history, for e2e/memory-footprint.spec.ts.
//
//   ELECTRON_RUN_AS_NODE=1 electron scripts/memory-footprint-seed.mjs <db> <workspaceId> <rootPath> [threads] [events] [checkpointFiles]
//
// It must run on Electron's Node (the better-sqlite3 binary is built for Electron's ABI) and writes the same
// rows the app's ThreadHistory / ThreadCheckpointService write: indexed events with a revision, turns,
// thread metadata, and checkpoint file images. Content is deterministic so runs are comparable.
import Database from 'better-sqlite3'

const [dbPath, workspaceId, rootPath, threadsArg = '2', eventsArg = '6000', filesArg = '600'] = process.argv.slice(2)
if (!dbPath || !workspaceId || !rootPath) throw new Error('usage: <db> <workspaceId> <rootPath> [threads] [events] [checkpointFiles]')
const THREADS = Number(threadsArg), EVENTS = Number(eventsArg), CHECKPOINT_FILES = Number(filesArg)

let state = 0x2f6e2b1
const random = () => { state = (state * 1664525 + 1013904223) >>> 0; return state / 0x100000000 }
const WORDS = ['function', 'const', 'return', 'import', 'export', 'thread', 'event', 'await', 'promise', 'render', 'state', 'async', 'handler', 'config', 'memory', 'buffer', 'stream', 'window', 'process', 'error']
const text = (bytes) => { let out = ''; while (out.length < bytes) out += WORDS[Math.floor(random() * WORDS.length)] + (random() < 0.15 ? '\n' : ' '); return out.slice(0, bytes) }
/** Sizes follow the user's data: most events 1-8 KB, a few tool outputs of 20+ KB. */
const size = () => random() < 0.04 ? 20_000 + Math.floor(random() * 30_000) : 1_000 + Math.floor(random() * 7_000)

const db = new Database(dbPath)
db.pragma('journal_mode = WAL')
db.pragma('foreign_keys = ON')
const now = Date.now()
const projectId = 'memory-footprint-project'
db.prepare('INSERT OR IGNORE INTO thread_projects (id, identity, root_path, display_name, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)').run(projectId, rootPath, rootPath, 'repo', now, now)
db.prepare('INSERT OR IGNORE INTO thread_project_contexts (project_id, root_path) VALUES (?, ?)').run(projectId, rootPath)

const insertThread = db.prepare('INSERT INTO conversation_threads (id, workspace_id, thread_project_id, data_json, events_json, history_version, epoch, revision) VALUES (?, ?, ?, ?, ?, 1, ?, 1)')
const insertEvent = db.prepare('INSERT INTO conversation_events (thread_id, seq, turn_id, data_json, rev) VALUES (?, ?, ?, ?, 1)')
const insertTurn = db.prepare('INSERT INTO conversation_turns (thread_id, id, data_json) VALUES (?, ?, ?)')
const insertCheckpoint = db.prepare("INSERT INTO conversation_checkpoints (id, thread_id, turn_id, root_path, base_commit, label, state, before_paths_json, created_at, finalized_at) VALUES (?, ?, ?, ?, NULL, 'Before turn', 'ready', '[]', ?, ?)")
const insertFile = db.prepare('INSERT INTO conversation_checkpoint_files (checkpoint_id, path, pre_exists, pre_content, pre_hash, post_exists, post_hash, bytes) VALUES (?, ?, 1, ?, ?, 1, ?, ?)')

for (let t = 0; t < THREADS; t++) {
  const id = `memory-footprint-thread-${t}`
  const thread = { id, workspaceId, projectId, rootPath, provider: 'claude', nativeSessionId: null, title: `Long conversation ${t + 1}`, pinned: false, status: 'idle', lastTurnStatus: 'completed',
    createdAt: now - 86_400_000 * (t + 1), updatedAt: now - 3_600_000 * (t + 1), generation: 1, queue: [], connection: { state: 'closed', attempt: 0, changedAt: now } }
  db.transaction(() => {
    insertThread.run(id, workspaceId, projectId, JSON.stringify(thread), '[]', `epoch-${t}`)
    let turnId = null, turn = 0
    for (let seq = 0; seq < EVENTS; seq++) {
      const slot = seq % 5
      let event
      if (slot === 0) {
        turnId = `${id}-turn-${turn++}`
        event = { type: 'message', id: turnId, role: 'user', text: text(300 + Math.floor(random() * 1500)) }
        insertTurn.run(id, turnId, JSON.stringify({ id: turnId, sequence: turn, status: 'completed', startedAt: now - 1000 * (EVENTS - seq), completedAt: now - 1000 * (EVENTS - seq) + 500, configuration: {} }))
      } else if (slot === 4) event = { type: 'completed', status: 'completed' }
      else if (slot === 1 || slot === 2) event = { type: 'tool', id: `${id}-tool-${seq}`, name: 'commandExecution', state: 'completed', detail: text(120), output: text(size()), exitCode: 0, startedAt: now - 1000 * (EVENTS - seq), completedAt: now - 1000 * (EVENTS - seq) + 400 }
      else event = { type: 'message', id: `${id}-answer-${seq}`, role: 'assistant', text: text(size()) }
      insertEvent.run(id, seq, turnId, JSON.stringify(event))
    }
    const checkpoints = CHECKPOINT_FILES ? Math.max(1, Math.round(CHECKPOINT_FILES / THREADS / 10)) : 0
    const perThread = Math.round(CHECKPOINT_FILES / THREADS)
    for (let c = 0; c < checkpoints; c++) {
      const checkpointId = `${id}-checkpoint-${c}`
      insertCheckpoint.run(checkpointId, id, `${id}-turn-${c}`, rootPath, now - 60_000 * c, now - 60_000 * c + 100)
      for (let f = 0; f < Math.ceil(perThread / checkpoints); f++) {
        const content = Buffer.from(text(20_000 + Math.floor(random() * 120_000)))
        insertFile.run(checkpointId, `src/file-${t}-${c}-${f}.ts`, content, `hash-${t}-${c}-${f}`, `post-${t}-${c}-${f}`, content.byteLength)
      }
    }
  })()
}
db.pragma('wal_checkpoint(TRUNCATE)')
db.close()
console.log(`seeded ${THREADS} threads x ${EVENTS} events, ~${CHECKPOINT_FILES} checkpoint files`)
