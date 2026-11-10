import { createHash } from 'node:crypto'
import {
  REMOTE_AGENT_SOURCES, REMOTE_PROTOCOL_VERSION, REMOTE_TEXT_LIMITS,
  type RemoteAgentKey, type RemoteAgentKind, type RemoteAgentRow, type RemoteAgentSource, type RemoteAgentsEvent, type RemoteAgentsSnapshot,
  type RemoteSubscription, type RemoteTerminalData, type RemoteTerminalSnapshot, type RemoteThreadHeader, type RemoteThreadItem, type RemoteThreadSnapshot
} from '../../../../shared/remote/protocol'
import type { ConversationThread, ThreadEvent, ThreadSyncCursor } from '../../../../shared/types/thread'
import type { RemoteTopicFrame, RemoteTopicSource } from './connection'
import type { RemoteDesktop } from './desktop'
import { toDelegation, toJob, toPendingRequest, toRemoteAgent, toThreadHeader, toThreadItem, toThreadSummary, toWorkspace } from './filters'
import { fitItem, FRAME_BUDGET, pageList, splitText } from './frames'
import { clean, TerminalWindow } from './text'
import { buildTerminalSnapshot } from './terminal-snapshot'

/**
 * The M4 topics. Each subscription sends a snapshot first (in pages when it is over a frame), then events, and every
 * snapshot and last event frame carries an opaque cursor. Subscribing again with that cursor resumes exactly there:
 * nothing lost and nothing repeated. A cursor the gateway no longer knows gets a fresh snapshot.
 *
 * - Lists (`workspaces`, `threads`, `pendingRequests`, `jobs`, `delegations`): the cursor names a state the gateway
 *   remembers (a hash of what the phone was sent). `threads` events carry what changed; the others the whole list.
 * - `thread`: the conversation's own sync cursor (`epoch:revision`), resumed with `readSince`.
 * - `terminal`: the pane's ring sequence, bound to its process, read-only.
 *
 * Unsubscribing or disconnecting closes the handle, which stops every listener and timer it started.
 */

/** The ThreadEvent envelope's schema version (C2). */
const THREAD_SCHEMA_VERSION = 2
const REMEMBERED_STATES = 32
const CURSOR = /^[A-Za-z0-9._:-]{1,200}$/
/** No pane hidden from the phone. */
const NONE: ReadonlySet<string> = new Set<string>()

export interface TopicOptions {
  desktop: RemoteDesktop
  phoneWrite(): ReadonlySet<string>
  /** CR-34: panes kept off the phone entirely: never in the workspaces or agents topics. None when absent. */
  phoneHidden?(): ReadonlySet<string>
  /** BE-A46-c5: whether a pane's agent has a conversation the phone can read (the workspaces flag). */
  paneConversation?: (paneId: string) => boolean
  /** Called when something only the gateway knows changes the workspaces list (a pane's phone write). */
  onWorkspacesChanged(listener: () => void): () => void
  /** How often lists the desktop does not announce are read again. */
  pollMs?: number
  /** Changes closer together than this go out as one. */
  debounceMs?: number
  /** How long terminal output carried for redaction may wait for the next batch. */
  flushMs?: number
  /** The clock the agents' revisions are seeded from. */
  now?: () => number
}

type Emit = (frame: RemoteTopicFrame) => void
type Request = Parameters<RemoteTopicSource['open']>[0]

class Stream {
  private seq = 0
  constructor(private readonly emit: Emit, private readonly schemaVersion: number) {}

  snapshot(pages: unknown[], cursor?: string): void {
    pages.forEach((data, index) => {
      const last = index === pages.length - 1
      this.emit({ kind: 'snapshot', seq: ++this.seq, schemaVersion: this.schemaVersion, data, ...(last && cursor ? { cursor } : {}), ...(pages.length > 1 ? { page: { index, last } } : {}) })
    })
  }

  /** Events in order; only the last carries the cursor, so a phone cut off halfway resumes from before them all. */
  events(datas: unknown[], cursor?: string): void {
    datas.forEach((data, index) => this.emit({ kind: 'event', seq: ++this.seq, schemaVersion: this.schemaVersion, data, ...(index === datas.length - 1 && cursor ? { cursor } : {}) }))
  }
}

