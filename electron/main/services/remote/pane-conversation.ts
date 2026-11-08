import { randomBytes } from 'node:crypto'
import { readdirSync, statSync, watch as watchPath } from 'node:fs'
import { open } from 'node:fs/promises'
import { homedir } from 'node:os'
import { isAbsolute, join, resolve } from 'node:path'
import { StringDecoder } from 'node:string_decoder'
import type { AppDatabase } from '../../db'
import { REMOTE_PROTOCOL_VERSION, REMOTE_TEXT_LIMITS, type RemotePaneConversationArgs, type RemotePaneConversationEvent, type RemotePaneConversationPage, type RemoteThreadItem } from '../../../../shared/remote/protocol'
import type { RemoteTopicSource } from './connection'
import { formatNativeUserText } from '../../../../shared/native-session-text'
import type { ThreadEvent } from '../../../../shared/types/thread'
import { PaneAgentSessions } from '../agent-state/pane-sessions'
import { readNativeHistoryPage, type NativeHistoryCursor } from '../conversation/native-history-page'
import { encodeClaudeProjectPath } from '../usage/claude-project-path'
import { FRAME_BUDGET } from './frames'
import { threadItems } from './topics'

/**
 * 1.5.0 F10 (BE-A46-c5, ccr-phone-pane-conversation.md #658): a terminal agent's own conversation, read for the phone.
 *
 * Only the native session file the pane's recorded session names is read: Claude's `<claudeHome>/projects/<cwd>/<id>.jsonl`
 * or Codex's rollout. Nothing is ever spawned (no Codex app-server), so a Codex session without its rollout has no
 * conversation. Pages are newest first, at most `threadPage` items and one frame, through `threadItems` (redaction, path
 * scrub, `itemText` cut). The cursor the phone gets is an opaque handle kept here, bound to the device, the pane and the
 * session; the byte cursor behind it never leaves the desktop.
 */

const SESSION = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i
/** A page fits one frame with the ack or snapshot around it. */
const PAGE_BUDGET = FRAME_BUDGET - 512
/** Codex day folders looked through for a rollout, newest first. */
const CODEX_DAYS = 400
const CODEX_CACHE = 64

export const PANE_CONVERSATION_LIMITS = {
  /** Items per page. */
  pageItems: REMOTE_TEXT_LIMITS.threadPage,
  /** Handles one device holds; the oldest goes first. */
  handlesPerDevice: 8,
  /** Life of a handle. */
  handleTtlMs: 10 * 60 * 1000,
  /** At most one live signal per window, and a change waits at most this long. */
  eventWindowMs: 2000,
  /** Bytes read from the start of a session file to check whose project it is. */
  headerBytes: 1024 * 1024
} as const

export type PaneConversationRefusal = { error: 'no-conversation' } | { error: 'conversation-changed'; reason?: 'new-session' | 'rewritten' }
export type PaneConversationResult = RemotePaneConversationPage | PaneConversationRefusal

/** What the gateway uses: the workspaces flag, the command, the topic, and forgetting a device on disconnect. */
export interface PaneConversationSource {
  has(paneId: string): boolean
  page(deviceId: string, input: RemotePaneConversationArgs): Promise<PaneConversationResult>
  subscribe(paneId: string, listener: () => void): () => void
  forgetDevice(deviceId: string): void
}

export interface PaneConversationsOptions {
  sessions: Pick<PaneAgentSessions, 'current'>
  /** The folder the pane's agent runs in (its project), or null for a pane main does not know. */
  paneCwd(paneId: string): string | null
  /** The registered roots: paths under them are sent relative, any other is scrubbed. */
  roots(): readonly string[]
  claudeHome?: string
  codexHome?: string
  /** Never called: a phone read never starts a process. A seam so a test can prove it. */
  transport?: (command: string, cwd: string) => unknown
  /** Watches one session file; `fs.watch` by default. */
  watch?: (path: string, listener: () => void) => { close(): void }
  now?: () => number
}

type Agent = 'claude' | 'codex'
interface Located { agent: Agent; sessionId: string; path: string; cwd: string }
interface Handle extends Located { deviceId: string; paneId: string; cursor: NativeHistoryCursor; createdAt: number }
interface Live {
  listeners: Set<() => void>
  file: string | null
  watcher: { close(): void } | null
  size: number
  modifiedAt: number
  timer: ReturnType<typeof setTimeout> | null
}
interface Entry { offset: number; event: ThreadEvent }

