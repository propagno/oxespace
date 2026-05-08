import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import type { AppDatabase } from '../db/index'
import type {
  AgentProfile,
  AgentProvider,
  AgentReadiness,
  CreateAgentProfileInput,
  UpdateAgentProfileInput
} from '../../../shared/types/agent'

const CACHE_TTL_MS = 1_800_000 // 30 minutes

const PROVIDERS: Array<{ provider: AgentProvider; command: string }> = [
  { provider: 'claude',     command: 'claude'  },
  { provider: 'gh-copilot', command: 'gh'      },
  { provider: 'codex',      command: 'codex'   },
  { provider: 'gemini',     command: 'gemini'  },
  { provider: 'cursor',     command: 'cursor'  },
]

interface AgentProfileRow {
  agent_profile_id: string
  name: string
  provider: string
  command: string
  command_template: string
  model: string | null
  role: string | null
  is_builtin: number
}

interface ReadinessCacheRow {
  provider: string
  status: string
  version: string | null
  details: string | null
  checked_at: number
}

export class AgentService {
  constructor(private readonly db: AppDatabase) {}

  list(): AgentProfile[] {
    const rows = this.db
      .prepare('SELECT * FROM agent_profiles ORDER BY is_builtin DESC, name ASC')
      .all() as AgentProfileRow[]
    return rows.map(mapProfile)
  }

  create(input: CreateAgentProfileInput): AgentProfile {
    const id = randomUUID()
    const now = Date.now()
    this.db.prepare(`
      INSERT INTO agent_profiles
        (agent_profile_id, name, provider, command, command_template, model, role, is_builtin, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?)
    `).run(id, input.name, input.provider, input.command, input.commandTemplate, input.model ?? null, input.role ?? null, now)
    return this.getOrThrow(id)
  }

  update(id: string, input: UpdateAgentProfileInput): AgentProfile {
    const profile = this.getOrThrow(id)
    this.db.prepare(`
      UPDATE agent_profiles
      SET name = ?, command = ?, command_template = ?, model = ?, role = ?
      WHERE agent_profile_id = ?
    `).run(
      input.name ?? profile.name,
      input.command ?? profile.command,
      input.commandTemplate ?? profile.commandTemplate,
      input.model !== undefined ? input.model ?? null : profile.model ?? null,
      input.role !== undefined ? input.role ?? null : profile.role ?? null,
      id
    )
    return this.getOrThrow(id)
  }

  delete(id: string): void {
    this.db.prepare('DELETE FROM agent_profiles WHERE agent_profile_id = ?').run(id)
  }

  getCachedReadiness(): AgentReadiness[] {
    const cutoff = Date.now() - CACHE_TTL_MS
    const rows = this.db
      .prepare('SELECT * FROM agent_readiness_cache WHERE checked_at > ?')
      .all(cutoff) as ReadinessCacheRow[]

    if (rows.length === PROVIDERS.length) {
      return rows.map(mapReadiness)
    }
    return []
  }

  discover(forceRefresh = false): AgentReadiness[] {
    if (!forceRefresh) {
      const cached = this.getCachedReadiness()
      if (cached.length > 0) return cached
    }

    const results: AgentReadiness[] = PROVIDERS.map(({ provider, command }) =>
      this.checkProvider(provider, command)
    )

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
      const output = execFileSync(command, ['--version'], {
        timeout: 2000,
        encoding: 'utf8',
        windowsHide: true
      })
      const version = output.trim().split('\n')[0] ?? undefined

      if (provider === 'claude') {
        const apiKey = process.env.ANTHROPIC_API_KEY
        if (!apiKey || apiKey.trim() === '') {
          return { provider, command, status: 'partial', version, details: 'Installed but not authenticated' }
        }
      }

      return { provider, command, status: 'ready', version }
    } catch {
      return { provider, command, status: 'missing' }
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

function mapProfile(row: AgentProfileRow): AgentProfile {
  return {
    agentProfileId: row.agent_profile_id,
    name: row.name,
    provider: row.provider as AgentProvider,
    command: row.command,
    commandTemplate: row.command_template,
    model: row.model ?? undefined,
    role: row.role ?? undefined,
    isBuiltin: row.is_builtin === 1
  }
}

function mapReadiness(row: ReadinessCacheRow): AgentReadiness {
  return {
    provider: row.provider as AgentProvider,
    command: PROVIDERS.find(p => p.provider === row.provider)?.command ?? row.provider,
    status: row.status as AgentReadiness['status'],
    version: row.version ?? undefined,
    details: row.details ?? undefined
  }
}