function debounced(run: () => void, ms: number): { fire(): void; cancel(): void } {
  let timer: ReturnType<typeof setTimeout> | null = null, closed = false
  return {
    fire() {
      if (timer || closed) return
      timer = setTimeout(() => { timer = null; if (!closed) run() }, ms)
      timer.unref?.()
    },
    cancel() { closed = true; if (timer) clearTimeout(timer); timer = null }
  }
}

const digest = (value: string): string => createHash('sha256').update(value).digest('base64url').slice(0, 22)

// ---- Lists --------------------------------------------------------------------------------------------------------

interface ListSpec<T> {
  code: string
  field: 'workspaces' | 'threads' | 'requests' | 'jobs' | 'delegations'
  read(): T[]
  id(item: T): string
  /** Events carry `{ upsert, removed }` instead of the whole list. */
  diff?: boolean
  watch(listener: () => void): () => void
}

class ListTopic<T> implements RemoteTopicSource {
  private readonly states = new Map<string, Map<string, string>>()

  constructor(private readonly spec: ListSpec<T>, private readonly debounceMs: number) {}

  private capture(): { cursor: string; items: T[]; byId: Map<string, string> } {
    const items = this.spec.read()
    const byId = new Map(items.map(item => [this.spec.id(item), JSON.stringify(item)]))
    const cursor = `${this.spec.code}.${digest(JSON.stringify(items))}`
    this.states.delete(cursor)
    this.states.set(cursor, byId)
    while (this.states.size > REMEMBERED_STATES) this.states.delete(this.states.keys().next().value!)
    return { cursor, items, byId }
  }

  open(request: Request, emit: Emit): { close(): void } | null {
    if (request.target !== undefined) return null
    const stream = new Stream(emit, REMOTE_PROTOCOL_VERSION)
    const wrap = (chunk: T[]) => ({ [this.spec.field]: chunk })
    let sent = request.cursor ? this.states.get(request.cursor) : undefined
    let sentCursor = sent ? request.cursor : undefined
    const push = (): void => {
      const state = this.capture()
      if (sent && state.cursor === sentCursor) return
      if (!sent) stream.snapshot(pageList(state.items, wrap), state.cursor)
      else if (this.spec.diff) {
        const before = sent
        const upsert = state.items.filter(item => before.get(this.spec.id(item)) !== state.byId.get(this.spec.id(item)))
        const removed = [...before.keys()].filter(id => !state.byId.has(id))
        const pages = pageList(upsert, chunk => ({ ...(chunk.length ? { upsert: chunk } : {}) }))
        if (removed.length) pages[pages.length - 1] = { ...(pages[pages.length - 1] as object), removed }
        stream.events(pages, state.cursor)
      } else {
        const pages = pageList(state.items, wrap)
        // The whole list in one event when it fits; otherwise a snapshot, which comes in pages.
        if (pages.length === 1) stream.events(pages, state.cursor)
        else stream.snapshot(pages, state.cursor)
      }
      sent = state.byId
      sentCursor = state.cursor
    }
    push()
    const trigger = debounced(() => { try { push() } catch { /* the next change tries again */ } }, this.debounceMs)
    const stop = this.spec.watch(() => trigger.fire())
    return { close() { trigger.cancel(); stop() } }
  }
}

function polled(pollMs: number, also?: (listener: () => void) => () => void): (listener: () => void) => () => void {
  return listener => {
    const timer = setInterval(listener, pollMs)
    timer.unref?.()
    const stop = also?.(listener)
    return () => { clearInterval(timer); stop?.() }
  }
}

// ---- One conversation ---------------------------------------------------------------------------------------------

export const threadCursor = (sync: ThreadSyncCursor | undefined): string | undefined => sync ? `${sync.epoch}:${sync.revision}` : undefined

export function readThreadCursor(cursor: string | undefined): ThreadSyncCursor | undefined {
  const match = cursor ? /^([A-Za-z0-9-]{1,64}):(\d{1,15})$/.exec(cursor) : null
  return match ? { epoch: match[1], revision: Number(match[2]) } : undefined
}

