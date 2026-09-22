import { readFile, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import type { ConversationThread, ThreadEvent } from '../../../../shared/types/thread'
import type { ConversationTransport } from './codex-conversation'
import { AgentProcessTransport } from './process-transport'
import { AgentRpcPeer } from './rpc-peer'
import { encodeClaudeProjectPath } from '../usage/claude-project-path'

export interface NativeSessionHistory { events: ThreadEvent[]; title?: string }
function record(value: unknown): Record<string, unknown> { return value && typeof value === 'object' ? value as Record<string, unknown> : {} }
function sameRoot(a: string, b: string): boolean {
  const normalized = (path: string) => resolve(path.replace(/^\\\\\?\\/, '')).replace(/[\\/]+$/, '')
  return process.platform === 'win32' ? normalized(a).toLowerCase() === normalized(b).toLowerCase() : normalized(a) === normalized(b)
}
function publicMessage(id: string, role: 'user' | 'assistant', content: unknown): ThreadEvent | null {
  const text = typeof content === 'string' ? content : Array.isArray(content)
    ? content.filter(block => record(block).type === 'text').map(block => record(block).text).filter(text => typeof text === 'string').join('\n') : ''
  if (!text || text.length > 256 * 1024) return null
  return { type: 'message', id, role, text }
}

/** Read only public conversation text from a proven ID in this exact project.
 * Never search for the newest session: other agents/CLIs may be running there. */
export class NativeSessionReader {
  constructor(private readonly executable: (thread: ConversationThread) => string, private readonly options: {
    claudeHome?: string
    transport?: (command: string, cwd: string) => ConversationTransport
  } = {}) {}

  async read(thread: ConversationThread, id: string): Promise<NativeSessionHistory> {
    if (!/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(id)) throw Error('Invalid native session identifier')
    if (thread.provider === 'claude') {
      const home = this.options.claudeHome ?? process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), '.claude')
      const path = join(home, 'projects', encodeClaudeProjectPath(thread.rootPath), `${id}.jsonl`)
      if ((await stat(path)).size > 4 * 1024 * 1024) throw Error('Native history is too large to import; continue in the CLI')
      const values = (await readFile(path, 'utf8')).split('\n').filter(Boolean).map(line => { try { return record(JSON.parse(line)) } catch { return {} } })
      if (!values.some(value => typeof value.cwd === 'string' && sameRoot(value.cwd, thread.rootPath) && value.sessionId === id)) throw Error('Native session belongs to a different project')
      const events: ThreadEvent[] = []
      let title: string | undefined
      const main = values.filter(value => value.sessionId === id && !value.isSidechain && typeof value.uuid === 'string')
      const messages = main.filter(value => !value.isMeta && (value.type === 'user' || value.type === 'assistant'))
      let active: Set<string> | undefined
      if (main.some(value => 'parentUuid' in value)) {
        active = new Set<string>()
        const byId = new Map(main.map(value => [value.uuid as string, value]))
        let cursor = messages.at(-1)
        while (cursor && typeof cursor.uuid === 'string' && !active.has(cursor.uuid)) {
          active.add(cursor.uuid)
          cursor = typeof cursor.parentUuid === 'string' ? byId.get(cursor.parentUuid) : undefined
        }
      }
      for (const value of values) {
        if (value.type === 'custom-title' && typeof value.customTitle === 'string') title = value.customTitle.slice(0, 80)
        if (value.sessionId !== id || value.isSidechain || value.isMeta || value.type !== 'user' && value.type !== 'assistant' || typeof value.uuid !== 'string') continue
        if (active && !active.has(value.uuid)) continue
        const message = publicMessage(`native:${value.uuid}`, value.type, record(value.message).content)
        if (message) events.push(message)
      }
      return this.bounded({ events, ...(title ? { title } : {}) })
    }
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

  private bounded(history: NativeSessionHistory): NativeSessionHistory {
    if (history.events.length > 2000 || Buffer.byteLength(JSON.stringify(history.events)) > 2 * 1024 * 1024) throw Error('Native history is too large to import; continue in the CLI')
    return history
  }
}
