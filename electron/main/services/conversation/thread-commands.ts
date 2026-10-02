import { readFile, readdir, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { ConversationThread, ThreadAgentInput, ThreadCommand, ThreadCommandCatalog } from '../../../../shared/types/thread'
import { parseSkillMarkdown } from '../skill.service'
import type { ConversationTransport } from './codex-conversation'
import { AgentProcessTransport } from './process-transport'
import { AgentRpcPeer } from './rpc-peer'
import { CLAUDE_THREAD_ARGS, claudeCommandCatalog } from './claude-command-catalog'
import { CODEX_THREAD_COMMANDS, NATIVE_CLI_COMMANDS } from '../../../../shared/threadCommands'
import { hasDesktopCommand } from '../../../../shared/threadDesktopCommands'

type Entry = ThreadCommand & { path?: string; body?: string }
type NativeCatalog = { commands: Entry[]; warning?: string }
function record(value: unknown): Record<string, unknown> { return value && typeof value === 'object' ? value as Record<string, unknown> : {} }
async function textFile(path: string): Promise<string> {
  try { if ((await stat(path)).size <= 64 * 1024) return await readFile(path, 'utf8') } catch { /* Optional directory or deleted file. */ }
  return ''
}
async function children(path: string): Promise<string[]> { try { return (await readdir(path)).sort().slice(0, 512) } catch { return [] } }

/** Catalog discovery does not create conversations, call a model, or require login. */
export class ThreadCommandService {
  private readonly transports = new Set<ConversationTransport>()
  private readonly catalogs = new Map<string, { promise: Promise<NativeCatalog>; expiresAt: number }>()
  private stopping = false
  constructor(private readonly command: (thread: ConversationThread) => string, private readonly options: {
    home?: string
    transport?: (command: string, cwd: string) => ConversationTransport
    claudeTransport?: (command: string, cwd: string) => ConversationTransport
  } = {}) {}

  private nativeCatalog(thread: ConversationThread, forceRefresh: boolean): Promise<NativeCatalog> {
    if (this.stopping) return Promise.reject(Error('Application is shutting down'))
    let command: string
    try { command = this.command(thread) } catch { return Promise.resolve({ commands: [], warning: 'Configure the provider in Agent Settings and use Refresh commands to retry.' }) }
    // Account homes, provider executables and exact working directories have distinct catalogs.
    const key = JSON.stringify([thread.provider, command, thread.rootPath, this.options.home ?? homedir(),
      process.env.CODEX_HOME, process.env.CLAUDE_CONFIG_DIR, process.env.PATH ?? process.env.Path])
    const cached = this.catalogs.get(key)
    if (cached && (cached.expiresAt === Infinity || !forceRefresh && cached.expiresAt > Date.now())) return cached.promise
    this.catalogs.delete(key)
    for (const [scope, entry] of this.catalogs) if (entry.expiresAt <= Date.now()) this.catalogs.delete(scope)
    if (this.catalogs.size >= 32) {
      const settled = [...this.catalogs].find(([, entry]) => entry.expiresAt !== Infinity)
      if (settled) this.catalogs.delete(settled[0])
      else return Promise.resolve({ commands: [], warning: 'Command discovery is busy. Use Refresh commands to retry.' })
    }
    const entry = { promise: Promise.resolve<NativeCatalog>({ commands: [] }), expiresAt: Infinity }
    // Schedule after registering the promise so concurrent list/prepare/refresh calls share one process.
    entry.promise = Promise.resolve().then(() => thread.provider === 'claude'
      ? this.claudeCommands(thread, command) : this.codexSkills(thread, command)).then<NativeCatalog, NativeCatalog>(commands => ({ commands }), () => ({
      commands: [], warning: `Could not load ${thread.provider === 'claude' ? 'Claude commands' : 'Codex skills'}. Check the CLI in Agent Settings and use Refresh commands to retry.`
    })).then(result => { entry.expiresAt = Date.now() + (result.warning ? 5000 : 60000); return result })
    this.catalogs.set(key, entry)
    return entry.promise
  }

  private async load(thread: ConversationThread, forceRefresh = false): Promise<{ entries: Map<string, Entry>; warning?: string }> {
    const entries = new Map<string, Entry>()
    const home = this.options.home ?? homedir()
    const { commands, warning } = await this.nativeCatalog(thread, forceRefresh)
    for (const entry of commands) entries.set(entry.name, { ...entry, execution: 'conversation' })
    for (const command of NATIVE_CLI_COMMANDS[thread.provider]) {
      const native = entries.get(command.name)
      entries.set(command.name, { ...command, ...native, execution: thread.provider === 'claude' && native ? 'conversation' : 'cli' })
    }
    if (thread.provider === 'codex') for (const command of CODEX_THREAD_COMMANDS) entries.set(command.name, command)
    else for (const name of ['context', 'compact', 'model']) {
      const entry = entries.get(name)
      if (entry) entries.set(name, { ...entry, execution: 'conversation' })
    }
    // Resolve OXE prompts in this request's scope, never a shared workspace registry.
    for (const folder of [join(home, '.oxe', 'skills'), join(thread.rootPath, '.oxe', 'skills')]) {
      for (const child of await children(folder)) {
        if (!child.endsWith('.md')) continue
        const raw = await textFile(join(folder, child))
        if (!raw) continue
        const skill = parseSkillMarkdown(raw, join(folder, child))
        if (!skill || skill.hidden || skill.agents.length && !skill.agents.includes(thread.provider)) continue
        if (entries.has(skill.name) && entries.get(skill.name)?.source !== 'oxe') continue
        entries.set(skill.name, { name: skill.name, description: skill.description, source: 'oxe', body: skill.body })
      }
    }
    if (!entries.has('compact')) entries.set('compact', { name: 'compact', description: 'Summarize the native conversation context', source: thread.provider, ...(thread.provider === 'claude' ? { argumentHint: 'optional focus' } : {}) })
    for (const [name, entry] of entries) {
      if (hasDesktopCommand(thread.provider, name)) entries.set(name, { ...entry, execution: 'desktop', ...(thread.provider === 'codex' && name === 'mcp' ? { argumentHint: '[reload | login <server>]' } : {}), ...(thread.provider === 'codex' && name === 'plugins' ? { argumentHint: '[install <name> | uninstall <id> | reconcile]' } : {}), ...(thread.provider === 'codex' && name === 'apps' ? { argumentHint: '[app id]' } : {}) })
      else if (entry.execution === 'cli') entries.set(name, { ...entry, execution: 'unavailable', unavailableReason: 'This provider operation is not exposed by the integrated Thread adapter yet.' })
    }
    for (const name of ['effort', 'permissions', 'help', 'accounts', 'settings', 'capabilities', 'delegations', 'delegation']) if (!entries.has(name)) entries.set(name, { name, description: name === 'capabilities' ? 'Show verified Thread capabilities' : name === 'delegations' || name === 'delegation' ? 'Open persistent delegated work' : `Open ${name}`, source: thread.provider, execution: 'desktop' })
    return { entries, warning }
  }

  private async claudeCommands(thread: ConversationThread, command: string): Promise<ThreadCommand[]> {
    if (this.stopping) throw Error('Application is shutting down')
    const transport = (this.options.claudeTransport ?? ((command, cwd) => new AgentProcessTransport(command, [...CLAUDE_THREAD_ARGS, '--no-session-persistence'], cwd)))(command, thread.rootPath)
    this.transports.add(transport)
    try { return await claudeCommandCatalog(transport) }
    finally { this.transports.delete(transport); await transport.close() }
  }

  private async codexSkills(thread: ConversationThread, command: string): Promise<Entry[]> {
    if (this.stopping) throw Error('Application is shutting down')
    const transport = (this.options.transport ?? ((command, cwd) => new AgentProcessTransport(command, ['app-server', '--listen', 'stdio://'], cwd)))(command, thread.rootPath)
    this.transports.add(transport)
    const peer = new AgentRpcPeer(line => transport.write(line), () => {}, message => { if (message.id !== undefined) peer.rejectRequest(message.id) }, 8000)
    transport.onData(chunk => { try { peer.push(chunk) } catch { peer.close() } })
    transport.onClose(() => peer.close())
    try {
      await peer.request('initialize', { clientInfo: { name: 'oxespace', title: 'OXESpace', version: '0.13.0' } })
      peer.notify('initialized')
      const result = record(await peer.request('skills/list', { cwds: [thread.rootPath], forceReload: true }))
      return (Array.isArray(result.data) ? result.data : []).flatMap(value => {
        const skills = record(value).skills
        return (Array.isArray(skills) ? skills : []).flatMap(value => {
          const skill = record(value)
          return typeof skill.name === 'string' && typeof skill.path === 'string' && skill.enabled !== false
            ? [{ name: skill.name, description: typeof skill.description === 'string' ? skill.description : 'Skill', source: 'codex' as const, path: skill.path }] : []
        })
      }).slice(0, 512)
    } finally { peer.close(); this.transports.delete(transport); await transport.close() }
  }

  async list(thread: ConversationThread, forceRefresh = false): Promise<ThreadCommandCatalog> {
    const { entries, warning } = await this.load(thread, forceRefresh)
    return { commands: [...entries.values()].filter(entry => /^[a-z0-9][a-z0-9_:-]*$/i.test(entry.name)).map(({ name, description, source, argumentHint, execution, unavailableReason }) => ({ name, description, source, argumentHint, ...(execution ? { execution } : {}), ...(unavailableReason ? { unavailableReason } : {}) })).sort((a, b) => a.name.localeCompare(b.name)), ...(warning ? { warning } : {}) }
  }

  async prepare(thread: ConversationThread, text: string): Promise<ThreadAgentInput> {
    const match = text.trim().match(/^\/([a-z0-9][a-z0-9_:-]*)(?:\s+([\s\S]*))?$/i)
    if (!match) return { text }
    // Claude handles this native command itself. Command discovery starts an
    // auxiliary CLI and must not delay a command whose behavior is already known.
    if (thread.provider === 'claude' && ['mcp', 'compact', 'context'].includes(match[1])) return { text: text.trim() }
    if (thread.provider === 'codex' && CODEX_THREAD_COMMANDS.some(command => command.name === match[1])) {
      if (['status', 'compact'].includes(match[1]) && match[2]) throw Error(`/${match[1]} does not take arguments in Codex.`)
      return { text: text.trim() }
    }
    const { entries } = await this.load(thread)
    const entry = entries.get(match[1]), argument = match[2] ?? ''
    if (entry?.body !== undefined) return { text: entry.body.includes('{{argument}}') ? entry.body.replace(/\{\{argument\}\}/g, argument) : entry.body + (argument ? `\n\n${argument}` : '') }
    if (entry?.source === 'codex' && entry.path) return { text: `$${entry.name}${argument ? ` ${argument}` : ''}`, skill: { name: entry.name, path: entry.path } }
    if (thread.provider === 'claude' && entry?.execution === 'conversation') return { text: text.trim() }
    // A TUI-only command is offered as an explicit auxiliary action in Thread.
    if (entry?.execution === 'unavailable' || entry?.execution === 'cli') throw Error(`/${match[1]} is not available in Thread yet. ${entry.unavailableReason ?? ''}`)
    if (match[1] === 'compact') {
      if (thread.provider === 'codex' && argument) throw Error('/compact does not take arguments in Codex.')
      return { text: text.trim() }
    }
    if (thread.provider === 'claude' && entry) return { text }
    // Hidden/new commands receive an explicit auxiliary action, never an AI prompt.
    throw Error(`Unknown command: /${match[1]}. Open /help to see available commands.`)
  }

  async stop(): Promise<void> { this.stopping = true; this.catalogs.clear(); await Promise.allSettled([...this.transports].map(transport => transport.close())); this.transports.clear() }
}
