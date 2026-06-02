import { execFileSync as nodeExecFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { delimiter, extname, isAbsolute, join } from 'node:path'
import type { AppDatabase } from '../db/index'
import {
  BUILTIN_PROVIDERS,
  type AgentProfile,
  type AgentProvider,
  type AgentReadiness,
  type CreateAgentProfileInput,
  type UpdateAgentProfileInput
} from '../../../shared/types/agent'

const CACHE_TTL_MS = 1_800_000 // 30 minutes
const OFFICIAL_PROVIDERS: readonly AgentProvider[] = BUILTIN_PROVIDERS
const PROVIDER_ORDER: ReadonlyMap<AgentProvider, number> = new Map(
  OFFICIAL_PROVIDERS.map((provider, index) => [provider, index])
)
const PROVIDER_PLACEHOLDERS = OFFICIAL_PROVIDERS.map(() => '?').join(', ')
const WINDOWS_SCRIPT_EXTENSIONS = new Set(['.cmd', '.bat'])
// Providers whose CLI is the shell itself (executable === command). When the user edits
// the agent command, we sync the shell_profile executable so terminals stay in sync.
// Copilot is intentionally absent — its shell wraps powershell, see migration 005/010.
const SHELL_PROFILE_BY_PROVIDER: Partial<Record<AgentProvider, string>> = {
  claude: 'builtin-claude',
  codex: 'builtin-codex',
  antigravity: 'builtin-antigravity',
  cursor: 'builtin-cursor'
}

interface AgentProfileRow {
  agent_profile_id: string
  name: string
  provider: string
  command: string
  command_template: string
  model: string | null
  role: string | null
  is_builtin: number
  system_prompt: string | null
  parent_provider: string | null
}

interface ReadinessCacheRow {
  provider: string
  status: string
  version: string | null
  details: string | null
  checked_at: number
}

interface AgentServiceOptions {
  execFileSync?: typeof nodeExecFileSync
}

export class AgentService {
  private readonly execFileSync: typeof nodeExecFileSync

  constructor(private readonly db: AppDatabase, options: AgentServiceOptions = {}) {
    this.execFileSync = options.execFileSync ?? nodeExecFileSync
  }

  list(): AgentProfile[] {
    // Built-in providers (claude/copilot/codex/antigravity/cursor) + user-created
    // custom agents. Customs live with provider='custom' and a parent_provider
    // pointing at the CLI they wrap — they need to surface in Settings so the
    // user can edit/delete them and in PaneSessionRow so the icon resolves.
    const rows = this.db
      .prepare(`
        SELECT *
        FROM agent_profiles
        WHERE (is_builtin = 1 AND provider IN (${PROVIDER_PLACEHOLDERS}))
           OR (is_builtin = 0 AND provider = 'custom')
      `)
      .all(...OFFICIAL_PROVIDERS) as AgentProfileRow[]
    return rows
      .sort((a, b) => {
        // Built-ins first (ordered by official provider order), then customs
        // alphabetically — customs share the bottom rank so the order is
        // stable as the user adds more.
        const rankA = providerRank(a.provider as AgentProvider)
        const rankB = providerRank(b.provider as AgentProvider)
        if (rankA !== rankB) return rankA - rankB
        return a.name.localeCompare(b.name)
      })
      .map(mapProfile)
  }

  create(input: CreateAgentProfileInput): AgentProfile {
    const id = randomUUID()
    const now = Date.now()
    this.db.prepare(`
      INSERT INTO agent_profiles
        (agent_profile_id, name, provider, command, command_template, model, role, is_builtin, system_prompt, parent_provider, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)
    `).run(id, input.name, input.provider, input.command, input.commandTemplate, input.model ?? null, input.role ?? null, input.systemPrompt ?? null, input.parentProvider ?? null, now)
    return this.getOrThrow(id)
  }

  update(id: string, input: UpdateAgentProfileInput): AgentProfile {
    const profile = this.getOrThrow(id)
    const nextCommand = input.command ?? profile.command

    const updateProfile = this.db.transaction(() => {
      this.db.prepare(`
        UPDATE agent_profiles
        SET name = ?, command = ?, command_template = ?, model = ?, role = ?, system_prompt = ?, parent_provider = ?
        WHERE agent_profile_id = ?
      `).run(
        profile.isBuiltin ? profile.name : input.name ?? profile.name,
        nextCommand,
        input.commandTemplate ?? profile.commandTemplate,
        input.model !== undefined ? input.model ?? null : profile.model ?? null,
        input.role !== undefined ? input.role ?? null : profile.role ?? null,
        input.systemPrompt !== undefined ? input.systemPrompt ?? null : profile.systemPrompt ?? null,
        input.parentProvider !== undefined ? input.parentProvider ?? null : profile.parentProvider ?? null,
        id
      )

      const shellProfileId = SHELL_PROFILE_BY_PROVIDER[profile.provider]
      if (profile.isBuiltin && shellProfileId) {
        this.db.prepare(`
          UPDATE shell_profiles
          SET executable = ?, args_json = '[]'
          WHERE id = ?
        `).run(nextCommand, shellProfileId)
      }

      this.db.prepare('DELETE FROM agent_readiness_cache WHERE provider = ?').run(profile.provider)
    })
    updateProfile()

    return this.getOrThrow(id)
  }

  delete(id: string): void {
    const profile = this.getOrThrow(id)
    if (profile.isBuiltin) {
      throw new Error('Built-in agent profiles cannot be deleted')
    }
    this.db.prepare('DELETE FROM agent_profiles WHERE agent_profile_id = ?').run(id)
  }

  getCachedReadiness(): AgentReadiness[] {
    const profiles = this.list()
    if (profiles.length === 0) return []

    const cutoff = Date.now() - CACHE_TTL_MS
    const rows = this.db
      .prepare(`
        SELECT *
        FROM agent_readiness_cache
        WHERE checked_at > ? AND provider IN (${PROVIDER_PLACEHOLDERS})
      `)
      .all(cutoff, ...OFFICIAL_PROVIDERS) as ReadinessCacheRow[]

    if (rows.length !== profiles.length) return []

    const commandByProvider = new Map(profiles.map((profile) => [profile.provider, profile.command]))
    return rows
      .sort((a, b) => providerRank(a.provider as AgentProvider) - providerRank(b.provider as AgentProvider))
      .map((row) => mapReadiness(row, commandByProvider.get(row.provider as AgentProvider) ?? row.provider))
  }

  discover(forceRefresh = false): AgentReadiness[] {
    if (!forceRefresh) {
      const cached = this.getCachedReadiness()
      if (cached.length > 0) return cached
    }

    const results: AgentReadiness[] = this.list().map((profile) => this.checkProvider(profile.provider, profile.command))

    const upsert = this.db.prepare(`
      INSERT INTO agent_readiness_cache (provider, status, version, details, checked_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(provider) DO UPDATE SET
        status = excluded.status,
        version = excluded.version,
        details = excluded.details,
        checked_at = excluded.checked_at
    `)

    const now = Date.now()
    const insertAll = this.db.transaction(() => {
      for (const r of results) {
        upsert.run(r.provider, r.status, r.version ?? null, r.details ?? null, now)
      }
    })
    insertAll()

    return results
  }

  private checkProvider(provider: AgentProvider, command: string): AgentReadiness {
    try {
      const resolved = resolveCommand(command, this.execFileSync)
      const output = runCommand(this.execFileSync, resolved.file, ['--version'], resolved.env)
      const version = output.trim().split('\n')[0] ?? undefined
      return { provider, command, status: 'ready', version }
    } catch (error) {
      return { provider, command, status: 'missing', details: toMessage(error) }
    }
  }

  private getOrThrow(id: string): AgentProfile {
    const row = this.db
      .prepare('SELECT * FROM agent_profiles WHERE agent_profile_id = ?')
      .get(id) as AgentProfileRow | undefined
    if (!row) throw new Error(`Agent profile not found: ${id}`)
    return mapProfile(row)
  }
}

function runCommand(
  execFileSync: typeof nodeExecFileSync,
  command: string,
  args: string[],
  env: NodeJS.ProcessEnv = process.env
): string {
  if (process.platform === 'win32' && WINDOWS_SCRIPT_EXTENSIONS.has(extname(command).toLowerCase())) {
    return execFileSync(command, args, {
      timeout: 2000,
      encoding: 'utf8',
      shell: true,
      windowsHide: true,
      env
    })
  }

  return execFileSync(command, args, {
        timeout: 2000,
        encoding: 'utf8',
    windowsHide: true,
    env
      })
}

function resolveCommand(command: string, execFileSync: typeof nodeExecFileSync): { file: string; env: NodeJS.ProcessEnv } {
  if (process.platform !== 'win32') return { file: command, env: process.env }
  const env = { ...process.env, PATH: augmentWindowsPath(process.env.PATH ?? '') }
  if (isAbsolute(command) && existsSync(command)) return { file: command, env }

  const fromWhere = findWithWhere(command, execFileSync, env)
  if (fromWhere.length > 0) return { file: preferWindowsShim(fromWhere), env }

  const fromPath = findOnWindowsPath(command, env.PATH ?? '')
  return { file: fromPath ?? command, env }
}

function augmentWindowsPath(pathValue: string): string {
  const extras = [
    process.env.APPDATA ? join(process.env.APPDATA, 'npm') : null,
    process.env.LOCALAPPDATA ? join(process.env.LOCALAPPDATA, 'Programs') : null
  ].filter((value): value is string => Boolean(value))

  const parts = pathValue.split(delimiter).filter(Boolean)
  for (const extra of extras) {
    if (!parts.some((part) => part.toLowerCase() === extra.toLowerCase())) parts.push(extra)
  }
  return parts.join(delimiter)
}

function findWithWhere(command: string, execFileSync: typeof nodeExecFileSync, env: NodeJS.ProcessEnv): string[] {
  try {
    return execFileSync('where.exe', [command], {
      timeout: 2000,
      encoding: 'utf8',
      windowsHide: true,
      env
    }).split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
  } catch {
    return []
  }
}

function findOnWindowsPath(command: string, pathValue: string): string | null {
  const extensions = ['', '.exe', '.cmd', '.bat', '.ps1']
  const hasExtension = extname(command) !== ''
  for (const pathPart of pathValue.split(delimiter).filter(Boolean)) {
    const base = join(pathPart, command)
    const candidates = hasExtension ? [base] : extensions.map((extension) => `${base}${extension}`)
    for (const candidate of candidates) {
      if (existsSync(candidate)) return candidate
    }
  }
  return null
}

function preferWindowsShim(candidates: string[]): string {
  return candidates.find((candidate) => extname(candidate).toLowerCase() === '.cmd')
    ?? candidates.find((candidate) => extname(candidate).toLowerCase() === '.exe')
    ?? candidates[0]
}

function mapProfile(row: AgentProfileRow): AgentProfile {
  return {
    agentProfileId: row.agent_profile_id,
    name: row.name,
    provider: row.provider as AgentProvider,
    command: row.command,
    commandTemplate: row.command_template,
    model: row.model ?? undefined,
    role: row.role ?? undefined,
    isBuiltin: row.is_builtin === 1,
    systemPrompt: row.system_prompt ?? undefined,
    parentProvider: (row.parent_provider as AgentProvider) ?? undefined
  }
}

function mapReadiness(row: ReadinessCacheRow, command: string): AgentReadiness {
  return {
    provider: row.provider as AgentProvider,
    command,
    status: row.status as AgentReadiness['status'],
    version: row.version ?? undefined,
    details: row.details ?? undefined
  }
}

function toMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Command failed'
}

function providerRank(provider: AgentProvider): number {
  return PROVIDER_ORDER.get(provider) ?? PROVIDER_ORDER.size
}
