import { createReadStream } from 'node:fs'
import { readdir } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import type { ConversationThread, ThreadEvent } from '../../../../shared/types/thread'
import { formatNativeUserText } from '../../../../shared/native-session-text'
import type { ConversationTransport } from './codex-conversation'
import { AgentProcessTransport } from './process-transport'
import { AgentRpcPeer } from './rpc-peer'
import { encodeClaudeProjectPath } from '../usage/claude-project-path'
import { readNativeHistoryPage, type NativeHistoryCursor } from './native-history-page'

export interface NativeSessionHistory { events: ThreadEvent[]; title?: string; truncated?: boolean; cursor?: NativeHistoryCursor }
const MAX_LINE_BYTES = 2 * 1024 * 1024
const MAX_TEXT_BYTES = 2 * 1024 * 1024
const MAX_EVENTS = 1000
function record(value: unknown): Record<string, unknown> { return value && typeof value === 'object' ? value as Record<string, unknown> : {} }
function sameRoot(a: string, b: string): boolean {
  const normalized = (path: string) => resolve(path.replace(/^\\\\\?\\/, '')).replace(/[\\/]+$/, '')
  return process.platform === 'win32' ? normalized(a).toLowerCase() === normalized(b).toLowerCase() : normalized(a) === normalized(b)
}
function publicMessage(id: string, role: 'user' | 'assistant', content: unknown): ThreadEvent | null {
  const rawText = typeof content === 'string' ? content : Array.isArray(content)
    ? content.filter(block => record(block).type === 'text').map(block => record(block).text).filter(text => typeof text === 'string').join('\n') : ''
  const text = role === 'user' ? formatNativeUserText(rawText) : rawText
  if (!text || text.length > 256 * 1024) return null
  return { type: 'message', id, role, text }
}

/** Read JSONL incrementally. Tool results can be enormous, so a single line is
 * discarded once it exceeds the cap instead of buffering the whole file. */
async function* jsonLines(path: string, start = 0, end?: number): AsyncGenerator<Record<string, unknown>> {
  const stream = createReadStream(path, { encoding: 'utf8', highWaterMark: 64 * 1024, start, ...(end === undefined ? {} : { end }) })
  // A byte offset can land inside JSON or a UTF-8 character. Discard that
  // partial record before parsing complete lines from the recent window.
  let pending = '', oversized = start > 0
  for await (const chunk of stream) {
    const parts = (pending + chunk).split('\n')
    pending = parts.pop() ?? ''
    for (const line of parts) {
      if (!oversized && Buffer.byteLength(line) <= MAX_LINE_BYTES) {
        try { yield record(JSON.parse(line)) } catch { /* incomplete provider record */ }
      }
      oversized = false
    }
    if (Buffer.byteLength(pending) > MAX_LINE_BYTES) { pending = ''; oversized = true }
  }
  if (!oversized && pending && Buffer.byteLength(pending) <= MAX_LINE_BYTES) {
    try { yield record(JSON.parse(pending)) } catch { /* incomplete final record */ }
  }
}

/** Read only public conversation text from a proven ID in this exact project.
 * Never search for the newest session: other agents/CLIs may be running there. */
export class NativeSessionReader {
  constructor(private readonly executable: (thread: ConversationThread) => string, private readonly options: {
    claudeHome?: string
    codexHome?: string
    transport?: (command: string, cwd: string) => ConversationTransport
  } = {}) {}