/** Events with their sequence, to timeline items; delta events are already folded into their message. */
export function threadItems(events: Array<{ seq: number; event: ThreadEvent }>, roots: readonly string[], patchOf?: (artifactId: string) => string | undefined): Array<{ seq: number; item: RemoteThreadItem }> {
  const items: Array<{ seq: number; item: RemoteThreadItem }> = []
  for (const { seq, event } of events) {
    const item = toThreadItem(event, seq, roots, patchOf)
    if (item) items.push({ seq, item: fitItem(item) })
  }
  return items
}

/** The newest items that fit one frame with the header, at most `threadPage` of them. */
export function fitPage(header: RemoteThreadHeader, items: Array<{ seq: number; item: RemoteThreadItem }>, more: boolean): RemoteThreadSnapshot {
  const page = items.slice(-REMOTE_TEXT_LIMITS.threadPage)
  let size = Buffer.byteLength(JSON.stringify({ thread: header, items: [], hasMore: true }))
  let start = page.length
  while (start > 0) {
    const next = Buffer.byteLength(JSON.stringify(page[start - 1])) + 1
    if (size + next > FRAME_BUDGET) break
    size += next
    start -= 1
  }
  return { thread: header, items: page.slice(start), hasMore: more || items.length > page.length - start }
}

/** A window's events numbered like the journal: its tail ends at `live - 1`. */
export function numbered(events: ThreadEvent[], upper: number): Array<{ seq: number; event: ThreadEvent }> {
  return events.map((event, index) => ({ seq: upper - events.length + index, event }))
}

/** The clocks change on every build; a header that differs only in them is not news. */
const headerKey = (header: RemoteThreadHeader): string => JSON.stringify({ ...header, updatedAt: 0, turnElapsedMs: header.turnElapsedMs === undefined ? undefined : 0, quietMs: header.quietMs === undefined ? undefined : 0 })

class ThreadTopic implements RemoteTopicSource {
  constructor(private readonly desktop: RemoteDesktop, private readonly debounceMs: number) {}

  open(request: Request, emit: Emit): { close(): void } | null {
    const id = request.target
    if (!id) return null
    let thread: ConversationThread
    try { thread = this.desktop.readThread(id) } catch { return null }
    const desktop = this.desktop
    const stream = new Stream(emit, THREAD_SCHEMA_VERSION)
    let sync = readThreadCursor(request.cursor)
    let lastHeader: string | undefined
    const roots = () => [thread.rootPath, ...desktop.roots()]
    const patchOf = (artifactId: string): string | undefined => desktop.threadArtifact?.(id, artifactId)
    const snapshot = (): void => {
      const window = desktop.threadWindow(id)
      thread = window.thread
      const all = roots()
      const header = toThreadHeader(window.thread, window.pendingRequests?.length ?? 0, all, { turns: window.turns, now: Date.now() })
      const items = threadItems(numbered(window.events, window.page?.live ?? window.events.length), all, patchOf)
      const newest = items.slice(-REMOTE_TEXT_LIMITS.threadPage)
      const hasMore = items.length > newest.length || Boolean(window.page?.hasMore)
      stream.snapshot(pageList(newest, chunk => ({ thread: header, items: chunk, hasMore })), threadCursor(window.sync))
      sync = window.sync
      lastHeader = headerKey(header)
    }
    const push = (): void => {
      if (!sync) return snapshot()
      const delta = desktop.threadSince(id, sync)
      if (!delta.ok) return snapshot()
      thread = delta.thread
      const all = roots()
      const header = toThreadHeader(delta.thread, delta.pendingRequests.length, all, { turns: delta.turns, now: Date.now() })
      const items = threadItems(delta.events, all, patchOf)
      sync = { epoch: delta.epoch, revision: delta.revision }
      if (!items.length && headerKey(header) === lastHeader) return
      lastHeader = headerKey(header)
      stream.events(pageList(items, chunk => ({ thread: header, items: chunk })), threadCursor(sync))
    }
    // Listening starts before the first read, so nothing that happens in between is missed.
    const trigger = debounced(() => { try { push() } catch { /* deleted or archived: it stays quiet */ } }, this.debounceMs)
    const stop = desktop.onThreadChanged(id, () => trigger.fire())
    try { push() } catch (error) { trigger.cancel(); stop(); throw error }
    return { close() { trigger.cancel(); stop() } }
  }
}

/**
 * 1.4.3 P4: the screen has a snapshot page of its own (`data: ''`), so a busy pane's ring never pushes it out (TECH
 * LEAD on #634). It must fit that page within the frame budget; the builder tries less history before giving up, and
 * a screen that does not fit is left out, never cut (a cut serialization would draw garbage).
 */
