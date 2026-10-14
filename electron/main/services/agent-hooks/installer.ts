/**
 * Installs and removes OXESpace's status hook in the agents' own config files
 * (`~/.claude/settings.json`, `~/.codex/hooks.json`).
 *
 * These files are user-global and shared with other tools, so the rules are
 * conservative: user entries are never reordered or removed, a file we cannot
 * parse is left untouched, a write is skipped when nothing changed, and one
 * rolling backup precedes any change. Events are written only for an agent
 * version that knows them (see events.ts) because Claude discards the whole
 * settings file on an unknown event name.
 */
import { execFile } from 'node:child_process'
import { copyFile, mkdir, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import type { AgentHookAgent, AgentHooksStatus } from '../../../../shared/types/agent-hooks'
import { readJson, writePrivateJson } from '../memory/memory-runtime'
import { claudeEventPlan, codexEventPlan, parseVersion, type HookEventPlan } from './events'

export const STATUS_HOOK_FILE = 'oxespace-status-hook.cjs'
const BACKUP_SUFFIX = '.oxespace-status.bak'

export interface AgentHookInstallerOptions {
  /** Private directory the hook script is written to (e.g. <userData>/agent-hooks). */
  directory: string
  scriptSource: string
  targets?: Record<AgentHookAgent, () => string>
  probeClaudeVersion?: () => Promise<string | null>
  platform?: NodeJS.Platform
}

const DEFAULT_TARGETS: Record<AgentHookAgent, () => string> = {
  'claude-code': () => join(process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude'), 'settings.json'),
  codex: () => join(process.env.CODEX_HOME || join(homedir(), '.codex'), 'hooks.json')
}

function defaultProbeClaudeVersion(): Promise<string | null> {
  return new Promise((resolve) => {
    try {
      execFile(
        'claude',
        ['--version'],
        { timeout: 5000, windowsHide: true, shell: process.platform === 'win32' },
        (error, stdout, stderr) => resolve(error ? null : parseVersion(`${stdout}\n${stderr}`))
      )
    } catch {
      resolve(null)
    }
  })
}

const isOurs = (value: unknown): boolean => JSON.stringify(value ?? null).includes(STATUS_HOOK_FILE)
const quote = (s: string, platform: NodeJS.Platform): string =>
  `'${s.replace(/'/g, platform === 'win32' ? "''" : "'\\''")}'`

type HookEntry = { matcher?: string; hooks?: unknown[]; [key: string]: unknown }

export class AgentHookInstaller {
  private readonly targets: Record<AgentHookAgent, () => string>
  private readonly platform: NodeJS.Platform

  constructor(private readonly options: AgentHookInstallerOptions) {
    this.targets = options.targets ?? DEFAULT_TARGETS
    this.platform = options.platform ?? process.platform
  }

  get scriptPath(): string {
    return join(this.options.directory, STATUS_HOOK_FILE)
  }

  private async plan(agent: AgentHookAgent): Promise<{ install: HookEventPlan[]; retire: string[] }> {
    if (agent === 'codex') return { install: codexEventPlan(), retire: [] }
    const version = await (this.options.probeClaudeVersion ?? defaultProbeClaudeVersion)()
    const install = claudeEventPlan(version)
    // An unresolved version is no evidence of an old Claude, so it retires
    // nothing; only a known version strips events it cannot take.
    if (!parseVersion(version)) return { install, retire: [] }
    const known = new Set(install.map((e) => e.eventName))
    return { install, retire: claudeEventPlan('999.0.0').map((e) => e.eventName).filter((n) => !known.has(n)) }
  }

  private handler(agent: AgentHookAgent): Record<string, unknown> {
    const script = this.scriptPath
    // Claude takes exec form on Windows (no shell quoting); Codex gets a
    // PowerShell command string there; POSIX takes a sh command string.
    if (this.platform === 'win32' && agent === 'claude-code') {
      return { type: 'command', command: 'node', args: [script, agent] }
    }
    const prefix = this.platform === 'win32' ? '& ' : ''
    return { type: 'command', command: `${prefix}node ${quote(script, this.platform)} ${agent}` }
  }

  private async load(agent: AgentHookAgent): Promise<{ path: string; doc: Record<string, unknown>; hooks: Record<string, unknown> }> {
    const path = this.targets[agent]()
    const doc = await readJson(path)
    if (doc.hooks !== undefined && (!doc.hooks || typeof doc.hooks !== 'object' || Array.isArray(doc.hooks))) {
      throw new Error('The existing hooks configuration is malformed.')
    }
    return { path, doc, hooks: { ...((doc.hooks as Record<string, unknown> | undefined) ?? {}) } }
  }

  /** Entry list for an event with our handler stripped; throws if it is malformed. */
  private stripOurs(event: string, entries: unknown): unknown[] {
    if (entries === undefined) return []
    if (!Array.isArray(entries)) throw new Error(`The existing ${event} hooks are malformed.`)
    return entries.flatMap((entry: HookEntry) => {
      if (!isOurs(entry)) return [entry]
      if (!entry || !Array.isArray(entry.hooks)) throw new Error(`A managed ${event} hook is malformed.`)
      const rest = entry.hooks.filter((hook) => !isOurs(hook))
      return rest.length ? [{ ...entry, hooks: rest }] : []
    })
  }

  private async commit(path: string, before: Record<string, unknown>, after: Record<string, unknown>): Promise<void> {
    if (JSON.stringify(before) === JSON.stringify(after)) return
    await mkdir(dirname(path), { recursive: true })
    if (Object.keys(before).length) await copyFile(path, `${path}${BACKUP_SUFFIX}`).catch(() => undefined)
    await writePrivateJson(path, after)
  }

  async install(agent: AgentHookAgent): Promise<AgentHooksStatus> {
    try {
      await mkdir(this.options.directory, { recursive: true })
      await writeFile(this.scriptPath, this.options.scriptSource, { mode: 0o600 })
      const { install, retire } = await this.plan(agent)
      const { path, doc, hooks } = await this.load(agent)
      const handler = this.handler(agent)

      for (const { eventName, matcher } of install) {
        const kept = this.stripOurs(eventName, hooks[eventName])
        hooks[eventName] = [...kept, { ...(matcher ? { matcher } : {}), hooks: [handler] }]
      }
      for (const eventName of retire) {
        const kept = this.stripOurs(eventName, hooks[eventName])
        if (kept.length) hooks[eventName] = kept
        else delete hooks[eventName]
      }
      await this.commit(path, doc, { ...doc, hooks })
    } catch (error) {
      return { agent, state: 'error', missing: [], detail: error instanceof Error ? error.message : String(error) }
    }
    return this.status(agent)
  }

  async remove(agent: AgentHookAgent): Promise<AgentHooksStatus> {
    try {
      const { path, doc, hooks } = await this.load(agent)
      for (const event of Object.keys(hooks)) {
        const kept = this.stripOurs(event, hooks[event])
        if (kept.length) hooks[event] = kept
        else delete hooks[event]
      }
      const next: Record<string, unknown> = { ...doc, hooks }
      if (Object.keys(hooks).length === 0 && doc.hooks !== undefined) delete next.hooks
      await this.commit(path, doc, next)
    } catch (error) {
      return { agent, state: 'error', missing: [], detail: error instanceof Error ? error.message : String(error) }
    }
    return this.status(agent)
  }

  async status(agent: AgentHookAgent): Promise<AgentHooksStatus> {
    try {
      const { install } = await this.plan(agent)
      const { hooks } = await this.load(agent)
      const present = new Set(Object.keys(hooks).filter((event) => isOurs(hooks[event])))
      const missing = install.map((e) => e.eventName).filter((name) => !present.has(name))
      const state = present.size === 0 ? 'not_installed' : missing.length === 0 ? 'installed' : 'partial'
      return { agent, state, missing: state === 'not_installed' ? [] : missing, detail: null }
    } catch (error) {
      return { agent, state: 'error', missing: [], detail: error instanceof Error ? error.message : String(error) }
    }
  }
}