  async read(thread: ConversationThread, id: string, cursor?: NativeHistoryCursor): Promise<NativeSessionHistory> {
    if (!/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(id)) throw Error('Invalid native session identifier')
    if (thread.provider === 'claude') {
      const home = this.options.claudeHome ?? process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), '.claude')
      const path = join(home, 'projects', encodeClaudeProjectPath(thread.rootPath), `${id}.jsonl`)
      return this.readClaudePage(thread, id, path, cursor)
    }
    const rollout = await findCodexRollout(this.options.codexHome ?? process.env.CODEX_HOME ?? join(homedir(), '.codex'), id)
    if (rollout) return this.readCodexRollout(thread, id, rollout, cursor)
    if (cursor) throw Error('Native history file is unavailable. Restore its location and retry.')
    const transport = (this.options.transport ?? ((command, cwd) => new AgentProcessTransport(command, ['app-server', '--listen', 'stdio://'], cwd)))(this.executable(thread), thread.rootPath)
    const rpc = new AgentRpcPeer(line => transport.write(line), () => {}, message => { if (message.id !== undefined) rpc.rejectRequest(message.id) }, 8000)
    transport.onData(chunk => { try { rpc.push(chunk) } catch { rpc.close() } }); transport.onClose(() => rpc.close())
    try {
      await rpc.request('initialize', { clientInfo: { name: 'oxespace', version: '0.13.0' } }); rpc.notify('initialized')
      const response = record(await rpc.request('thread/read', { threadId: id, includeTurns: true }))
      const native = record(response.thread)
      if (native.id !== id || typeof native.cwd !== 'string' || !sameRoot(native.cwd, thread.rootPath)) throw Error('Native session belongs to a different project')
      const events: ThreadEvent[] = []
      for (const turn of Array.isArray(native.turns) ? native.turns : []) {
        const items = record(turn).items
        for (const raw of Array.isArray(items) ? items : []) {
          const item = record(raw)
          if (typeof item.id !== 'string' || item.type !== 'userMessage' && item.type !== 'agentMessage') continue
          const message = publicMessage(`native:${item.id}`, item.type === 'userMessage' ? 'user' : 'assistant', item.type === 'userMessage' ? item.content : item.text)
          if (message) events.push(message)
        }
        events.push({ type: 'completed', status: record(turn).status === 'completed' ? 'completed' : record(turn).status === 'failed' ? 'failed' : 'interrupted' })
      }
      return this.bounded({ events, ...(typeof native.name === 'string' && native.name ? { title: native.name.slice(0, 80) } : {}) })
    } finally { rpc.close(); await transport.close() }
  }

  private async readClaudePage(thread: ConversationThread, id: string, path: string, cursor?: NativeHistoryCursor): Promise<NativeSessionHistory> {
    // Validate the selected project independently from the page. A cursor does
    // not grant access to another provider file or worktree.
    let verified = false
    for await (const value of jsonLines(path, 0, 8 * 1024 * 1024 - 1)) {
      if (value.sessionId !== id || typeof value.cwd !== 'string') continue
      if (!sameRoot(value.cwd, thread.rootPath)) throw Error('Native session belongs to a different project')
      verified = true; break
    }
    if (!verified) throw Error('Native session project could not be verified within the bounded header')
    type Entry = { uuid?: string; parent?: string; linked?: boolean; event?: ThreadEvent; title?: string }
    const page = await readNativeHistoryPage<Entry>(path, value => {
      if (value.type === 'custom-title' && typeof value.customTitle === 'string') return { title: value.customTitle.slice(0, 80) }
      if (value.sessionId !== id || value.isSidechain || typeof value.uuid !== 'string') return
      const event = !value.isMeta && (value.type === 'user' || value.type === 'assistant')
        ? publicMessage(`native:${value.uuid}`, value.type, record(value.message).content) : null
      return { uuid: value.uuid, ...(typeof value.parentUuid === 'string' ? { parent: value.parentUuid } : {}), linked: 'parentUuid' in value, ...(event ? { event } : {}) }
    }, cursor, MAX_EVENTS)
    const events: ThreadEvent[] = []
    let lineage = cursor?.claudeLineage, parent = cursor?.claudeParent, title: string | undefined
    for (const entry of [...page.items].reverse()) {
      if (entry.title && title === undefined) title = entry.title
      if (!entry.uuid) continue
      if (lineage === undefined) {
        if (!entry.event) continue
        lineage = entry.linked ? 'linked' : 'legacy'
        parent = entry.uuid
      }
      if (lineage === 'linked' && entry.uuid !== parent) continue
      if (entry.event) events.push(entry.event)
      if (lineage === 'linked') parent = entry.parent
    }
    if (!page.cursor && lineage === 'linked' && parent) throw Error('Native history lineage is incomplete. Earlier messages could not be verified; the current conversation is preserved.')
    const next = page.cursor && !(lineage === 'linked' && !parent) ? { ...page.cursor, ...(lineage ? { claudeLineage: lineage } : {}), ...(parent ? { claudeParent: parent } : {}) } : undefined
    return { events: events.reverse(), ...(title ? { title } : {}), ...(next ? { cursor: next, truncated: true } : {}) }
  }

  private async readCodexRollout(thread: ConversationThread, id: string, path: string, cursor?: NativeHistoryCursor): Promise<NativeSessionHistory> {
    let verified = false
    for await (const value of jsonLines(path, 0, MAX_LINE_BYTES - 1)) {
      if (value.type !== 'session_meta') continue
      const meta = record(value.payload)
      if (meta.id !== id || typeof meta.cwd !== 'string' || !sameRoot(meta.cwd, thread.rootPath)) throw Error('Native session belongs to a different project')
      verified = true; break
    }
    if (!verified) throw Error('Native session identity could not be verified')
    const page = await readNativeHistoryPage<ThreadEvent>(path, (value, offset) => {
      if (value.type !== 'response_item') return
      const item = record(value.payload)
      if (item.type !== 'message' || item.role !== 'user' && item.role !== 'assistant') return
      const content = Array.isArray(item.content) ? item.content.filter(block => ['input_text', 'output_text'].includes(String(record(block).type))).map(block => record(block).text).filter(text => typeof text === 'string').join('\n') : ''
      return publicMessage(`native:${typeof item.id === 'string' ? item.id : `byte-${offset}`}`, item.role, content) ?? undefined
    }, cursor, MAX_EVENTS)
    const first = page.items.find(event => event.type === 'message' && event.role === 'user')
    const title = first?.type === 'message' ? first.text.replace(/\s+/g, ' ').slice(0, 80) : undefined
    return { events: page.items, ...(title ? { title } : {}), ...(page.cursor ? { truncated: true, cursor: page.cursor } : {}) }
  }

  private bounded(history: NativeSessionHistory): NativeSessionHistory {
    let events = history.events, bytes = Buffer.byteLength(JSON.stringify(events))
    while (events.length > MAX_EVENTS || bytes > MAX_TEXT_BYTES && events.length > 1) {
      events = events.slice(Math.max(1, events.length - MAX_EVENTS))
      if (bytes > MAX_TEXT_BYTES && events.length > 1) events = events.slice(Math.max(1, Math.floor(events.length / 8)))
      bytes = Buffer.byteLength(JSON.stringify(events))
    }
    return { ...history, events, ...(events.length < history.events.length ? { truncated: true } : {}) }
  }
}

async function findCodexRollout(home: string, id: string): Promise<string | null> {
  const root = join(home, 'sessions')
  const entries = async (path: string): Promise<string[]> => {
    try { return (await readdir(path, { withFileTypes: true })).filter(entry => entry.isDirectory()).map(entry => entry.name).sort().reverse() }
    catch { return [] }
  }
  for (const year of await entries(root)) for (const month of await entries(join(root, year))) for (const day of await entries(join(root, year, month))) {
    const folder = join(root, year, month, day)
    try {
      const file = (await readdir(folder)).find(name => name.startsWith('rollout-') && name.toLowerCase().endsWith(`${id.toLowerCase()}.jsonl`))
      if (file) return join(folder, file)
    } catch { /* unavailable day */ }
  }
  return null
}
