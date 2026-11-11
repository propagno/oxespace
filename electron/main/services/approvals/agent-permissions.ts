/**
 * F7 A55 / U7.4 (SECURITY): "What agents can do". One read model of what agents may do here: the rules OXESpace
 * added (from AlwaysAllow), each database connection's agent access, the HTTP hosts agents called today and the
 * Policy rows. Rules, database access and hosts are revocable, each with an undo that works once; Policy rows are
 * read only, a production connection offers only none and read, and a Policy host deny always wins.
 */
import { randomUUID } from 'node:crypto'
import type { LoadedPolicy } from '../../../../shared/policy'
import {
  AGENT_HOST_ACCESS_LEVELS,
  type AgentHostAccess,
  type AgentHostDecision,
  type AgentPermissionPolicyRow,
  type AgentPermissionsChange,
  type AgentPermissionsPage,
  type AgentPermissionsUndo
} from '../../../../shared/types/agent-permissions'
import { AGENT_ACCESS_LEVELS, type AgentAccess } from '../../../../shared/types/oxequery'
import type { AppDatabase } from '../../db'
import type { AlwaysAllow } from './always-allow'

export interface AgentPermissionsDatabaseSource {
  list: () => { id: string; name: string; env: string; access: string }[]
  setAccess: (id: string, access: AgentAccess) => void
}

export interface AgentPermissionsHostSource {
  /** The hosts agents called (H1), with today's count. */
  observed: (workspaceId: string) => { host: string; callsToday: number; production: boolean; insecure: boolean }[]
  get: (workspaceId: string, host: string) => AgentHostAccess
  set: (workspaceId: string, host: string, access: AgentHostAccess) => void
}

export interface AgentPermissionsDeps {
  alwaysAllow: Pick<AlwaysAllow, 'list' | 'revoke'>
  databases: AgentPermissionsDatabaseSource
  hosts: AgentPermissionsHostSource
  policy: (workspaceId?: string) => AgentPermissionPolicyRow[]
  /** Called after any change, so the window can refresh the page. */
  onChanged?: () => void
}

/** At most this many undos are kept; the oldest goes first. */
const MAX_UNDOS = 50
const PRODUCTION_ENVS = new Set(['prod', 'production'])

function normalizeHost(host: string): string {
  return host.trim().toLowerCase().replace(/\.$/, '')
}

/** `*.bank.example` matches any subdomain of bank.example (and bank.example itself); otherwise an exact host. */
function hostMatches(pattern: string, host: string): boolean {
  const p = normalizeHost(pattern)
  if (!p) return false
  if (p === '*') return true
  if (p.startsWith('*.')) {
    const base = p.slice(2)
    return host === base || host.endsWith(`.${base}`)
  }
  return host === p
}

export class AgentPermissions {
  private readonly undos = new Map<string, () => { ok: boolean }>()

  constructor(private readonly deps: AgentPermissionsDeps) {}

  list(input: { workspaceId: string }): AgentPermissionsPage {
    const rules = this.deps.alwaysAllow.list().map(rule => ({
      id: rule.id,
      provider: rule.provider,
      text: rule.text,
      scope: rule.scope,
      ...(rule.project ? { project: rule.project } : {}),
      addedAt: rule.addedAt
    }))
    const databases = this.deps.databases.list().map(db => ({ id: db.id, name: db.name, env: db.env, access: db.access }))
    const hosts = this.deps.hosts.observed(input.workspaceId).map(observed => ({
      host: observed.host,
      access: this.deps.hosts.get(input.workspaceId, observed.host),
      callsToday: observed.callsToday,
      production: observed.production,
      insecure: observed.insecure
    }))
    const policy = this.deps.policy(input.workspaceId).map(row => ({ section: row.section, text: row.text }))
    return { rules, databases, hosts, policy }
  }

  revokeRule(id: string): AgentPermissionsChange {
    if (typeof id !== 'string' || !id) return { ok: false, code: 'permissions.notFound' }
    if (id.startsWith('policy:')) return { ok: false, code: 'permissions.policy.readOnly' }
    const revoked = this.deps.alwaysAllow.revoke(id)
    if (!revoked.ok) return { ok: false, code: revoked.code === 'approvals.refused.notPending' ? 'permissions.notFound' : revoked.code }
    return this.changed(revoked.restore)
  }

