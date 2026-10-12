import { resolve } from 'node:path'
import type { ConversationThread, ThreadProviderObservation } from '../../../../shared/types/thread'
import type { ConversationTransport } from './codex-conversation'
import { AgentProcessTransport } from './process-transport'
import { AgentRpcPeer } from './rpc-peer'
import { codexRecoveredTool, type RecoveredTool } from './codex-recovered-tool'

export type RecoveredNativeMessage = { type: 'message'; id: string; role: 'assistant'; text: string; historicalQuestions?: { title: string; options: string[] | null }[] }
export type RecoveredNativeItem = RecoveredNativeMessage | RecoveredTool
export type NativeStateResult = ThreadProviderObservation & { recoveredMessages?: RecoveredNativeMessage[]; recoveredItems?: RecoveredNativeItem[] }

const record = (value: unknown): Record<string, unknown> => value && typeof value === 'object' ? value as Record<string, unknown> : {}
const root = (value: string) => {
  const path = resolve(value.replace(/^\\\\\?\\/, '')).replace(/[\\/]+$/, '')
  return process.platform === 'win32' ? path.toLowerCase() : path
}

/** A passive observer never resumes, subscribes to, or takes ownership of a native turn. */
export class CodexStateReader {
  private closed = false
  private readonly active = new Map<AgentRpcPeer, ConversationTransport>()
  constructor(private readonly executable: (thread: ConversationThread) => string,
    private readonly transport = (command: string, cwd: string): ConversationTransport => new AgentProcessTransport(command, ['app-server', '--listen', 'stdio://'], cwd)) {}

  recover = (thread: ConversationThread, nativeTurnId?: string): Promise<NativeStateResult> => this.observe(thread, nativeTurnId, true)

