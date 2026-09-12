import { execFile } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, writeFile, copyFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { promisify } from 'node:util'
import hookSource from '../../../../resources/memory/agent-hook.cjs?raw'
import type { MemoryContext, MemorySession, MemorySettings } from '../../../../shared/types/memory'
import { MemoryRuntime, memoryEnvironment, readJson, writePrivateJson } from './memory-runtime'

const exec = promisify(execFile)
const adapters = [
  { agent: 'claude-code', hooks: () => join(process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude'), 'settings.json') },
  { agent: 'codex', hooks: () => join(process.env.CODEX_HOME || join(homedir(), '.codex'), 'hooks.json') }
] as const

export class AgentMemoryAdapters {
  private setupPending: Promise<void> | null = null
  constructor(private readonly runtime: MemoryRuntime, private readonly targets: ReadonlyArray<{ agent: 'claude-code' | 'codex'; hooks: () => string }> = adapters) {}

  async finalize(context: MemoryContext, session: MemorySession): Promise<void> {
    // Exactly one observed native session. Never use latest/all or infer transcripts.
    await exec(this.runtime.settings().executable, ['--data-dir', this.runtime.dataDir, '--config', this.runtime.configPath,
      'finalize-session', '--agent', session.agentId, '--workspace', context.workspace, '--project', context.project,
      '--session-id', nativeSessionUuid(session.sessionId), '--json'],
    { cwd: session.cwd, windowsHide: true, timeout: 5000, env: { ...memoryEnvironment(), AI_MEMORY_AUTH_TOKEN: this.runtime.token() } })
  }

  async marker(context: MemoryContext, settings: MemorySettings): Promise<void> {
    const path = join(context.cwd, '.ai-memory.toml')
    const signature = '# Managed by OXESpace project memory'
    let old = ''
    try { old = await readFile(path, 'utf8') } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
    const scope = `workspace = "${context.workspace}"\nproject = "${context.project}"`
    if (old && !old.startsWith(signature)) {
      // User-owned policy is authoritative. Do not replace or silently broaden it.
      if (!old.includes(scope)) throw new Error(`Existing .ai-memory.toml has a different scope at ${context.cwd}`)
      return
    }
    if (old && !old.includes(scope)) throw new Error('Checkout memory identity changed; reassociate explicitly')
    if (old) return // Preserve user additions, including capture exclusions.
    const text = `${signature}\n${scope}\n\n[briefing]\ninject_on_session_start = ${settings.automaticContext}\nmax_chars = 4000\n`
    if (text !== old) await writeFile(path, text, { mode: 0o600 })
  }

  setup(): Promise<void> {
    if (!this.setupPending) this.setupPending = this.installHooks().finally(() => { this.setupPending = null })
    return this.setupPending
  }
  private async installHooks(): Promise<void> {
    const directory = join(this.runtime.directory, 'adapters')
    await mkdir(directory, { recursive: true })
    const script = join(directory, 'oxespace-memory-hook.cjs')
    await writeFile(script, hookSource, { mode: 0o600 })
    for (const adapter of this.targets) {
      // Ask the official installer for the actual supported event set/schema.
      const generated = join(directory, `${adapter.agent}-${randomUUID()}.json`)
      await exec(this.runtime.settings().executable, ['--data-dir', this.runtime.dataDir, '--config', this.runtime.configPath,
        'install-hooks', '--agent', adapter.agent, '--server-url', this.runtime.settings().url, '--config-file', generated, '--apply'],
      { windowsHide: true, timeout: 15000, env: memoryEnvironment() })
      const native = await readJson(generated)
      const nativeHooks = native.hooks as Record<string, unknown>
      if (!nativeHooks?.SessionStart || !nativeHooks?.SessionEnd) throw new Error(`${adapter.agent} native hooks missing required events`)
      const target = adapter.hooks()
      await mkdir(dirname(target), { recursive: true })
      const doc = await readJson(target)
      if (doc.hooks !== undefined && (!doc.hooks || typeof doc.hooks !== 'object' || Array.isArray(doc.hooks))) throw new Error('Existing hooks configuration is malformed')
      const hooks = { ...(doc.hooks as Record<string, unknown> ?? {}) }
      for (const event of Object.keys(nativeHooks)) {
        const entries = hooks[event] ?? []
        if (!Array.isArray(entries)) throw new Error(`Existing ${event} hooks are malformed`)
        const ours = (entry: unknown): boolean => JSON.stringify(entry).includes('oxespace-memory-hook.cjs')
        const eventName = event.replace(/([a-z])([A-Z])/g, '$1-$2').toLowerCase()
        const quote = (s: string): string => `'${s.replace(/'/g, process.platform === 'win32' ? "''" : "'\\''")}'`
        // Claude supports exec form on Windows; Codex uses a PowerShell command string.
        const handler = process.platform === 'win32' && adapter.agent === 'claude-code'
          ? { type: 'command', command: 'node', args: [script, eventName, adapter.agent] }
          : { type: 'command', command: `${process.platform === 'win32' ? '& ' : ''}node ${quote(script)} ${eventName} ${adapter.agent}` }
        const preserved = entries.flatMap(entry => {
          if (!ours(entry)) {
            if (/ai-memory.*\bhook\b/.test(JSON.stringify(entry))) throw new Error('Existing native AI Memory hooks require explicit migration before OXESpace setup')
            return [entry]
          }
          if (!entry || !Array.isArray(entry.hooks)) throw new Error('Existing managed hook is malformed')
          const remaining = entry.hooks.filter((hook: unknown) => !ours(hook))
          return remaining.length ? [{ ...entry, hooks: remaining }] : []
        })
        hooks[event] = [...preserved, { matcher: '', hooks: [handler] }]
      }
      const next = { ...doc, hooks }
      if (JSON.stringify(next) !== JSON.stringify(doc)) {
        if (Object.keys(doc).length) await copyFile(target, `${target}.oxespace-${Date.now()}.bak`)
        await writePrivateJson(target, next)
      }
    }
  }
}

/** AI Memory router::resolve_native_session_id: UUID or UUIDv5(OID, raw ID). */
export function nativeSessionUuid(id: string): string {
  if (/^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i.test(id)) return id.toLowerCase()
  const digest = createHash('sha1').update(Buffer.from('6ba7b8129dad11d180b400c04fd430c8', 'hex')).update(id).digest().subarray(0, 16)
  digest[6] = (digest[6] & 0x0f) | 0x50
  digest[8] = (digest[8] & 0x3f) | 0x80
  const hex = digest.toString('hex')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}