function record(value: unknown): Record<string, unknown> { return value && typeof value === 'object' ? value as Record<string, unknown> : {} }

function sameRoot(a: string, b: string): boolean {
  const normalized = (path: string) => resolve(path.startsWith('\\\\?\\') ? path.slice(4) : path).replace(/[\\/]+$/, '')
  return process.platform === 'win32' ? normalized(a).toLowerCase() === normalized(b).toLowerCase() : normalized(a) === normalized(b)
}

function isFile(path: string): boolean {
  try { return statSync(path).isFile() } catch { return false }
}

/** Public conversation text only, as the native session reader keeps it. */
function publicMessage(id: string, role: 'user' | 'assistant', content: unknown): ThreadEvent | null {
  const rawText = typeof content === 'string' ? content : Array.isArray(content)
    ? content.filter(block => record(block).type === 'text').map(block => record(block).text).filter(text => typeof text === 'string').join('\n') : ''
  const text = role === 'user' ? formatNativeUserText(rawText) : rawText
  if (!text || text.length > 256 * 1024) return null
  return { type: 'message', id, role, text }
}

const roleOf = (value: unknown): 'user' | 'assistant' | null => value === 'user' ? 'user' : value === 'assistant' ? 'assistant' : null

const claudeEntry = (sessionId: string) => (value: Record<string, unknown>, offset: number): Entry | undefined => {
  const role = roleOf(value.type)
  if (!role || value.isSidechain || value.isMeta || typeof value.uuid !== 'string') return undefined
  // A line of another session is not this conversation; a line that names none belongs to the file it is in.
  if (typeof value.sessionId === 'string' && value.sessionId && value.sessionId !== sessionId) return undefined
  const event = publicMessage(`native:${value.uuid}`, role, record(value.message).content)
  return event ? { offset, event } : undefined
}

function codexEntry(value: Record<string, unknown>, offset: number): Entry | undefined {
  if (value.type !== 'response_item') return undefined
  const item = record(value.payload)
  const role = roleOf(item.role)
  if (item.type !== 'message' || !role) return undefined
  const content = Array.isArray(item.content)
    ? item.content.filter(block => ['input_text', 'output_text'].includes(String(record(block).type))).map(block => record(block).text).filter((text): text is string => typeof text === 'string').join('\n')
    : ''
  const event = publicMessage(`native:${typeof item.id === 'string' ? item.id : `byte-${offset}`}`, role, content)
  return event ? { offset, event } : undefined
}

/** The first complete record in the file's head that `match` accepts, reading at most `headerBytes`. */
async function firstRecord(path: string, match: (value: Record<string, unknown>) => boolean): Promise<Record<string, unknown> | undefined> {
  const file = await open(path, 'r')
  try {
    const decoder = new StringDecoder('utf8')
    const buffer = Buffer.alloc(64 * 1024)
    let pending = '', position = 0
    while (position < PANE_CONVERSATION_LIMITS.headerBytes) {
      const { bytesRead } = await file.read(buffer, 0, buffer.length, position)
      if (!bytesRead) return undefined
      position += bytesRead
      const lines = (pending + decoder.write(buffer.subarray(0, bytesRead))).split('\n')
      pending = lines.pop() ?? ''
      for (const line of lines) {
        let value: unknown
        try { value = JSON.parse(line) } catch { continue }
        if (value && typeof value === 'object' && !Array.isArray(value) && match(value as Record<string, unknown>)) return value as Record<string, unknown>
      }
    }
    return undefined
  } finally { await file.close() }
}

/** How many of the newest items fit one page frame. */
function fitted(items: Array<{ seq: number; item: RemoteThreadItem }>): number {
  let size = Buffer.byteLength(JSON.stringify({ agent: 'claude', items: [], cursor: 'x'.repeat(32), epoch: Number.MAX_SAFE_INTEGER }))
  let count = 0
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const next = Buffer.byteLength(JSON.stringify(items[index])) + 1
    if (size + next > PAGE_BUDGET) break
    size += next
    count += 1
  }
  return count
}

