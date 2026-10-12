import type { ConversationThread, ThreadModelCatalog } from '../../../../shared/types/thread'
import { AgentProcessTransport } from './process-transport'
import { AgentRpcPeer } from './rpc-peer'
import { CLAUDE_THREAD_ARGS, claudeRuntimeCatalog } from './claude-command-catalog'
import type { ConversationTransport } from './codex-conversation'

const object = (value: unknown): Record<string, unknown> => value && typeof value === 'object' ? value as Record<string, unknown> : {}
export class ThreadModelService {
  private readonly cache = new Map<string, { expires: number; promise: Promise<ThreadModelCatalog> }>()
  private readonly transports = new Set<ConversationTransport>()
  private stopped = false
  constructor(private readonly executable: (thread: ConversationThread) => string,
    private readonly spawn = (command: string, args: string[], cwd: string): ConversationTransport => new AgentProcessTransport(command, args, cwd)) {}
  list(thread: ConversationThread, refresh = false): Promise<ThreadModelCatalog> {
    if (this.stopped) return Promise.reject(Error('Application is shutting down'))
    const command = this.executable(thread)
    const key = JSON.stringify([thread.provider, command, thread.rootPath, process.env.CODEX_HOME, process.env.CLAUDE_CONFIG_DIR])
    const existing = this.cache.get(key)
    if (existing && (existing.expires === Infinity || !refresh && existing.expires > Date.now())) return existing.promise
    this.cache.delete(key)
    if (this.cache.size >= 32) {
      const settled = [...this.cache].find(([, value]) => value.expires !== Infinity)
      if (!settled) return Promise.reject(Error('Model discovery is busy. Try again shortly.'))
      this.cache.delete(settled[0])
    }
    const entry = { expires: Infinity, promise: Promise.resolve<ThreadModelCatalog>({ models: [] }) }
    entry.promise = this.discover(thread, command).then(result => { entry.expires = Date.now() + 60000; return result }, error => { entry.expires = Date.now() + 5000; throw error })
    this.cache.set(key, entry)
    return entry.promise
  }
  private async discover(thread: ConversationThread, command: string): Promise<ThreadModelCatalog> {
    const transport = this.spawn(command, thread.provider === 'claude' ? [...CLAUDE_THREAD_ARGS, '--no-session-persistence'] : ['app-server', '--listen', 'stdio://'], thread.rootPath)
    this.transports.add(transport)
    let peer: AgentRpcPeer | undefined
    try {
      if (thread.provider === 'claude') {
        const { models } = await claudeRuntimeCatalog(transport)
        return { models, defaultModel: models.find(model => model.isDefault)?.id }
      }
      peer = new AgentRpcPeer(line => transport.write(line), () => {}, request => { if (request.id !== undefined) peer!.rejectRequest(request.id) }, 8000)
      transport.onData(chunk => { try { peer!.push(chunk) } catch { peer!.close() } }); transport.onClose(() => peer!.close())
      await peer.request('initialize', { clientInfo: { name: 'oxespace', version: '0.13.0' } }); peer.notify('initialized')
      const models: ThreadModelCatalog['models'] = []
      let cursor: string | undefined
      const cursors = new Set<string>()
      do {
        const response = object(await peer.request('model/list', { limit: 100, includeHidden: false, ...(cursor ? { cursor } : {}) }))
        for (const item of Array.isArray(response.data) ? response.data : []) {
          const value = object(item), id = String(value.model || value.id || '')
          if (!/^[a-z0-9][a-z0-9._:/-]*$/i.test(id) || value.hidden || models.some(model => model.id === id)) continue
          models.push({ id, label: String(value.displayName || id).slice(0, 120), description: String(value.description || '').slice(0, 500),
            efforts: (Array.isArray(value.supportedReasoningEfforts) ? value.supportedReasoningEfforts : []).map(entry => object(entry).reasoningEffort).filter((effort): effort is string => typeof effort === 'string' && /^[a-z0-9_-]+$/i.test(effort)),
            defaultEffort: typeof value.defaultReasoningEffort === 'string' ? value.defaultReasoningEffort : undefined, isDefault: value.isDefault === true })
        }
        cursor = typeof response.nextCursor === 'string' ? response.nextCursor : undefined
        if (cursor && cursors.has(cursor)) throw Error('Invalid model catalog pagination')
        if (cursor) cursors.add(cursor)
      } while (cursor && models.length < 500 && cursors.size < 10)
      const defaultModel = models.find(model => model.isDefault)
      return { models, defaultModel: defaultModel?.id, defaultEffort: defaultModel?.defaultEffort }
    } finally { peer?.close(); this.transports.delete(transport); await transport.close() }
  }
  async stop(): Promise<void> { this.stopped = true; this.cache.clear(); await Promise.allSettled([...this.transports].map(transport => transport.close())) }
}
