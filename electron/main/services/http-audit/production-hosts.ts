import type { AppDatabase } from '../../db/index'
import { normalizeHost } from '../../../../shared/net-policy'
import type { PolicyStore } from '../policy/policy-store'

export function productionHostsFor(deps: {
  db: AppDatabase
  policy?: PolicyStore
}): (workspaceId: string, host: string) => boolean {
  return (workspaceId: string, host: string): boolean => {
    const clean = normalizeHost(host)
    if (!clean) return false
    try {
      const prodDb = deps.db
        .prepare("SELECT 1 FROM oxequery_connections WHERE environment = 'prod' AND LOWER(host) = ? LIMIT 1")
        .get(clean)
      if (prodDb) return true
    } catch {
      /* table unavailable */
    }
    if (deps.policy && workspaceId) {
      try {
        const ws = deps.db
          .prepare('SELECT root_path FROM workspaces WHERE id = ?')
          .get(workspaceId) as { root_path: string } | undefined
        const decision = deps.policy.decide('integration.use', `net:${clean}`, ws?.root_path ?? null, { defer: true })
        if (!decision.allowed) return true
      } catch {
        /* policy unavailable */
      }
    }
    return false
  }
}