  setDatabaseAccess(input: { id: string; access: AgentAccess }): AgentPermissionsChange {
    if (!(AGENT_ACCESS_LEVELS as readonly string[]).includes(input?.access)) return { ok: false, code: 'permissions.access.invalid' }
    const db = this.deps.databases.list().find(item => item.id === input.id)
    if (!db) return { ok: false, code: 'permissions.notFound' }
    if (PRODUCTION_ENVS.has(db.env) && input.access === 'write') return { ok: false, code: 'permissions.production.readOnly' }
    const previous = (AGENT_ACCESS_LEVELS as readonly string[]).includes(db.access) ? db.access as AgentAccess : 'off'
    this.deps.databases.setAccess(db.id, input.access)
    return this.changed(() => {
      this.deps.databases.setAccess(db.id, previous)
      return { ok: true }
    })
  }

  setHostAccess(input: { workspaceId: string; host: string; access: AgentHostAccess }): AgentPermissionsChange {
    if (!AGENT_HOST_ACCESS_LEVELS.includes(input?.access)) return { ok: false, code: 'permissions.access.invalid' }
    const host = normalizeHost(input.host ?? '')
    if (!host) return { ok: false, code: 'permissions.notFound' }
    const previous = this.deps.hosts.get(input.workspaceId, host)
    this.deps.hosts.set(input.workspaceId, host, input.access)
    return this.changed(() => {
      this.deps.hosts.set(input.workspaceId, host, previous)
      return { ok: true }
    })
  }

  /** What the next agent call to this host gets. A Policy deny wins over whatever the page says. */
  hostDecision(input: { workspaceId: string; host: string }): AgentHostDecision {
    const host = normalizeHost(input.host)
    if (this.policyDenies(host, input.workspaceId)) return 'deny'
    const access = this.deps.hosts.get(input.workspaceId, host)
    if (access === 'blocked') return 'deny'
    if (access === 'ask') return 'ask'
    return 'allow'
  }

  undo(token: string): AgentPermissionsUndo {
    const restore = this.undos.get(token)
    if (!restore) return { ok: false, code: 'permissions.undo.expired' }
    this.undos.delete(token)
    const result = restore()
    if (!result.ok) return { ok: false, code: 'permissions.undo.expired' }
    this.deps.onChanged?.()
    return { ok: true }
  }

  private policyDenies(host: string, workspaceId?: string): boolean {
    for (const row of this.deps.policy(workspaceId)) {
      if (row.section !== 'hosts') continue
      const match = /^\s*deny\s+(.+)$/i.exec(row.text)
      if (!match) continue
      if (match[1].split(/[\s,]+/).some(pattern => hostMatches(pattern, host))) return true
    }
    return false
  }

  private changed(restore: () => { ok: boolean }): { ok: true; undoToken: string } {
    const token = randomUUID()
    this.undos.set(token, restore)
    while (this.undos.size > MAX_UNDOS) {
      const oldest = this.undos.keys().next().value
      if (oldest === undefined) break
      this.undos.delete(oldest)
    }
    this.deps.onChanged?.()
    return { ok: true, undoToken: token }
  }
}

let activePermissions: {
  permissions: AgentPermissions
  workspaceForRoot: (rootPath: string) => string | undefined
} | null = null

export function setActiveAgentPermissions(
  next: { permissions: AgentPermissions; workspaceForRoot: (rootPath: string) => string | undefined } | null
): void {
  activePermissions = next
}

export function activeHostDecision(rootPath: string, host: string): AgentHostDecision {
  if (!activePermissions) return 'allow'
  const workspaceId = activePermissions.workspaceForRoot(rootPath) ?? ''
  return activePermissions.permissions.hostDecision({ workspaceId, host })
}

export function createSqliteDatabaseSource(db: AppDatabase): AgentPermissionsDatabaseSource {
  return {
    list: () => {
      try {
        const rows = db.prepare(
          'SELECT id, name, environment, agent_access FROM oxequery_connections ORDER BY favorite DESC, name ASC'
        ).all() as Array<{ id: string; name: string; environment: string; agent_access: string }>
        return rows.map(row => ({
          id: row.id,
          name: row.name,
          env: row.environment === 'prod' ? 'production' : row.environment,
          access: row.agent_access
        }))
      } catch {
        return []
      }
    },
    setAccess: (id, access) => {
      db.prepare('UPDATE oxequery_connections SET agent_access = ? WHERE id = ?').run(access, id)
    }
  }
}