export function snapshotFits(snapshot: RemoteTerminalSnapshot): boolean {
  return Buffer.byteLength(JSON.stringify({ data: '', truncated: false, redacted: 0, snapshot })) <= FRAME_BUDGET - 2048
}

// ---- Terminal (read-only) -----------------------------------------------------------------------------------------

/**
 * A pane's ring, read-only. Two positions in the ring are kept: `read` (taken from the ring) and `sent` (released to
 * the phone, the cursor). Between them is the tail the `TerminalWindow` carries so a secret printed across two
 * batches is redacted whole; it goes out with the next batch, or `flushMs` after it was first held. A cursor always
 * names `sent`, so a phone that resumes gets the held tail again, never anything twice.
 */
class TerminalTopic implements RemoteTopicSource {
  constructor(private readonly desktop: RemoteDesktop, private readonly debounceMs: number, private readonly flushMs: number) {}

  open(request: Request, emit: Emit): { close(): void } | null {
    const paneId = request.target
    if (!paneId) return null
    const desktop = this.desktop
    const head = desktop.terminal(paneId, Number.MAX_SAFE_INTEGER)
    if (!head) return null
    const stream = new Stream(emit, REMOTE_PROTOCOL_VERSION)
    /** BE-A45-flag: only the screen page when it can be built; otherwise the ring pages as before. */
    const snapshotOnly = request.snapshotOnly === true
    const window = new TerminalWindow(text => { const filtered = clean(text, desktop.roots(), Number.MAX_SAFE_INTEGER); return { text: filtered.text, redacted: filtered.redacted } })
    let session = digest(head.session)
    let read = 0
    let flushTimer: ReturnType<typeof setTimeout> | null = null
    let closed = false
    const sent = () => read - window.heldLength
    const pieces = (out: { text: string; redacted: number }, truncated: boolean) =>
      splitText(out.text, REMOTE_TEXT_LIMITS.terminalChunk)
        .map((text, index) => ({ data: text, truncated: index === 0 && truncated, ...(index === 0 && out.redacted ? { redacted: out.redacted } : {}) }))
    const holdTimer = (): void => {
      if (flushTimer || closed || !window.heldLength) return
      flushTimer = setTimeout(() => {
        flushTimer = null
        if (closed) return
        try { release(window.flush(), 'event', false) } catch { /* the pane went away */ }
      }, this.flushMs)
      flushTimer.unref?.()
    }
    const release = (out: { text: string; redacted: number }, kind: 'snapshot' | 'event', truncated: boolean): void => {
      const pages = pieces(out, truncated)
      const cursor = `${session}:${sent()}`
      if (kind === 'snapshot') stream.snapshot(pages.length ? pages : [{ data: '', truncated: false }], cursor)
      else if (pages.length) stream.events(pages, cursor)
      else if (truncated) stream.events([{ data: '', truncated: true }], cursor)
      holdTimer()
    }
    const restart = (): void => {
      if (flushTimer) clearTimeout(flushTimer)
      flushTimer = null
      window.reset()
    }
    // 1.4.3 P4: while the screen is being built (the emulator parses asynchronously), output waits; it is pushed after
    // the snapshot frame, so the phone never gets an event before the screen it applies to.
    let building = false
    let pushWaiting = false
    const snapshot = (): void => {
      const now = desktop.terminal(paneId, 0)
      if (!now) return
      restart()
      session = digest(now.session)
      read = now.seq
      building = true
      // The newest characters are held for `flushMs` so a secret split by the next batch is redacted whole; the screen
      // needs them. So the snapshot waits that same `flushMs` (what the hold timer would wait anyway), takes whatever
      // came meanwhile, and then releases everything but an unfinished escape sequence.
      // `since(0)` hands back everything retained, which ends at `seq`.
      let raw = now.data
      const timer = setTimeout(() => {
        if (closed) return
        let size = { cols: now.cols, rows: now.rows }
        try {
          const later = desktop.terminal(paneId, read)
          if (later && digest(later.session) === session && !later.truncated && later.seq !== read) { raw += later.data; read = later.seq; size = { cols: later.cols ?? size.cols, rows: later.rows ?? size.rows } }
        } catch { /* the pane went away: the snapshot is what was read */ }
        const out = window.takeAll(raw)
        void buildTerminalSnapshot(out.text, size.cols ?? 80, size.rows ?? 24, desktop.roots(), snapshotFits)
          .catch(() => null)
          .then(built => {
            building = false
            if (closed) return
            if (built) releaseWithScreen(out, built)
            else release(out, 'snapshot', false)
            if (pushWaiting) { pushWaiting = false; try { push() } catch { /* the pane went away */ } }
          })
      }, this.flushMs)
      timer.unref?.()
    }
    /** The screen on a first page of its own (its second-layer redactions counted there), then the ring's pages. */
    const releaseWithScreen = (out: { text: string; redacted: number }, built: { snapshot: RemoteTerminalSnapshot; redacted: number }): void => {
      if (snapshotOnly) {
        // 1.5.0 F10 BE-A45-flag: the phone reads the screen, so it is the one page; it carries the redactions of the
        // ring it stands for plus the second layer's.
        const redacted = out.redacted + built.redacted
        const only: RemoteTerminalData = { data: '', truncated: false, ...(redacted ? { redacted } : {}), snapshot: built.snapshot }
        stream.snapshot([only], `${session}:${sent()}`)
        holdTimer()
        return
      }
      const screen: RemoteTerminalData = { data: '', truncated: false, ...(built.redacted ? { redacted: built.redacted } : {}), snapshot: built.snapshot }
      stream.snapshot([screen, ...pieces(out, false)], `${session}:${sent()}`)
      holdTimer()
    }
    const push = (): void => {
      if (building) { pushWaiting = true; return }
      const now = desktop.terminal(paneId, read)
      if (!now) return
      if (digest(now.session) !== session) return snapshot()
      if (now.seq === read) return
      if (now.truncated) {
        // The phone's place fell off the ring: what was held goes first, then everything kept, marked so the view clears.
        if (window.heldLength) release(window.flush(), 'event', false)
        restart()
        read = now.seq
        return release(window.take(now.data), 'event', true)
      }
      read = now.seq
      release(window.take(now.data), 'event', false)
    }
    const resume = request.cursor ? /^([A-Za-z0-9_-]{22}):(\d{1,15})$/.exec(request.cursor) : null
    if (resume && resume[1] === session && Number(resume[2]) <= head.seq) { read = Number(resume[2]); push() } else snapshot()
    const trigger = debounced(() => { try { push() } catch { /* the pane went away */ } }, this.debounceMs)
    const stop = desktop.onTerminalOutput(pane => { if (pane === paneId) trigger.fire() })
    return { close() { closed = true; trigger.cancel(); stop(); if (flushTimer) clearTimeout(flushTimer) } }
  }
}

