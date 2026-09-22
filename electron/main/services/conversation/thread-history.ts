import { createHash, randomUUID } from 'node:crypto'
import type { AppDatabase } from '../../db'
import type { ConversationThread, ThreadArtifact, ThreadEvent, ThreadSnapshot, ThreadHistoryPage, ThreadOperation, ThreadOperationKind, ThreadOperationState } from '../../../../shared/types/thread'
import { parseThreadPatch } from '../../../../shared/threadPatch'
import { canTransitionThreadOperation, createThreadEventEnvelope } from './thread-event-envelope'

const PATCH_LIMIT = 512 * 1024
const ARTIFACT_LIMIT = 64 * 1024 * 1024

export interface ThreadHistoryWriteOptions {
  /** First event that may have changed. Earlier rows remain untouched. */
  eventsFrom?: number
  /** First turn that may have changed. Defaults to the current tail. */
  turnsFrom?: number
  operationId?: string
}

export interface ThreadOperationInput {
  id?: string
  threadId: string
  turnId?: string
  generation: number
  kind: ThreadOperationKind
  state?: ThreadOperationState
  createdAt?: number
}

/** Indexed events and separately fetched immutable evidence. Legacy JSON stays readable. */
export class ThreadHistory {
  constructor(private readonly db: AppDatabase) {}

  read(id: string): ThreadSnapshot {
    const row = this.db.prepare('SELECT data_json, events_json, history_version FROM conversation_threads WHERE id = ?').get(id) as { data_json: string; events_json: string; history_version: number } | undefined
    if (!row) throw Error('Thread not found')
    if (!row.history_version) this.write({ thread: JSON.parse(row.data_json), events: JSON.parse(row.events_json) })
    return { thread: JSON.parse(row.data_json),
      events: (this.db.prepare('SELECT data_json FROM conversation_events WHERE thread_id = ? ORDER BY seq').all(id) as { data_json: string }[]).map(value => JSON.parse(value.data_json)),
      turns: (this.db.prepare("SELECT data_json FROM conversation_turns WHERE thread_id = ? ORDER BY json_extract(data_json, '$.sequence')").all(id) as { data_json: string }[]).map(value => JSON.parse(value.data_json)) }
  }

  /** Bounded projection for the renderer. Main-process operations keep using read(). */
  readWindow(id: string, limit = 250): ThreadSnapshot {
    let row = this.db.prepare('SELECT data_json, events_json, history_version FROM conversation_threads WHERE id = ?').get(id) as { data_json: string; events_json: string; history_version: number } | undefined
    if (!row) throw Error('Thread not found')
    if (!row.history_version) {
      this.write({ thread: JSON.parse(row.data_json), events: JSON.parse(row.events_json) })
      row = this.db.prepare('SELECT data_json, events_json, history_version FROM conversation_threads WHERE id = ?').get(id) as typeof row
    }
    const page = this.page(id, undefined, limit)
    return {
      thread: JSON.parse(row!.data_json),
      events: page.events,
      turns: (this.db.prepare("SELECT data_json FROM conversation_turns WHERE thread_id = ? ORDER BY json_extract(data_json, '$.sequence')").all(id) as { data_json: string }[]).map(value => JSON.parse(value.data_json)),
      page: { ...(page.before !== undefined ? { before: page.before } : {}), hasMore: page.hasMore, total: page.total }
    }
  }

  artifact(threadId: string, id: string): ThreadArtifact {
    const row = this.db.prepare('SELECT id, content, hash, bytes, truncated, source FROM conversation_artifacts WHERE thread_id = ? AND id = ?').get(threadId, id) as (Omit<ThreadArtifact, 'truncated'> & { truncated: number }) | undefined
    if (!row) throw Error('File evidence is not available in this conversation')
    return { ...row, truncated: Boolean(row.truncated) }
  }