function watchSessionFile(path: string, listener: () => void): { close(): void } {
  const watcher = watchPath(path, { persistent: false }, () => listener())
  watcher.on('error', () => watcher.close())
  return watcher
}

export class PaneConversations implements PaneConversationSource {
  private readonly handles = new Map<string, Handle>()
  private readonly epochs = new Map<string, { sessionId: string; epoch: number }>()
  private readonly live = new Map<string, Live>()
  private readonly rollouts = new Map<string, string>()
  private readonly now: () => number
  private readonly claudeHome: string
  private readonly codexHome: string
  private readonly watch: (path: string, listener: () => void) => { close(): void }

  constructor(private readonly options: PaneConversationsOptions) {
    this.now = options.now ?? (() => Date.now())
    this.claudeHome = options.claudeHome ?? process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), '.claude')
    this.codexHome = options.codexHome ?? process.env.CODEX_HOME ?? join(homedir(), '.codex')
    this.watch = options.watch ?? watchSessionFile
  }

  /** The phone's flag: a recorded Claude or Codex session whose file exists for the pane's folder. */
  has(paneId: string): boolean {
    return this.locate(paneId) !== null
  }

  async page(deviceId: string, input: RemotePaneConversationArgs): Promise<PaneConversationResult> {
    this.prune()
    const { paneId, cursor } = input
    let located: Located | null
    let from: NativeHistoryCursor | undefined
    if (cursor !== undefined) {
      const handle = this.handles.get(cursor)
      if (!handle || handle.deviceId !== deviceId || handle.paneId !== paneId) return { error: 'conversation-changed' }
      const current = this.current(paneId)
      if (!current || current.agent !== handle.agent || current.sessionId !== handle.sessionId) return { error: 'conversation-changed', reason: 'new-session' }
      located = handle
      from = handle.cursor
    } else {
      located = this.locate(paneId)
      if (!located || !(await this.belongs(located).catch(() => false))) return { error: 'no-conversation' }
    }
    const epoch = this.epochOf(paneId, located.sessionId)
    let read: Awaited<ReturnType<PaneConversations['read']>>
    try { read = await this.read(located, from) } catch {
      // Under a handle, any failure is the file no longer being what the handle named ("Native history changed").
      return from ? { error: 'conversation-changed', reason: 'rewritten' } : { error: 'no-conversation' }
    }
    const next = read.cursor
      ? this.remember({ deviceId, paneId, agent: located.agent, sessionId: located.sessionId, path: located.path, cwd: located.cwd, cursor: read.cursor, createdAt: this.now() })
      : null
    return { agent: located.agent, items: read.items, cursor: next, epoch }
  }

  /** One watcher per pane, opened by the first listener and closed with the last. */
  subscribe(paneId: string, listener: () => void): () => void {
    let live = this.live.get(paneId)
    if (!live) {
      live = { listeners: new Set(), file: null, watcher: null, size: -1, modifiedAt: -1, timer: null }
      this.live.set(paneId, live)
      this.openWatcher(paneId, live)
    }
    const entry = live
    const own = () => listener()
    entry.listeners.add(own)
    return () => {
      entry.listeners.delete(own)
      if (entry.listeners.size || this.live.get(paneId) !== entry) return
      this.closeWatcher(entry)
      if (entry.timer) clearTimeout(entry.timer)
      entry.timer = null
      this.live.delete(paneId)
    }
  }

  /** Main recorded another session for the pane (or ended it): the next page has a higher epoch, and listeners hear it. */
  sessionChanged(paneId: string): void {
    const current = this.current(paneId)
    if (current) this.epochOf(paneId, current.sessionId)
    const live = this.live.get(paneId)
    if (!live) return
    this.closeWatcher(live)
    this.openWatcher(paneId, live)
    this.signal(live)
  }

  forgetDevice(deviceId: string): void {
    for (const [key, handle] of this.handles) if (handle.deviceId === deviceId) this.handles.delete(key)
  }

  // ---- Reading ------------------------------------------------------------------------------------------------

  private current(paneId: string): { agent: string; sessionId: string } | null {
    try { return this.options.sessions.current(paneId) } catch { return null }
  }

  private locate(paneId: string): Located | null {
    const current = this.current(paneId)
    if (!current || !SESSION.test(current.sessionId)) return null
    let cwd: string | null
    try { cwd = this.options.paneCwd(paneId) } catch { return null }
    if (!cwd) return null
    if (current.agent === 'claude') {
      const path = join(this.claudeHome, 'projects', encodeClaudeProjectPath(cwd), `${current.sessionId}.jsonl`)
      return isFile(path) ? { agent: 'claude', sessionId: current.sessionId, path, cwd } : null
    }
    if (current.agent === 'codex') {
      const path = this.rollout(current.sessionId)
      return path ? { agent: 'codex', sessionId: current.sessionId, path, cwd } : null
    }
    return null
  }

  /** The file's own head says it is this project's (and, for Codex, this session's). */
  private async belongs(located: Located): Promise<boolean> {
    if (located.agent === 'claude') {
      const head = await firstRecord(located.path, value => typeof value.cwd === 'string')
      return !head || sameRoot(head.cwd as string, located.cwd)
    }
    const head = await firstRecord(located.path, value => value.type === 'session_meta')
    const meta = record(head?.payload)
    return typeof meta.id === 'string' && meta.id.toLowerCase() === located.sessionId.toLowerCase() && typeof meta.cwd === 'string' && sameRoot(meta.cwd, located.cwd)
  }

  private async read(located: Located, cursor?: NativeHistoryCursor): Promise<{ items: Array<{ seq: number; item: RemoteThreadItem }>; cursor?: NativeHistoryCursor }> {
    const roots = [located.cwd, ...this.options.roots()]
    const accept = located.agent === 'claude' ? claudeEntry(located.sessionId) : codexEntry
    let limit: number = PANE_CONVERSATION_LIMITS.pageItems
    for (let attempt = 0; ; attempt += 1) {
      const page = await readNativeHistoryPage<Entry>(located.path, accept, cursor, limit)
      // The byte offset of each line is its sequence: stable, and growing from oldest to newest.
      const items = threadItems(page.items.map(entry => ({ seq: entry.offset, event: entry.event })), roots)
      const fit = fitted(items)
      const next = page.cursor ? { cursor: page.cursor } : {}
      if (fit >= items.length) return { items, ...next }
      if (attempt >= 3) return { items: items.slice(items.length - Math.max(1, fit)), ...next }
      // Too large for one frame: read again with only as many as fit, so the cursor starts right before them.
      limit = Math.max(1, fit)
    }
  }

  private rollout(sessionId: string): string | null {
    const cached = this.rollouts.get(sessionId)
    if (cached && isFile(cached)) return cached
    this.rollouts.delete(sessionId)
    const root = join(this.codexHome, 'sessions')
    const folders = (path: string): string[] => {
      try { return readdirSync(path, { withFileTypes: true }).filter(entry => entry.isDirectory()).map(entry => entry.name).sort().reverse() } catch { return [] }
    }
    const suffix = `${sessionId.toLowerCase()}.jsonl`
    let days = 0
    for (const year of folders(root)) for (const month of folders(join(root, year))) for (const day of folders(join(root, year, month))) {
      if (++days > CODEX_DAYS) return null
      const folder = join(root, year, month, day)
      let names: string[]
      try { names = readdirSync(folder) } catch { continue }
      const name = names.find(entry => entry.startsWith('rollout-') && entry.toLowerCase().endsWith(suffix))
      if (!name) continue
      const path = join(folder, name)
      this.rollouts.set(sessionId, path)
      while (this.rollouts.size > CODEX_CACHE) this.rollouts.delete(this.rollouts.keys().next().value!)
      return path
    }
    return null
  }

  // ---- Handles and epochs -------------------------------------------------------------------------------------

  private epochOf(paneId: string, sessionId: string): number {
    const known = this.epochs.get(paneId)
    if (!known) { this.epochs.set(paneId, { sessionId, epoch: 1 }); return 1 }
    if (known.sessionId !== sessionId) { known.sessionId = sessionId; known.epoch += 1 }
    return known.epoch
  }

  private remember(handle: Handle): string {
    const own = [...this.handles].filter(([, entry]) => entry.deviceId === handle.deviceId).map(([key]) => key)
    while (own.length >= PANE_CONVERSATION_LIMITS.handlesPerDevice) this.handles.delete(own.shift()!)
    const key = randomBytes(24).toString('base64url')
    this.handles.set(key, handle)
    return key
  }

  private prune(): void {
    const now = this.now()
    for (const [key, handle] of this.handles) if (now - handle.createdAt >= PANE_CONVERSATION_LIMITS.handleTtlMs) this.handles.delete(key)
  }

  // ---- The live signal ----------------------------------------------------------------------------------------

  private openWatcher(paneId: string, live: Live): void {
    const located = this.locate(paneId)
    live.file = located?.path ?? null
    if (!located) return
    const file = located.path
    try { const stats = statSync(file); live.size = stats.size; live.modifiedAt = stats.mtimeMs } catch { live.size = -1; live.modifiedAt = -1 }
    try { live.watcher = this.watch(file, () => this.fired(live, file)) } catch { live.watcher = null }
  }

  private closeWatcher(live: Live): void {
    try { live.watcher?.close() } catch { /* already closed */ }
    live.watcher = null
    live.file = null
  }

  /** A watcher fired: only a change of size or time is news. */
  private fired(live: Live, file: string): void {
    if (live.file !== file) return
    let stats
    try { stats = statSync(file) } catch { return }
    if (stats.size === live.size && stats.mtimeMs === live.modifiedAt) return
    live.size = stats.size
    live.modifiedAt = stats.mtimeMs
    this.signal(live)
  }

  /** At most one signal per window; a change never waits longer than the window. */
  private signal(live: Live): void {
    if (live.timer) return
    live.timer = setTimeout(() => {
      live.timer = null
      for (const listener of [...live.listeners]) { try { listener() } catch { /* a closed subscription */ } }
    }, PANE_CONVERSATION_LIMITS.eventWindowMs)
    live.timer.unref?.()
  }
}

