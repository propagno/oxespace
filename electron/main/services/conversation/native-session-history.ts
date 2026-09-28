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

export interface NativeSessionHistory { events: ThreadEvent[]; title?: string; truncated?: boolean }
const MAX_LINE_BYTES = 2 * 1024 * 1024
const MAX_TEXT_BYTES = 2 * 1024 * 1024
const MAX_EVENTS = 1000
const MAX_LINEAGE_ENTRIES = 25_000
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
async function* jsonLines(path: string): AsyncGenerator<Record<string, unknown>> {
  const stream = createReadStream(path, { encoding: 'utf8', highWaterMark: 64 * 1024 })
  let pending = '', oversized = false
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

  async read(thread: ConversationThread, id: string): Promise<NativeSessionHistory> {
    if (!/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(id)) throw Error('Invalid native session identifier')
    if (thread.provider === 'claude') {
      const home = this.options.claudeHome ?? process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), '.claude')
      const path = join(home, 'projects', encodeClaudeProjectPath(thread.rootPath), `${id}.jsonl`)
      const main = new Map<string, { parent?: string; message?: ThreadEvent }>()
      const retained: string[] = []
      let textBytes = 0, sawProject = false, lastMessageId: string | undefined, hasParents = false, truncated = false
      let title: string | undefined
      for await (const value of jsonLines(path)) {
        if (value.type === 'custom-title' && typeof value.customTitle === 'string') title = value.customTitle.slice(0, 80)
        if (value.sessionId !== id) continue
        if (typeof value.cwd === 'string' && sameRoot(value.cwd, thread.rootPath)) sawProject = true
        if (value.isSidechain || typeof value.uuid !== 'string') continue
        if ('parentUuid' in value) hasParents = true
        const parent = typeof value.parentUuid === 'string' ? value.parentUuid : undefined
        const publicEvent = !value.isMeta && (value.type === 'user' || value.type === 'assistant')
          ? publicMessage(`native:${value.uuid}`, value.type, record(value.message).content) : null
        main.set(value.uuid, { parent, ...(publicEvent ? { message: publicEvent } : {}) })
        if (main.size > MAX_LINEAGE_ENTRIES) {
          const oldest = main.keys().next().value!
          const evicted = main.get(oldest)?.message
          if (evicted?.type === 'message') {
            textBytes -= Buffer.byteLength(evicted.text)
            const index = retained.indexOf(oldest)
            if (index >= 0) retained.splice(index, 1)
          }
          main.delete(oldest); truncated = true
        }
        if (!publicEvent) continue
        lastMessageId = value.uuid
        retained.push(value.uuid)
        textBytes += Buffer.byteLength(publicEvent.type === 'message' ? publicEvent.text : '')
        while (retained.length > MAX_EVENTS || textBytes > MAX_TEXT_BYTES && retained.length > 1) {
          const old = retained.shift()!
          const entry = main.get(old)
          if (entry?.message?.type === 'message') {
            textBytes -= Buffer.byteLength(entry.message.text)
            delete entry.message
            truncated = true
          }
        }
      }
      if (!sawProject) throw Error('Native session belongs to a different project')
      const active = new Set<string>()
      if (hasParents) {
        let cursor = lastMessageId
        while (cursor && !active.has(cursor)) { active.add(cursor); cursor = main.get(cursor)?.parent }
      }
      const events = [...main.entries()].filter(([key, value]) => value.message && (!hasParents || active.has(key))).map(([, value]) => value.message!)
      return this.bounded({ events, ...(title ? { title } : {}), ...(truncated ? { truncated: true } : {}) })
    }
    const rollout = await findCodexRollout(this.options.codexHome ?? process.env.CODEX_HOME ?? join(homedir(), '.codex'), id)
    if (rollout) return this.readCodexRollout(thread, id, rollout)
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

  private async readCodexRollout(thread: ConversationThread, id: string, path: string): Promise<NativeSessionHistory> {
    const events: ThreadEvent[] = []
    let metaVerified = false, textBytes = 0, truncated = false, index = 0
    let title: string | undefined
    for await (const value of jsonLines(path)) {
      if (value.type === 'session_meta') {
        const meta = record(value.payload)
        if (meta.id !== id || typeof meta.cwd !== 'string' || !sameRoot(meta.cwd, thread.rootPath)) throw Error('Native session belongs to a different project')
        metaVerified = true
        continue
      }
      if (!metaVerified || value.type !== 'response_item') continue
      const item = record(value.payload)
      if (item.type !== 'message' || item.role !== 'user' && item.role !== 'assistant') continue
      const content = Array.isArray(item.content) ? item.content.filter(block => {
        const type = record(block).type
        return type === 'input_text' || type === 'output_text'
      }).map(block => record(block).text).filter(text => typeof text === 'string').join('\n') : ''
      const message = publicMessage(`native:${typeof item.id === 'string' ? item.id : `record-${index++}`}`, item.role, content)
      if (!message || message.type !== 'message') continue
      if (!title && message.role === 'user') title = message.text.replace(/\s+/g, ' ').slice(0, 80)
      events.push(message)
      textBytes += Buffer.byteLength(message.text)
      while (events.length > MAX_EVENTS || textBytes > MAX_TEXT_BYTES && events.length > 1) {
        const removed = events.shift()!
        if (removed.type === 'message') textBytes -= Buffer.byteLength(removed.text)
        truncated = true
      }
    }
    if (!metaVerified) throw Error('Native session identity could not be verified')
    return { events, ...(title ? { title } : {}), ...(truncated ? { truncated: true } : {}) }
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