  observe = async (thread: ConversationThread, nativeTurnId?: string, recoverOutput = false): Promise<NativeStateResult> => {
    let providerResponded = false
    const unknown = (detail: string): ThreadProviderObservation => ({ state: 'unknown', source: providerResponded ? 'codex-app-server' : 'unavailable', observedAt: Date.now(), nativeTurnId, detail })
    if (this.closed) return unknown('The state reader is shutting down.')
    if (thread.provider !== 'codex') return unknown('This provider does not expose a verified passive state query. No conversation was resumed.')
    if (!thread.nativeSessionId || !nativeTurnId) return unknown('No acknowledged native turn is available to check. No input was resent.')
    if (this.active.size >= 4) return unknown('Other provider checks are in progress. Try again shortly.')
    let connection: ConversationTransport | undefined, rpc: AgentRpcPeer | undefined
    try {
      connection = this.transport(this.executable(thread), thread.rootPath)
      const peer = new AgentRpcPeer(line => connection!.write(line), () => {}, message => { if (message.id !== undefined) peer.rejectRequest(message.id) }, 5000)
      rpc = peer; this.active.set(peer, connection)
      connection.onData(chunk => { try { peer.push(chunk) } catch { peer.close() } })
      connection.onClose(() => peer.close())
      const deadline = Date.now() + 15000
      const query = (method: string, params: unknown) => {
        const remaining = deadline - Date.now()
        if (remaining <= 0) throw Error('State query deadline exceeded')
        return peer.request(method, params, Math.min(5000, remaining))
      }
      await query('initialize', { clientInfo: { name: 'oxespace-state-reader', version: '1' }, capabilities: { experimentalApi: true } })
      providerResponded = true
      peer.notify('initialized')
      const native = record(record(await query('thread/read', { threadId: thread.nativeSessionId, includeTurns: false })).thread)
      if (native.id !== thread.nativeSessionId || typeof native.cwd !== 'string' || root(native.cwd) !== root(thread.rootPath)) return unknown('The provider session identity or project directory did not match. The local conversation was preserved.')
      const state = record(native.status).type
      let cursor: string | undefined
      const seen = new Set<string>()
      for (let page = 0; page < 3; page++) {
        const result = record(await query('thread/turns/list', { threadId: thread.nativeSessionId, limit: 50, sortDirection: 'desc', itemsView: 'notLoaded', ...(cursor ? { cursor } : {}) }))
        const turn = (Array.isArray(result.data) ? result.data.map(record) : []).find(item => item.id === nativeTurnId)
        if (turn) {
          // A separate app-server has no ownership evidence for active execution.
          // Persisted interrupted/inProgress can be provisional while another writer runs.
          if (state === 'active' || turn.status !== 'completed' && turn.status !== 'failed') return unknown('The saved turn is not a confirmed terminal result. It may still belong to another runtime; no session was resumed or interrupted.')
          const observation: NativeStateResult = { state: turn.status, source: 'codex-app-server', nativeTurnId, observedAt: Date.now(), detail: 'The provider journal records this exact turn as finished. Missing output has not been imported; the local turn and queued messages were not changed.' }
          if (!recoverOutput) return observation
          try {
            const messages = new Map<string, RecoveredNativeMessage>()
            const recoveredItems = new Map<string, RecoveredNativeItem>()
            let itemCursor: string | undefined, retainedBytes = 0
            const visited = new Set<string>()
            for (let itemPage = 0; itemPage < 40; itemPage++) {
              const items = record(await query('thread/items/list', { threadId: thread.nativeSessionId, turnId: nativeTurnId, limit: 25, sortDirection: 'asc', ...(itemCursor ? { cursor: itemCursor } : {}) }))
              if (!Array.isArray(items.data)) throw Error('Invalid item page')
              for (const raw of items.data) {
                const entry = record(raw), item = record(entry.item)
                if (entry.turnId !== nativeTurnId) throw Error('Unexpected native turn')
                if (item.type !== 'agentMessage') {
                  const tool = codexRecoveredTool(item, nativeTurnId)
                  if (tool) {
                    const previous = recoveredItems.get(tool.id)
                    if (previous && JSON.stringify(previous) !== JSON.stringify(tool)) throw Error('Native item changed during recovery')
                    if (!previous) retainedBytes += Buffer.byteLength(JSON.stringify(tool))
                    if (retainedBytes > 2 * 1024 * 1024) throw Error('Recovery budget exceeded')
                    recoveredItems.set(tool.id, tool)
                  }
                  continue
                }
                if (typeof item.id !== 'string' || !item.id || typeof item.text !== 'string') throw Error('Invalid native message')
                // The journal retains titles/options, not answers or resumable
                // request IDs. Keep this as historical evidence, never input.
                let historicalQuestions: RecoveredNativeMessage['historicalQuestions']
                if (item.questions != null) {
                  if (!Array.isArray(item.questions) || item.questions.length > 20) throw Error('Invalid historical questions')
                  historicalQuestions = item.questions.map(raw => {
                    const question = record(raw)
                    if (typeof question.title !== 'string' || !question.title.trim() || question.title.length > 8192 || question.options !== null && (!Array.isArray(question.options) || question.options.length > 50 || question.options.some(option => typeof option !== 'string' || option.length > 8192))) throw Error('Invalid historical question')
                    return { title: question.title, options: question.options as string[] | null }
                  })
                }
                if (Buffer.byteLength(item.text) > 256 * 1024) throw Error('Message exceeds retained text limit')
                const previous = messages.get(item.id)
                if (recoveredItems.has(item.id) && recoveredItems.get(item.id)?.type !== 'message') throw Error('Conflicting native item identity')
                const message: RecoveredNativeMessage = { type: 'message', id: item.id, role: 'assistant', text: item.text, ...(historicalQuestions?.length ? { historicalQuestions } : {}) }
                if (previous && JSON.stringify(previous) !== JSON.stringify(message)) throw Error('Native message changed during recovery')
                if (!previous) retainedBytes += Buffer.byteLength(JSON.stringify(message))
                if (retainedBytes > 2 * 1024 * 1024) throw Error('Recovery text budget exceeded')
                messages.set(item.id, message)
                recoveredItems.set(item.id, messages.get(item.id)!)
              }
              if (items.nextCursor === null) {
                observation.recoveredMessages = [...messages.values()]
                observation.recoveredItems = [...recoveredItems.values()]
                return observation
              }
              if (typeof items.nextCursor !== 'string' || !items.nextCursor || visited.has(items.nextCursor)) throw Error('Item cursor did not advance')
              visited.add(items.nextCursor); itemCursor = items.nextCursor
            }
          } catch { /* Terminal evidence is retained, but partial output is never committed. */ }
          return { ...observation, detail: 'The provider confirms a terminal result, but its complete public response could not be recovered within the supported limits. The local conversation is unchanged; retry the state check.' }
        }
        const next = result.nextCursor
        if (typeof next !== 'string' || !next || seen.has(next)) break
        seen.add(next); cursor = next
      }
      return unknown('The acknowledged turn was not found within the bounded provider journal query. No input was resent.')
    } catch {
      return unknown('The passive provider query was unavailable or timed out. The execution outcome remains unconfirmed; no input was resent.')
    } finally {
      rpc?.close()
      if (rpc) this.active.delete(rpc)
      await connection?.close()
    }
  }

  async stop(): Promise<void> {
    this.closed = true
    const connections = [...this.active]
    for (const [peer] of connections) peer.close()
    await Promise.allSettled(connections.map(([, connection]) => connection.close()))
  }
}