// ---- Agents (S7.1, CCR #513 §6) -------------------------------------------------------------------------------------

const agentKey = (row: { kind: string; id: string }): string => `${row.kind}:${row.id}`
/** Removed keys the gateway remembers, so a phone that resumes still gets each removal with the `rev` it left at. */
const AGENT_TOMBSTONES = 2_000

/**
 * The `rev` of every agent row, one book per gateway so every phone sees the same numbers. One counter for all rows,
 * seeded from the clock (milliseconds × 1000), so a restart starts above the last run unless the clock went back; a
 * restart sends a fresh snapshot anyway (cursors live in memory), which replaces what the phone holds; a row gets the next value when
 * what the phone sees of it changes, and a removed row gets one when it leaves.
 */
export class AgentRevisions {
  private counter: number
  private readonly rows = new Map<string, { json: string; rev: number }>()
  private readonly gone = new Map<string, number>()

  constructor(now: number) { this.counter = Math.floor(now) * 1000 }

  /** Gives every row its `rev`, and a tombstone to each row that left since the last call. */
  update(rows: RemoteAgentRow[]): RemoteAgentRow[] {
    const seen = new Set<string>()
    const out = rows.map(row => {
      const key = agentKey(row)
      seen.add(key)
      const json = JSON.stringify({ ...row, rev: 0 })
      const known = this.rows.get(key)
      if (known && known.json === json) return { ...row, rev: known.rev }
      const rev = ++this.counter
      this.rows.set(key, { json, rev })
      this.gone.delete(key)
      return { ...row, rev }
    })
    for (const key of [...this.rows.keys()]) if (!seen.has(key)) { this.rows.delete(key); this.bury(key) }
    return out
  }

