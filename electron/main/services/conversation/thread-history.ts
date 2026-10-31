import { createHash, randomUUID } from 'node:crypto'
import type { AppDatabase } from '../../db'
import type { ThreadDebugPage, ThreadDebugRow, ConversationThread, ThreadArtifact, ThreadDelivery, ThreadDelta, ThreadSyncCursor, ThreadRequest, ThreadEvent, ThreadTurn, ThreadSnapshot, ThreadHistoryPage, ThreadOperation, ThreadOperationKind, ThreadOperationState, ThreadPendingRequestSummary } from '../../../../shared/types/thread'
import { parseThreadPatch } from '../../../../shared/threadPatch'
import { compileDebugFilter, summarizeThreadEvent } from '../../../../shared/threadDebug'
import { canTransitionThreadOperation, createThreadEventEnvelope, deriveThreadDelivery } from './thread-event-envelope'
import { withParent, type ThreadParentColumns } from './thread-nesting'

const DELIVERY_LIMIT = 250
/** A client further behind than this rereads the window instead of paging deltas. */
const DELTA_LIMIT = 500
const PATCH_LIMIT = 512 * 1024
const ARTIFACT_LIMIT = 64 * 1024 * 1024
/** Events the debug inspector reads per request, and the size of each payload it returns. */
const DEBUG_SCAN_LIMIT = 20000
const DEBUG_PAYLOAD_LIMIT = 20000
const DEBUG_SEARCH_LIMIT = 100000

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
    const row = this.db.prepare('SELECT data_json, events_json, history_version, parent_thread_id, parent_via FROM conversation_threads WHERE id = ?').get(id) as { data_json: string; events_json: string; history_version: number } & ThreadParentColumns | undefined
    if (!row) throw Error('Thread not found')
    if (!row.history_version) this.write({ thread: JSON.parse(row.data_json), events: JSON.parse(row.events_json) })
    return { thread: withParent(JSON.parse(row.data_json), row),
      events: (this.db.prepare('SELECT data_json FROM conversation_events WHERE thread_id = ? ORDER BY seq').all(id) as { data_json: string }[]).map(value => JSON.parse(value.data_json)),
      turns: (this.db.prepare("SELECT data_json FROM conversation_turns WHERE thread_id = ? ORDER BY json_extract(data_json, '$.sequence')").all(id) as { data_json: string }[]).map(value => JSON.parse(value.data_json)) }
  }

  /**
   * The conversation's metadata without its events, for callers that only need the thread (its provider, root
   * path, configuration). Undefined for a pre-journal conversation, which read() migrates first.
   */
  readThread(id: string): ConversationThread | undefined {
    const row = this.db.prepare('SELECT data_json, history_version, parent_thread_id, parent_via FROM conversation_threads WHERE id = ?').get(id) as { data_json: string; history_version: number } & ThreadParentColumns | undefined
    if (!row) throw Error('Thread not found')
    return row.history_version ? withParent(JSON.parse(row.data_json) as ConversationThread, row) : undefined
  }

  /** Bounded projection for the renderer. Main-process operations keep using read(). */
  readWindow(id: string, limit = 250): ThreadSnapshot {
    const select = 'SELECT data_json, events_json, history_version, parent_thread_id, parent_via FROM conversation_threads WHERE id = ?'
    let row = this.db.prepare(select).get(id) as { data_json: string; events_json: string; history_version: number } & ThreadParentColumns | undefined
    if (!row) throw Error('Thread not found')
    if (!row.history_version) {
      this.write({ thread: JSON.parse(row.data_json), events: JSON.parse(row.events_json) })
      row = this.db.prepare(select).get(id) as typeof row
    }
    const page = this.page(id, undefined, limit)
    const thread = withParent(JSON.parse(row!.data_json) as ConversationThread, row!)
    const turns = this.turns(id)
    const live = (this.db.prepare('SELECT COUNT(*) AS count FROM conversation_events WHERE thread_id = ?').get(id) as { count: number }).count
    return {
      thread,
      events: page.events,
      deliveries: this.deliveries(id, thread, turns),
      pendingRequests: this.pendingRequests(id, thread),
      turns,
      sync: this.cursor(id),
      page: { ...(page.before !== undefined ? { before: page.before } : {}), hasMore: page.hasMore, total: page.total, live }
    }
  }

  /**
   * Everything that changed after `cursor`, or a reset when the cursor cannot be
   * trusted (history was truncated or re-based, or the client is far behind).
   * Only live events are incremental; imported native pages change the epoch.
   */
  readSince(id: string, cursor: ThreadSyncCursor): ThreadDelta {
    const row = this.db.prepare('SELECT data_json, history_version, epoch, revision, parent_thread_id, parent_via FROM conversation_threads WHERE id = ?').get(id) as { data_json: string; history_version: number; epoch: string | null; revision: number } & ThreadParentColumns | undefined
    if (!row) throw Error('Thread not found')
    if (!row.history_version || !row.epoch) return { ok: false, reset: 'unknown' }
    if (row.epoch !== cursor.epoch) return { ok: false, reset: 'epoch' }
    if (cursor.revision > row.revision) return { ok: false, reset: 'unknown' }
    const rows = this.db.prepare('SELECT seq, data_json FROM conversation_events WHERE thread_id = ? AND rev > ? ORDER BY seq LIMIT ?').all(id, cursor.revision, DELTA_LIMIT + 1) as { seq: number; data_json: string }[]
    if (rows.length > DELTA_LIMIT) return { ok: false, reset: 'limit' }
    const thread = withParent(JSON.parse(row.data_json) as ConversationThread, row)
    const turns = this.turns(id)
    const live = (this.db.prepare('SELECT COUNT(*) AS count FROM conversation_events WHERE thread_id = ?').get(id) as { count: number }).count
    return { ok: true, epoch: row.epoch, revision: row.revision, live, thread, turns,
      events: rows.map(value => ({ seq: value.seq, event: JSON.parse(value.data_json) as ThreadEvent })),
      deliveries: this.deliveries(id, thread, turns), pendingRequests: this.pendingRequests(id, thread) }
  }

  private cursor(id: string): ThreadSyncCursor | undefined {
    const row = this.db.prepare('SELECT epoch, revision FROM conversation_threads WHERE id = ?').get(id) as { epoch: string | null; revision: number } | undefined
    return row?.epoch ? { epoch: row.epoch, revision: row.revision } : undefined
  }

  private turns(id: string): ThreadTurn[] {
    return (this.db.prepare("SELECT data_json FROM conversation_turns WHERE thread_id = ? ORDER BY json_extract(data_json, '$.sequence')").all(id) as { data_json: string }[]).map(value => JSON.parse(value.data_json) as ThreadTurn)
  }

  /**
   * The same pending-request read as a conversation's window, across every conversation waiting for
   * approval. Returns titles only: the activity center points at a request, it never answers one.
   * CROSS JOIN keeps the waiting conversations as the outer loop, so only their events are read. An archived
   * conversation is never listed: nobody answers it. `projectId` narrows it to one project (the coordinator's read).
   */
  pendingRequestsAll(limit = 200, options: { projectId?: string } = {}): ThreadPendingRequestSummary[] {
    const rows = this.db.prepare(`SELECT e.thread_id, t.workspace_id, json_extract(t.data_json, '$.title') AS thread_title, e.data_json
      FROM conversation_threads t CROSS JOIN conversation_events e ON e.thread_id = t.id
      WHERE json_extract(t.data_json, '$.status') = 'approval' AND coalesce(json_extract(t.data_json, '$.archived'), 0) = 0
        AND (? IS NULL OR t.thread_project_id = ?)
        AND json_extract(e.data_json, '$.type') = 'request' AND json_extract(e.data_json, '$.request.state') = 'pending'
      ORDER BY e.thread_id, e.seq LIMIT ?`).all(options.projectId ?? null, options.projectId ?? null, limit) as { thread_id: string; workspace_id: string; thread_title: string | null; data_json: string }[]
    return rows.map(row => {
      const request = (JSON.parse(row.data_json) as Extract<ThreadEvent, { type: 'request' }>).request
      return { threadId: row.thread_id, workspaceId: row.workspace_id, threadTitle: row.thread_title ?? '', requestId: request.id, kind: request.kind, title: request.title, createdAt: request.createdAt, generation: request.generation }
    })
  }

  private pendingRequests(id: string, thread: ConversationThread): ThreadRequest[] {
    if (thread.status !== 'approval') return []
    return (this.db.prepare("SELECT data_json FROM conversation_events WHERE thread_id = ? AND json_extract(data_json, '$.type') = 'request' AND json_extract(data_json, '$.request.state') = 'pending' ORDER BY seq LIMIT 100").all(id) as { data_json: string }[])
      .map(value => (JSON.parse(value.data_json) as Extract<ThreadEvent, { type: 'request' }>).request)
  }

  /**
   * Delivery state keyed by user-message id. A user message's id is its turn id
   * (direct send) or the queued item's id (drained), and both carry the id of
   * the operation that delivered them. Bounded to the newest operations.
   */
  private deliveries(threadId: string, thread: ConversationThread, turns: ThreadTurn[]): Record<string, ThreadDelivery> {
    const byOperation = new Map<string, string>()
    for (const turn of turns.slice(-DELIVERY_LIMIT)) if (turn.operationId) byOperation.set(turn.operationId, turn.id)
    for (const item of thread.queue ?? []) if (item.operationId) byOperation.set(item.operationId, item.id)
    if (!byOperation.size) return {}
    const rows = this.db.prepare("SELECT id, state, error, updated_at FROM conversation_operations WHERE thread_id = ? AND kind IN ('turn', 'queue') ORDER BY created_at DESC LIMIT ?")
      .all(threadId, DELIVERY_LIMIT * 2) as { id: string; state: ThreadOperationState; error: string | null; updated_at: number }[]
    const result: Record<string, ThreadDelivery> = {}
    for (const row of rows) {
      const key = byOperation.get(row.id)
      if (key) result[key] = deriveThreadDelivery({ state: row.state, ...(row.error ? { error: row.error } : {}), updatedAt: row.updated_at })
    }
    return result
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

  /**
   * Events with their envelopes, filtered, newest matches read first and returned oldest first.
   * `before` is a sequence number: only earlier events are read, which is how older rows are paged in.
   */
  debugEvents(threadId: string, options: { filter?: string; before?: number; limit?: number } = {}): ThreadDebugPage {
    const limit = Math.min(Math.max(options.limit ?? 200, 1), 500)
    const keep = compileDebugFilter(options.filter ?? '')
    const rows = this.db.prepare(`SELECT e.seq, e.turn_id, e.data_json, v.event_id, v.operation_id, v.created_at
      FROM conversation_events e LEFT JOIN conversation_event_envelopes v ON v.thread_id = e.thread_id AND v.seq = e.seq
      WHERE e.thread_id = ? AND (? IS NULL OR e.seq < ?) ORDER BY e.seq DESC LIMIT ?`)
      .all(threadId, options.before ?? null, options.before ?? null, DEBUG_SCAN_LIMIT) as { seq: number; turn_id: string | null; data_json: string; event_id: string | null; operation_id: string | null; created_at: number | null }[]
    const picked: ThreadDebugRow[] = []
    let matched = 0
    for (const row of rows) {
      let event: ThreadEvent
      try { event = JSON.parse(row.data_json) as ThreadEvent } catch { continue }
      const summary = summarizeThreadEvent(event)
      const createdAt = row.created_at ?? 0
      const search = `${event.type}
${summary.label}
${summary.state ?? ''}
${summary.text}`.slice(0, DEBUG_SEARCH_LIMIT).toLowerCase()
      if (!keep({ createdAt, search })) continue
      matched += 1
      if (picked.length >= limit) continue
      const json = JSON.stringify(event, null, 2)
      picked.push({
        seq: row.seq, createdAt, type: event.type, label: summary.label,
        ...(row.event_id ? { eventId: row.event_id } : {}), ...(row.operation_id ? { operationId: row.operation_id } : {}), ...(row.turn_id ? { turnId: row.turn_id } : {}),
        ...(summary.state ? { state: summary.state } : {}), ...(summary.durationMs !== undefined ? { durationMs: summary.durationMs } : {}), ...(summary.exitCode !== undefined ? { exitCode: summary.exitCode } : {}),
        payload: json.length > DEBUG_PAYLOAD_LIMIT ? json.slice(0, DEBUG_PAYLOAD_LIMIT) : json,
        ...(json.length > DEBUG_PAYLOAD_LIMIT ? { payloadTruncated: true } : {})
      })
    }
    return { rows: picked.reverse(), matched, hasMore: matched > picked.length, scanLimited: rows.length >= DEBUG_SCAN_LIMIT }
  }

  page(threadId: string, before?: number, limit = 200): ThreadHistoryPage {
    if (!Number.isInteger(limit) || limit < 1 || limit > 500) throw Error('Invalid history page size')
    const exists = this.db.prepare('SELECT data_json FROM conversation_threads WHERE id = ?').get(threadId) as { data_json: string } | undefined
    if (!exists) throw Error('Thread not found')
    const liveCount = (this.db.prepare('SELECT COUNT(*) AS count FROM conversation_events WHERE thread_id = ?').get(threadId) as { count: number }).count
    const native = this.db.prepare('SELECT COUNT(*) AS count, MIN(seq) AS first FROM conversation_native_history WHERE thread_id = ?').get(threadId) as { count: number; first: number | null }
    const total = liveCount + native.count
    const upper = before === undefined ? liveCount : before
    if (!Number.isInteger(upper) || upper < (native.first ?? 0) || upper > liveCount) throw Error('Invalid history cursor')
    const rows = this.db.prepare('SELECT seq, data_json FROM (SELECT seq, data_json FROM conversation_events WHERE thread_id = ? UNION ALL SELECT seq, data_json FROM conversation_native_history WHERE thread_id = ?) WHERE seq < ? ORDER BY seq DESC LIMIT ?').all(threadId, threadId, upper, limit) as { seq: number; data_json: string }[]
    rows.reverse()
    const next = rows[0]?.seq ?? upper
    const hasMore = next > (native.first ?? 0) || Boolean((JSON.parse(exists.data_json) as ConversationThread).nativeHistoryCursor)
    return { events: rows.map(row => JSON.parse(row.data_json)), ...(hasMore ? { before: next } : {}), hasMore, total }
  }

  hasImportedBefore(threadId: string, before: number): boolean {
    return Boolean(this.db.prepare('SELECT 1 FROM conversation_native_history WHERE thread_id = ? AND seq < ? LIMIT 1').get(threadId, before))
  }

  /** Explicit export projection; never feed this back into the live event journal. */
  readImported(id: string): ThreadSnapshot {
    const snapshot = this.read(id)
    const earlier = (this.db.prepare('SELECT data_json FROM conversation_native_history WHERE thread_id = ? ORDER BY seq').all(id) as { data_json: string }[]).map(row => JSON.parse(row.data_json) as ThreadEvent)
    return { ...snapshot, events: [...earlier, ...snapshot.events] }
  }

  clearNativePages(id: string): void {
    this.db.prepare('DELETE FROM conversation_native_history WHERE thread_id = ?').run(id)
    this.resetEpoch(id)
  }

  /** Invalidates every client cursor; used when history is re-based rather than appended to. */
  private resetEpoch(id: string): void {
    this.db.prepare('UPDATE conversation_threads SET epoch = ? WHERE id = ?').run(randomUUID(), id)
  }

  prependNative(threadId: string, events: ThreadEvent[]): void {
    this.db.transaction(() => {
      const first = (this.db.prepare('SELECT MIN(seq) AS value FROM conversation_native_history WHERE thread_id = ?').get(threadId) as { value: number | null }).value ?? 0
      const insert = this.db.prepare('INSERT OR IGNORE INTO conversation_native_history (thread_id, seq, event_id, data_json) VALUES (?, ?, ?, ?)')
      events.forEach((event, index) => {
        if (event.type === 'message') insert.run(threadId, first - events.length + index, event.id, JSON.stringify(event))
      })
      this.resetEpoch(threadId)
    })()
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

  /** Explicit evidence reconciliation, separate from monotonic live callbacks. */
  reconcileOperation(threadId: string, operationId: string, nativeTurnId: string, state: 'completed' | 'failed', confirmedLive = false): void {
    this.db.prepare(`UPDATE conversation_operations SET state = ?, error = NULL, updated_at = ?
      WHERE thread_id = ? AND id = ? AND (state IN ('unknown', 'failed', 'cancelled') OR (? = 1 AND state IN ('acknowledged', 'running')))
      AND EXISTS (SELECT 1 FROM conversation_turns t WHERE t.thread_id = conversation_operations.thread_id
        AND json_extract(t.data_json, '$.operationId') = conversation_operations.id
        AND json_extract(t.data_json, '$.nativeId') = ?)`).run(state, Date.now(), threadId, operationId, confirmedLive ? 1 : 0, nativeTurnId)
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
      const stamp = this.db.prepare('SELECT epoch, revision FROM conversation_threads WHERE id = ?').get(snapshot.thread.id) as { epoch: string | null; revision: number } | undefined
      const revision = (stamp?.revision ?? 0) + 1
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
        if (previous.get(seq) !== data) this.db.prepare('INSERT INTO conversation_events (thread_id, seq, turn_id, data_json, rev) VALUES (?, ?, ?, ?, ?) ON CONFLICT(thread_id, seq) DO UPDATE SET turn_id = excluded.turn_id, data_json = excluded.data_json, rev = excluded.rev').run(snapshot.thread.id, seq, turnId, data, revision)
        const existing = envelopes.get(seq)
        const envelope = createThreadEventEnvelope({ payload: event, threadId: snapshot.thread.id, sequence: seq, generation: snapshot.thread.generation ?? 1, eventId: existing?.event_id, operationId: options.operationId ?? existing?.operation_id ?? undefined, turnId: turnId ?? undefined, createdAt: existing?.created_at })
        this.db.prepare(`INSERT INTO conversation_event_envelopes (thread_id, seq, event_id, operation_id, turn_id, generation, schema_version, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(thread_id, seq) DO UPDATE SET event_id = excluded.event_id, operation_id = excluded.operation_id, turn_id = excluded.turn_id, generation = excluded.generation, schema_version = excluded.schema_version, updated_at = excluded.updated_at`)
          .run(snapshot.thread.id, seq, envelope.eventId, envelope.operationId ?? null, envelope.turnId ?? null, envelope.generation, envelope.schemaVersion, envelope.createdAt, envelope.updatedAt)
      })
      // Removing events (rewind, recovery) cannot be expressed as a delta.
      const truncated = this.db.prepare('DELETE FROM conversation_events WHERE thread_id = ? AND seq >= ?').run(snapshot.thread.id, snapshot.events.length).changes > 0
      const epoch = truncated || !stamp?.epoch ? randomUUID() : stamp.epoch
      const turns = snapshot.turns ?? []
      const turnsFrom = Math.max(0, Math.min(options.turnsFrom ?? (options.eventsFrom === undefined ? 0 : Math.max(0, turns.length - 1)), turns.length))
      for (const turn of turns.slice(turnsFrom)) this.db.prepare('INSERT INTO conversation_turns (thread_id, id, data_json) VALUES (?, ?, ?) ON CONFLICT(thread_id, id) DO UPDATE SET data_json = excluded.data_json').run(snapshot.thread.id, turn.id, JSON.stringify(turn))
      // Full rewrites (rewind/import/recovery) may remove turns. Tail writes only
      // append/update and must not scan the complete event table.
      if (eventsFrom === 0 && turnsFrom === 0) this.db.prepare('DELETE FROM conversation_turns WHERE thread_id = ? AND id NOT IN (SELECT turn_id FROM conversation_events WHERE thread_id = ? AND turn_id IS NOT NULL)').run(snapshot.thread.id, snapshot.thread.id)
      this.db.prepare("UPDATE conversation_threads SET data_json = ?, events_json = '[]', history_version = 1, epoch = ?, revision = ? WHERE id = ?").run(JSON.stringify(snapshot.thread), epoch, revision, snapshot.thread.id)
    })()
  }

  private operationFromRow(row: { id: string; thread_id: string; turn_id: string | null; generation: number; kind: ThreadOperationKind; state: ThreadOperationState; error: string | null; created_at: number; updated_at: number }): ThreadOperation {
    return { id: row.id, threadId: row.thread_id, ...(row.turn_id ? { turnId: row.turn_id } : {}), generation: row.generation, kind: row.kind, state: row.state, createdAt: row.created_at, updatedAt: row.updated_at, ...(row.error ? { error: row.error } : {}) }
  }
}
