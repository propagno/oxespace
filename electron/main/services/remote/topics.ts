import { createHash } from 'node:crypto'
import {
  REMOTE_PROTOCOL_VERSION, REMOTE_TEXT_LIMITS,
  type RemoteSubscription, type RemoteThreadHeader, type RemoteThreadItem, type RemoteThreadSnapshot
} from '../../../../shared/remote/protocol'
import type { ConversationThread, ThreadEvent, ThreadSyncCursor } from '../../../../shared/types/thread'
import type { RemoteTopicFrame, RemoteTopicSource } from './connection'
import type { RemoteDesktop } from './desktop'
import { toDelegation, toJob, toPendingRequest, toThreadHeader, toThreadItem, toThreadSummary, toWorkspace } from './filters'
import { fitItem, FRAME_BUDGET, pageList, splitText } from './frames'
import { clean } from './text'

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

export interface TopicOptions {
  desktop: RemoteDesktop
  phoneWrite(): ReadonlySet<string>
  /** Called when something only the gateway knows changes the workspaces list (a pane's phone write). */
  onWorkspacesChanged(listener: () => void): () => void
  /** How often lists the desktop does not announce are read again. */
  pollMs?: number
  /** Changes closer together than this go out as one. */
  debounceMs?: number
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
export function threadItems(events: Array<{ seq: number; event: ThreadEvent }>, roots: readonly string[]): Array<{ seq: number; item: RemoteThreadItem }> {
  const items: Array<{ seq: number; item: RemoteThreadItem }> = []
  for (const { seq, event } of events) {
    const item = toThreadItem(event, seq, roots)
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

const headerKey = (header: RemoteThreadHeader): string => JSON.stringify({ ...header, updatedAt: 0 })

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
    const snapshot = (): void => {
      const window = desktop.threadWindow(id)
      thread = window.thread
      const all = roots()
      const header = toThreadHeader(window.thread, window.pendingRequests?.length ?? 0, all)
      const items = threadItems(numbered(window.events, window.page?.live ?? window.events.length), all)
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
      const header = toThreadHeader(delta.thread, delta.pendingRequests.length, all)
      const items = threadItems(delta.events, all)
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

// ---- Terminal (read-only) -----------------------------------------------------------------------------------------

class TerminalTopic implements RemoteTopicSource {
  constructor(private readonly desktop: RemoteDesktop, private readonly debounceMs: number) {}

  open(request: Request, emit: Emit): { close(): void } | null {
    const paneId = request.target
    if (!paneId) return null
    const desktop = this.desktop
    const head = desktop.terminal(paneId, Number.MAX_SAFE_INTEGER)
    if (!head) return null
    const stream = new Stream(emit, REMOTE_PROTOCOL_VERSION)
    let session = digest(head.session)
    let seq = 0
    const pieces = (data: string, truncated: boolean) => {
      const filtered = clean(data, desktop.roots(), Number.MAX_SAFE_INTEGER)
      return splitText(filtered.text, REMOTE_TEXT_LIMITS.terminalChunk)
        .map((text, index) => ({ data: text, truncated: index === 0 && truncated, ...(index === 0 && filtered.redacted ? { redacted: filtered.redacted } : {}) }))
    }
    const snapshot = (): void => {
      const read = desktop.terminal(paneId, 0)
      if (!read) return
      session = digest(read.session)
      seq = read.seq
      const pages = pieces(read.data, false)
      stream.snapshot(pages.length ? pages : [{ data: '', truncated: false }], `${session}:${seq}`)
    }
    const push = (): void => {
      const read = desktop.terminal(paneId, seq)
      if (!read) return
      if (digest(read.session) !== session) return snapshot()
      if (read.seq === seq) return
      seq = read.seq
      const pages = pieces(read.data, read.truncated)
      if (pages.length) stream.events(pages, `${session}:${seq}`)
    }
    const resume = request.cursor ? /^([A-Za-z0-9_-]{22}):(\d{1,15})$/.exec(request.cursor) : null
    if (resume && resume[1] === session && Number(resume[2]) <= head.seq) { seq = Number(resume[2]); push() } else snapshot()
    const trigger = debounced(() => { try { push() } catch { /* the pane went away */ } }, this.debounceMs)
    const stop = desktop.onTerminalOutput(pane => { if (pane === paneId) trigger.fire() })
    return { close() { trigger.cancel(); stop() } }
  }
}

// ---- All of them --------------------------------------------------------------------------------------------------

export function isCursor(value: unknown): value is string {
  return typeof value === 'string' && CURSOR.test(value)
}

export function createTopics(options: TopicOptions): Record<RemoteSubscription, RemoteTopicSource> {
  const { desktop } = options
  const pollMs = options.pollMs ?? 2_000, debounceMs = options.debounceMs ?? 150
  const anyThread = (listener: () => void) => desktop.onThreadChanged('*', listener)
  const pendingByThread = () => {
    const counts = new Map<string, number>()
    for (const row of desktop.pendingRequests()) counts.set(row.thread.id, (counts.get(row.thread.id) ?? 0) + 1)
    return counts
  }
  return {
    workspaces: new ListTopic({
      code: 'w', field: 'workspaces', id: item => item.id, watch: polled(pollMs, options.onWorkspacesChanged),
      read: () => { const roots = desktop.roots(), phoneWrite = options.phoneWrite(); return desktop.workspaces().map(row => toWorkspace(row, phoneWrite, roots)) }
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
    terminal: new TerminalTopic(desktop, debounceMs),
    jobs: new ListTopic({
      code: 'j', field: 'jobs', id: item => item.id, watch: polled(pollMs),
      read: () => { const roots = desktop.roots(); return desktop.jobs().map(row => toJob(row, roots)) }
    }, debounceMs),
    delegations: new ListTopic({
      code: 'd', field: 'delegations', id: item => item.id, watch: polled(pollMs),
      read: () => { const roots = desktop.roots(); return desktop.delegations().map(row => toDelegation(row, roots)) }
    }, debounceMs)
  }
}