export function createSqliteHostSource(deps: {
  db: AppDatabase
  isProductionHost?: (workspaceId: string, host: string) => boolean
  now?: () => number
}): AgentPermissionsHostSource {
  const settingsKey = (workspaceId: string) => `agent_host_access:${workspaceId}`
  const readMap = (workspaceId: string): Record<string, AgentHostAccess> => {
    try {
      const row = deps.db.prepare('SELECT value FROM thread_settings WHERE key = ?').get(settingsKey(workspaceId)) as { value: string } | undefined
      if (!row?.value) return {}
      const parsed = JSON.parse(row.value) as Record<string, unknown>
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
      const out: Record<string, AgentHostAccess> = {}
      for (const [k, v] of Object.entries(parsed)) {
        if (AGENT_HOST_ACCESS_LEVELS.includes(v as AgentHostAccess)) out[normalizeHost(k)] = v as AgentHostAccess
      }
      return out
    } catch {
      return {}
    }
  }

  return {
    observed: (workspaceId: string) => {
      const nowTime = (deps.now ?? Date.now)()
      const d = new Date(nowTime)
      const sinceMidnight = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
      const isProd = deps.isProductionHost ?? (() => false)
      const saved = readMap(workspaceId)
      const result = new Map<string, { host: string; callsToday: number; production: boolean; insecure: boolean }>()
      try {
        const rows = deps.db.prepare(`
          SELECT LOWER(host) AS host, COUNT(*) AS calls_today, MAX(insecure) AS insecure, MAX(plain_http_external) AS plain_http
          FROM agent_http_audit
          WHERE workspace_id = ? AND ts >= ?
          GROUP BY LOWER(host)
          ORDER BY calls_today DESC, host ASC
        `).all(workspaceId, sinceMidnight) as Array<{ host: string; calls_today: number; insecure: number; plain_http: number }>
        for (const row of rows) {
          const host = normalizeHost(row.host)
          if (!host) continue
          result.set(host, {
            host,
            callsToday: Number(row.calls_today) || 0,
            production: Boolean(isProd(workspaceId, host)),
            insecure: Number(row.insecure) === 1 || Number(row.plain_http) === 1
          })
        }
      } catch {
        /* table unavailable */
      }
      for (const [host, access] of Object.entries(saved)) {
        if (access !== 'allowed' && !result.has(host)) {
          result.set(host, {
            host,
            callsToday: 0,
            production: Boolean(isProd(workspaceId, host)),
            insecure: false
          })
        }
      }
      return [...result.values()]
    },
    get: (workspaceId: string, host: string) => {
      const map = readMap(workspaceId)
      return map[normalizeHost(host)] ?? 'allowed'
    },
    set: (workspaceId: string, host: string, access: AgentHostAccess) => {
      const map = readMap(workspaceId)
      const key = normalizeHost(host)
      if (access === 'allowed') delete map[key]
      else map[key] = access
      deps.db.prepare(
        'INSERT INTO thread_settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at'
      ).run(settingsKey(workspaceId), JSON.stringify(map), (deps.now ?? Date.now)())
    }
  }
}

export function policyRowsFromLoaded(loaded: LoadedPolicy | null | undefined): AgentPermissionPolicyRow[] {
  if (!loaded) return []
  const rows: AgentPermissionPolicyRow[] = []
  for (const source of loaded.sources) {
    for (const rule of source.rules) {
      if (rule.action === 'integration.use' && rule.resource.toLowerCase().startsWith('net:')) {
        rows.push({ section: 'hosts', text: `${rule.effect} ${rule.resource.slice(4)}` })
      } else if (rule.action === 'integration.use' && rule.resource.toLowerCase().startsWith('db:')) {
        rows.push({ section: 'databases', text: `${rule.effect} ${rule.resource.slice(3)}` })
      } else if (rule.action === 'db.write') {
        rows.push({ section: 'databases', text: `${rule.effect} write ${rule.resource}` })
      } else if (rule.action === 'tool.use') {
        rows.push({ section: 'tools', text: `${rule.effect} ${rule.resource}` })
      } else if (rule.action === 'provider.use') {
        rows.push({ section: 'commands', text: `${rule.effect} ${rule.resource}` })
      }
    }
  }
  return rows
}
