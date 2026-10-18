import type { AppDatabase } from '../../db'
import type { AgentAccess, ConnectionEnvironment, OxeQueryPreferences } from '../../../../shared/types/oxequery'

export const DEFAULT_PREFERENCES: OxeQueryPreferences = {
  historyLimit: 200,
  auditRetentionDays: 90,
  // The most an agent may be given on a connection of each kind, whatever the connection itself says.
  agentCeiling: { local: 'write', dev: 'write', prod: 'read' }
}

const ACCESS: AgentAccess[] = ['off', 'read', 'write']
const ENVIRONMENTS: ConnectionEnvironment[] = ['local', 'dev', 'prod']
export class PreferenceInputError extends Error {}

const rank = (access: AgentAccess): number => ACCESS.indexOf(access)

/** The lower of what a connection allows and what its kind of environment allows. */
export function effectiveAgentAccess(connection: AgentAccess, ceiling: AgentAccess): AgentAccess {
  return rank(connection) <= rank(ceiling) ? connection : ceiling
}

/** A complete, valid set of preferences from whatever was stored or sent; anything wrong falls back to the default. */
export function normalizePreferences(value: unknown, strict = false): OxeQueryPreferences {
  const raw = value && typeof value === 'object' ? value as Record<string, unknown> : {}
  const bad = (message: string): never => { throw new PreferenceInputError(message) }
  const integer = (entry: unknown, min: number, max: number, fallback: number, label: string): number => {
    if (entry === undefined) return fallback
    if (!Number.isInteger(entry) || (entry as number) < min || (entry as number) > max) { if (strict) bad(`${label} must be between ${min} and ${max}.`); return fallback }
    return entry as number
  }
  const ceilings = raw.agentCeiling && typeof raw.agentCeiling === 'object' ? raw.agentCeiling as Record<string, unknown> : {}
  const agentCeiling = { ...DEFAULT_PREFERENCES.agentCeiling }
  for (const environment of ENVIRONMENTS) {
    const entry = ceilings[environment]
    if (entry === undefined) continue
    if (!ACCESS.includes(entry as AgentAccess)) { if (strict) bad('Agent access must be off, read or write.'); continue }
    agentCeiling[environment] = entry as AgentAccess
  }
  // Agents never write to production, whatever is chosen.
  if (agentCeiling.prod === 'write') agentCeiling.prod = 'read'
  return {
    historyLimit: integer(raw.historyLimit, 20, 5000, DEFAULT_PREFERENCES.historyLimit, 'The history length'),
    auditRetentionDays: integer(raw.auditRetentionDays, 7, 730, DEFAULT_PREFERENCES.auditRetentionDays, 'The audit retention'),
    agentCeiling
  }
}

/** OxeQuery's own settings, kept as one JSON value in the app database. */
export class PreferenceStore {
  private cached: OxeQueryPreferences | null = null
  constructor(private readonly db: AppDatabase) {}

  get(): OxeQueryPreferences {
    if (this.cached) return this.cached
    const row = this.db.prepare("SELECT value FROM oxequery_preferences WHERE key = 'all'").get() as { value: string } | undefined
    let stored: unknown = {}
    try { stored = row ? JSON.parse(row.value) : {} } catch { /* unreadable: defaults */ }
    this.cached = normalizePreferences(stored)
    return this.cached
  }

  set(patch: unknown): OxeQueryPreferences {
    const input = patch && typeof patch === 'object' ? patch as Record<string, unknown> : {}
    const current = this.get()
    const next = normalizePreferences({
      ...current, ...input,
      agentCeiling: { ...current.agentCeiling, ...(input.agentCeiling && typeof input.agentCeiling === 'object' ? input.agentCeiling as object : {}) }
    }, true)
    this.db.prepare("INSERT INTO oxequery_preferences (key, value) VALUES ('all', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(JSON.stringify(next))
    this.cached = next
    return next
  }
}