  /** The `rev` at which `key` left; a key the book no longer remembers gets a new one. */
  removedAt(key: string): number {
    return this.gone.get(key) ?? this.bury(key)
  }

  private bury(key: string): number {
    const rev = ++this.counter
    this.gone.delete(key)
    this.gone.set(key, rev)
    while (this.gone.size > AGENT_TOMBSTONES) this.gone.delete(this.gone.keys().next().value!)
    return rev
  }
}

/** Which kind of row each source reads. */
const SOURCE_KIND: Record<RemoteAgentSource, RemoteAgentRow['kind']> = { panes: 'pane', threads: 'thread', delegations: 'delegation', work: 'work' }

class AgentsTopic implements RemoteTopicSource {
  private readonly states = new Map<string, Map<string, number>>()
  private readonly lastRows = new Map<RemoteAgentRow['kind'], RemoteAgentRow[]>()

  constructor(
    private readonly desktop: RemoteDesktop, private readonly revisions: AgentRevisions, private readonly pollMs: number, private readonly debounceMs: number,
    /** CR-34: panes kept off the phone; their rows never reach it, in a snapshot or an event. */
    private readonly hidden: () => ReadonlySet<string> = () => NONE,
    /** What only the gateway knows changed (a pane hidden or shown): read again now, not at the next poll. */
    private readonly gatewayChanged?: (listener: () => void) => () => void
  ) {}

  private capture(): { cursor: string; rows: RemoteAgentRow[]; byKey: Map<string, number>; unavailable: RemoteAgentSource[] } {
    const overview = this.desktop.agents()
    const roots = this.desktop.roots()
    const shown = new Map(this.desktop.pendingRequests().map(row => {
      const request = toPendingRequest(row, roots)
      return [`${request.threadId}\u0000${request.requestId}`, request] as const
    }))
    const unavailable = REMOTE_AGENT_SOURCES.filter(source => !overview.sources[source]?.ok)
    const hidden = this.hidden()
    const visible = (row: { kind: string; id: string }): boolean => !(row.kind === 'pane' && hidden.has(row.id))
    const fresh = overview.agents.filter(visible).map(row => toRemoteAgent(row, 0, roots, message => this.desktop.messageText(message), (threadId, requestId) => shown.get(`${threadId}\u0000${requestId}`)))
    // A source that could not be read keeps its last rows, named in `unavailable`: a failure never reads as "gone"
    // (SECURITY #531 L5, §5.7).
    for (const source of REMOTE_AGENT_SOURCES) {
      const kind = SOURCE_KIND[source]
      if (unavailable.includes(source)) fresh.push(...(this.lastRows.get(kind) ?? []).filter(visible))
      else this.lastRows.set(kind, fresh.filter(row => row.kind === kind))
    }
    const rows = this.revisions.update(fresh)
    const byKey = new Map(rows.map(row => [agentKey(row), row.rev]))
    const cursor = `a.${digest(JSON.stringify([[...byKey], unavailable]))}`
    this.states.delete(cursor)
    this.states.set(cursor, byKey)
    while (this.states.size > REMEMBERED_STATES) this.states.delete(this.states.keys().next().value!)
    return { cursor, rows, byKey, unavailable }
  }