/**
 * The `paneConversation` topic: the snapshot is the newest page; events are exactly `{ changed: true }`, only to this
 * topic's subscribers. `sinceSeq` and `cursor` are ignored: every subscribe gets a fresh snapshot.
 */
export function paneConversationTopic(source: PaneConversationSource): RemoteTopicSource {
  return {
    open(request, emit) {
      const paneId = request.target
      if (!paneId || !source.has(paneId)) return null
      let seq = 0, ready = false, closed = false
      const stop = source.subscribe(paneId, () => {
        if (closed || !ready) return
        const data: RemotePaneConversationEvent = { changed: true }
        emit({ kind: 'event', seq: ++seq, schemaVersion: REMOTE_PROTOCOL_VERSION, data })
      })
      void source.page(request.deviceId, { paneId }).catch((): PaneConversationResult => ({ error: 'no-conversation' })).then(result => {
        if (closed) return
        const data: RemotePaneConversationPage = 'error' in result ? { agent: 'claude', items: [], cursor: null, epoch: 0 } : result
        emit({ kind: 'snapshot', seq: ++seq, schemaVersion: REMOTE_PROTOCOL_VERSION, data })
        ready = true
      })
      return { close() { closed = true; stop() } }
    }
  }
}

/** The app's readers, so main can tell them a pane's session changed without holding the gateway. */
const announced = new Set<WeakRef<PaneConversations>>()

/** Main's hook: a pane's recorded session changed (a new one began, or it ended). */
export function announcePaneSession(paneId: string): void {
  for (const ref of [...announced]) {
    const conversations = ref.deref()
    if (!conversations) { announced.delete(ref); continue }
    try { conversations.sessionChanged(paneId) } catch { /* the next page still sees the new session */ }
  }
}

/** The gateway's reader: sessions from the database, each pane's folder its own root or its workspace's. */
export function paneConversationsFor(db: AppDatabase, roots: () => readonly string[]): PaneConversations {
  const conversations = new PaneConversations({
    sessions: new PaneAgentSessions(db), roots,
    paneCwd: paneId => {
      try {
        const row = db.prepare('SELECT p.root_path AS own, w.root_path AS workspace FROM panes p JOIN workspaces w ON w.id = p.workspace_id WHERE p.id = ?').get(paneId) as { own: string | null; workspace: string | null } | undefined
        if (!row) return null
        return row.own && isAbsolute(row.own) ? row.own : row.workspace || null
      } catch { return null }
    }
  })
  announced.add(new WeakRef(conversations))
  return conversations
}