  artifacts(threadId: string): ThreadArtifact[] {
    return (this.db.prepare('SELECT id, content, hash, bytes, truncated, source FROM conversation_artifacts WHERE thread_id = ? ORDER BY id').all(threadId) as Array<Omit<ThreadArtifact, 'truncated'> & { truncated: number }>)
      .map(row => ({ ...row, truncated: Boolean(row.truncated) }))
  }

  importArtifacts(threadId: string, artifacts: ThreadArtifact[]): void {
    this.db.transaction(() => {
      for (const artifact of artifacts) this.db.prepare('INSERT INTO conversation_artifacts (thread_id, id, content, hash, bytes, truncated, source) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run(threadId, artifact.id, artifact.content, artifact.hash, artifact.bytes, Number(artifact.truncated), artifact.source)
    })()
  }

  page(threadId: string, before?: number, limit = 200): ThreadHistoryPage {
    if (!Number.isInteger(limit) || limit < 1 || limit > 500) throw Error('Invalid history page size')
    const exists = this.db.prepare('SELECT 1 FROM conversation_threads WHERE id = ?').get(threadId)
    if (!exists) throw Error('Thread not found')
    const total = (this.db.prepare('SELECT COUNT(*) AS count FROM conversation_events WHERE thread_id = ?').get(threadId) as { count: number }).count
    const upper = before === undefined ? total : before
    if (!Number.isInteger(upper) || upper < 0 || upper > total) throw Error('Invalid history cursor')
    const rows = this.db.prepare('SELECT seq, data_json FROM conversation_events WHERE thread_id = ? AND seq < ? ORDER BY seq DESC LIMIT ?').all(threadId, upper, limit) as { seq: number; data_json: string }[]
    rows.reverse()
    const next = rows[0]?.seq
    return { events: rows.map(row => JSON.parse(row.data_json)), ...(next !== undefined && next > 0 ? { before: next } : {}), hasMore: next !== undefined && next > 0, total }
  }

  beginOperation(input: ThreadOperationInput): ThreadOperation {
    const now = input.createdAt ?? Date.now()
    const operation: ThreadOperation = { id: input.id ?? randomUUID(), threadId: input.threadId, ...(input.turnId ? { turnId: input.turnId } : {}), generation: input.generation, kind: input.kind, state: input.state ?? 'created', createdAt: now, updatedAt: now }
    this.db.prepare('INSERT INTO conversation_operations (id, thread_id, turn_id, generation, kind, state, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(operation.id, operation.threadId, operation.turnId ?? null, operation.generation, operation.kind, operation.state, operation.createdAt, operation.updatedAt)
    return operation
  }

  transitionOperation(threadId: string, operationId: string, state: ThreadOperationState, error?: string): ThreadOperation | undefined {
    const row = this.db.prepare('SELECT * FROM conversation_operations WHERE thread_id = ? AND id = ?').get(threadId, operationId) as {
      id: string; thread_id: string; turn_id: string | null; generation: number; kind: ThreadOperationKind; state: ThreadOperationState; error: string | null; created_at: number; updated_at: number
    } | undefined
    if (!row || !canTransitionThreadOperation(row.state, state)) return row ? this.operationFromRow(row) : undefined
    const updatedAt = Date.now()
    this.db.prepare('UPDATE conversation_operations SET state = ?, error = ?, updated_at = ? WHERE thread_id = ? AND id = ?')
      .run(state, error ?? null, updatedAt, threadId, operationId)
    return { id: row.id, threadId: row.thread_id, ...(row.turn_id ? { turnId: row.turn_id } : {}), generation: row.generation, kind: row.kind, state, createdAt: row.created_at, updatedAt, ...(error ? { error } : {}) }
  }

  operations(threadId: string): ThreadOperation[] {
    return (this.db.prepare('SELECT * FROM conversation_operations WHERE thread_id = ? ORDER BY created_at, id').all(threadId) as Array<{
      id: string; thread_id: string; turn_id: string | null; generation: number; kind: ThreadOperationKind; state: ThreadOperationState; error: string | null; created_at: number; updated_at: number
    }>).map(row => this.operationFromRow(row))
  }

  settleOpenOperations(threadId: string, state: Extract<ThreadOperationState, 'cancelled' | 'unknown'>, error: string): number {
    const now = Date.now()
    const result = this.db.prepare("UPDATE conversation_operations SET state = ?, error = ?, updated_at = ? WHERE thread_id = ? AND state NOT IN ('completed', 'failed', 'cancelled', 'unknown')")
      .run(state, error, now, threadId)
    return result.changes
  }

  updateThreadMetadata(thread: ConversationThread): void {
    const result = this.db.prepare("UPDATE conversation_threads SET data_json = ?, events_json = '[]', history_version = 1 WHERE id = ?")
      .run(JSON.stringify(thread), thread.id)
    if (!result.changes) throw Error('Thread not found')
  }

  persistFrom(snapshot: ThreadSnapshot, eventsFrom: number, operationId?: string): void {
    this.write(snapshot, { eventsFrom, ...(operationId ? { operationId } : {}) })
  }

  rewriteHistory(snapshot: ThreadSnapshot): void {
    this.write(snapshot, { eventsFrom: 0 })
  }

  write(snapshot: ThreadSnapshot, options: ThreadHistoryWriteOptions = {}): void {
    if (snapshot.page?.hasMore || snapshot.page?.before !== undefined || snapshot.page && snapshot.events.length !== snapshot.page.total) {
      throw Error('Cannot persist a paginated Thread projection as complete history')
    }
    this.db.transaction(() => {
      const eventsFrom = Math.max(0, Math.min(options.eventsFrom ?? 0, snapshot.events.length))
      let bytes = (this.db.prepare('SELECT COALESCE(SUM(bytes), 0) AS bytes FROM conversation_artifacts WHERE thread_id = ?').get(snapshot.thread.id) as { bytes: number }).bytes
      const previous = new Map((this.db.prepare('SELECT seq, data_json FROM conversation_events WHERE thread_id = ? AND seq >= ?').all(snapshot.thread.id, eventsFrom) as { seq: number; data_json: string }[]).map(row => [row.seq, row.data_json]))
      const envelopes = new Map((this.db.prepare('SELECT seq, event_id, operation_id, created_at FROM conversation_event_envelopes WHERE thread_id = ? AND seq >= ?').all(snapshot.thread.id, eventsFrom) as { seq: number; event_id: string; operation_id: string | null; created_at: number }[]).map(row => [row.seq, row]))
      let turnId = eventsFrom > 0
        ? ((this.db.prepare('SELECT turn_id FROM conversation_events WHERE thread_id = ? AND seq < ? ORDER BY seq DESC LIMIT 1').get(snapshot.thread.id, eventsFrom) as { turn_id: string | null } | undefined)?.turn_id ?? null)
        : null
      snapshot.events.slice(eventsFrom).forEach((event, offset) => {
        const seq = eventsFrom + offset
        if (event.type === 'message' && event.role === 'user') turnId = event.id
        if ((event.type === 'tool' || event.type === 'turn-diff') && event.files) event.files = event.files.slice(0, 100).map(file => {
          const { patch, ...metadata } = file
          if (patch === undefined) return metadata
          const input = Buffer.from(patch), truncated = input.length > PATCH_LIMIT || Boolean(file.truncated)
          const content = input.subarray(0, PATCH_LIMIT).toString('utf8')
          const hash = createHash('sha256').update(content).digest('hex'), id = `${metadata.source}:${hash}${truncated ? ':partial' : ''}`
          const exists = this.db.prepare('SELECT 1 FROM conversation_artifacts WHERE thread_id = ? AND id = ?').get(snapshot.thread.id, id)
          if (!exists && bytes + Buffer.byteLength(content) > ARTIFACT_LIMIT) return { ...metadata, truncated: true }
          if (!exists) {
            this.db.prepare('INSERT INTO conversation_artifacts (thread_id, id, content, hash, bytes, truncated, source) VALUES (?, ?, ?, ?, ?, ?, ?)').run(snapshot.thread.id, id, content, hash, Buffer.byteLength(content), Number(truncated), metadata.source)
            bytes += Buffer.byteLength(content)
          }
          const parsed = parseThreadPatch(content)
          return { ...metadata, artifactId: id, truncated, ...(metadata.source !== 'tool-input' && parsed.hunks.length && !truncated ? { additions: parsed.additions, deletions: parsed.deletions } : {}) }
        })
        const data = JSON.stringify(event)
        if (previous.get(seq) !== data) this.db.prepare('INSERT INTO conversation_events (thread_id, seq, turn_id, data_json) VALUES (?, ?, ?, ?) ON CONFLICT(thread_id, seq) DO UPDATE SET turn_id = excluded.turn_id, data_json = excluded.data_json').run(snapshot.thread.id, seq, turnId, data)
        const existing = envelopes.get(seq)
        const envelope = createThreadEventEnvelope({ payload: event, threadId: snapshot.thread.id, sequence: seq, generation: snapshot.thread.generation ?? 1, eventId: existing?.event_id, operationId: options.operationId ?? existing?.operation_id ?? undefined, turnId: turnId ?? undefined, createdAt: existing?.created_at })
        this.db.prepare(`INSERT INTO conversation_event_envelopes (thread_id, seq, event_id, operation_id, turn_id, generation, schema_version, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(thread_id, seq) DO UPDATE SET event_id = excluded.event_id, operation_id = excluded.operation_id, turn_id = excluded.turn_id, generation = excluded.generation, schema_version = excluded.schema_version, updated_at = excluded.updated_at`)
          .run(snapshot.thread.id, seq, envelope.eventId, envelope.operationId ?? null, envelope.turnId ?? null, envelope.generation, envelope.schemaVersion, envelope.createdAt, envelope.updatedAt)
      })
      this.db.prepare('DELETE FROM conversation_events WHERE thread_id = ? AND seq >= ?').run(snapshot.thread.id, snapshot.events.length)
      const turns = snapshot.turns ?? []
      const turnsFrom = Math.max(0, Math.min(options.turnsFrom ?? (options.eventsFrom === undefined ? 0 : Math.max(0, turns.length - 1)), turns.length))
      for (const turn of turns.slice(turnsFrom)) this.db.prepare('INSERT INTO conversation_turns (thread_id, id, data_json) VALUES (?, ?, ?) ON CONFLICT(thread_id, id) DO UPDATE SET data_json = excluded.data_json').run(snapshot.thread.id, turn.id, JSON.stringify(turn))
      // Full rewrites (rewind/import/recovery) may remove turns. Tail writes only
      // append/update and must not scan the complete event table.
      if (eventsFrom === 0 && turnsFrom === 0) this.db.prepare('DELETE FROM conversation_turns WHERE thread_id = ? AND id NOT IN (SELECT turn_id FROM conversation_events WHERE thread_id = ? AND turn_id IS NOT NULL)').run(snapshot.thread.id, snapshot.thread.id)
      this.db.prepare("UPDATE conversation_threads SET data_json = ?, events_json = '[]', history_version = 1 WHERE id = ?").run(JSON.stringify(snapshot.thread), snapshot.thread.id)
    })()
  }

  private operationFromRow(row: { id: string; thread_id: string; turn_id: string | null; generation: number; kind: ThreadOperationKind; state: ThreadOperationState; error: string | null; created_at: number; updated_at: number }): ThreadOperation {
    return { id: row.id, threadId: row.thread_id, ...(row.turn_id ? { turnId: row.turn_id } : {}), generation: row.generation, kind: row.kind, state: row.state, createdAt: row.created_at, updatedAt: row.updated_at, ...(row.error ? { error: row.error } : {}) }
  }
}