  open(request: Request, emit: Emit): { close(): void } | null {
    if (request.target !== undefined) return null
    const stream = new Stream(emit, REMOTE_PROTOCOL_VERSION)
    let sent = request.cursor ? this.states.get(request.cursor) : undefined
    let sentCursor = sent ? request.cursor : undefined
    const push = (): void => {
      const state = this.capture()
      if (sent && state.cursor === sentCursor) return
      const { unavailable } = state
      if (!sent) {
        stream.snapshot(pageList(state.rows, chunk => ({ rows: chunk, unavailable } satisfies RemoteAgentsSnapshot)), state.cursor)
      } else {
        const before = sent
        const upsert = state.rows.filter(row => before.get(agentKey(row)) !== row.rev)
        const removed: RemoteAgentKey[] = [...before.keys()].filter(key => !state.byKey.has(key)).map(key => {
          const split = key.indexOf(':')
          return { kind: key.slice(0, split) as RemoteAgentKind, id: key.slice(split + 1), rev: this.revisions.removedAt(key) }
        })
        const pages = pageList(upsert, chunk => ({ ...(chunk.length ? { upsert: chunk } : {}), unavailable } satisfies RemoteAgentsEvent))
        if (removed.length) pages[pages.length - 1] = { ...(pages[pages.length - 1] as object), removed }
        stream.events(pages, state.cursor)
      }
      sent = state.byKey
      sentCursor = state.cursor
    }
    push()
    const trigger = debounced(() => { try { push() } catch { /* the next change tries again */ } }, this.debounceMs)
    // Pushed by every source; the poll only catches what a source forgot to announce.
    const stop = polled(this.pollMs * 5, listener => {
      const desk = this.desktop.onAgentsChanged(listener), gateway = this.gatewayChanged?.(listener)
      return () => { desk(); gateway?.() }
    })(() => trigger.fire())
    return { close() { trigger.cancel(); stop() } }
  }
}

// ---- All of them --------------------------------------------------------------------------------------------------

export function isCursor(value: unknown): value is string {
  return typeof value === 'string' && CURSOR.test(value)
}

/**
 * Every topic but `paneConversation`, which F10's BE-A46-c5 adds (#706). Until then a subscribe to it finds no source and
 * gets `not-found`, as before the topic existed.
 */
export function createTopics(options: TopicOptions): Omit<Record<RemoteSubscription, RemoteTopicSource>, 'paneConversation'> {
  const { desktop } = options
  const phoneHidden = (): ReadonlySet<string> => options.phoneHidden?.() ?? NONE
  const pollMs = options.pollMs ?? 2_000, debounceMs = options.debounceMs ?? 150, flushMs = options.flushMs ?? 250
  const anyThread = (listener: () => void) => desktop.onThreadChanged('*', listener)
  const pendingByThread = () => {
    const counts = new Map<string, number>()
    for (const row of desktop.pendingRequests()) counts.set(row.thread.id, (counts.get(row.thread.id) ?? 0) + 1)
    return counts
  }
  return {
    workspaces: new ListTopic({
      code: 'w', field: 'workspaces', id: item => item.id, watch: polled(pollMs, options.onWorkspacesChanged),
      read: () => {
        const roots = desktop.roots(), phoneWrite = options.phoneWrite(), hidden = phoneHidden()
        // CR-34: a hidden pane is not in the list at all, for every subscriber.
        return desktop.workspaces().map(row => toWorkspace(hidden.size ? { ...row, panes: row.panes.filter(pane => !hidden.has(pane.id)) } : row, phoneWrite, roots, options.paneConversation))
      }
    }, debounceMs),
    threads: new ListTopic({
      code: 't', field: 'threads', id: item => item.id, diff: true, watch: anyThread,
      read: () => {
        const roots = desktop.roots(), pending = pendingByThread()
        return desktop.threads().filter(thread => !thread.archived).sort((a, b) => b.updatedAt - a.updatedAt || a.id.localeCompare(b.id))
          .map(thread => toThreadSummary(thread, pending.get(thread.id) ?? 0, roots))
      }
    }, debounceMs),
    thread: new ThreadTopic(desktop, debounceMs),
    pendingRequests: new ListTopic({
      code: 'p', field: 'requests', id: item => `${item.threadId}/${item.requestId}`, watch: anyThread,
      read: () => { const roots = desktop.roots(); return desktop.pendingRequests().map(row => toPendingRequest(row, roots)) }
    }, debounceMs),
    terminal: new TerminalTopic(desktop, debounceMs, flushMs),
    jobs: new ListTopic({
      code: 'j', field: 'jobs', id: item => item.id, watch: polled(pollMs),
      read: () => { const roots = desktop.roots(); return desktop.jobs().map(row => toJob(row, roots)) }
    }, debounceMs),
    delegations: new ListTopic({
      code: 'd', field: 'delegations', id: item => item.id, watch: polled(pollMs),
      read: () => { const roots = desktop.roots(); return desktop.delegations().map(row => toDelegation(row, roots)) }
    }, debounceMs),
    agents: new AgentsTopic(desktop, new AgentRevisions((options.now ?? Date.now)()), pollMs, debounceMs, phoneHidden, options.onWorkspacesChanged)
  }
}
