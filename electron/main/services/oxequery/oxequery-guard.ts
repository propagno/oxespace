import { policyBlockedMessage, type PolicyAction, type PolicyDecision } from '../../../../shared/policy'
import { dbWriteResource, effectiveSafety, nameMatches, type EnvironmentLimits } from '../../../../shared/oxequerySafety'
import type { ConnectionSafety } from '../../../../shared/types/oxequery'
import { OxeQueryError, type ResolvedConnection } from './oxequery-errors'
import { guardSql, isMutating } from './sql-guard'

/**
 * Safe production (roadmap Q5), main side: a connection as the person's own settings, the environment's limits and
 * the organization's policy leave it, and the checks that stand between a statement and the worker. The agent
 * gateway has its own, stricter refusal of production writes; nothing here loosens it.
 */
export interface Guarded {
  /** The connection to hand to the worker: read-only when policy says so, limits lowered to the environment's. */
  connection: ResolvedConnection
  safety: ConnectionSafety
  name: string
  /** The message to show when policy keeps this connection read-only. */
  blocked?: string
}

export interface PolicyReader { decide(action: PolicyAction, resource: string, projectRoot?: string | null): PolicyDecision }

const DEFAULT_ROWS = 500
const DEFAULT_TIMEOUT_MS = 60_000

/** The `db.write` decision for this connection when it denies writes, else nothing. Policy only ever restricts. */
export function writeDenied(environment: ResolvedConnection['environment'], name: string, policy: PolicyReader | null): PolicyDecision | undefined {
  if (!policy) return undefined
  const decision = policy.decide('db.write', dbWriteResource(environment ?? 'local', name))
  return decision.allowed ? undefined : decision
}

export function guardConnection(resolved: ResolvedConnection, name: string, limits: EnvironmentLimits, policy: PolicyReader | null): Guarded {
  const environment = resolved.environment ?? 'local'
  const denied = writeDenied(environment, name, policy)
  const safety = effectiveSafety({
    environment, readOnly: resolved.readOnly, maxRows: resolved.maxRows ?? DEFAULT_ROWS, statementTimeoutMs: resolved.statementTimeoutMs ?? DEFAULT_TIMEOUT_MS
  }, limits, denied !== undefined)
  return {
    connection: { ...resolved, readOnly: safety.readOnly, maxRows: safety.maxRows, statementTimeoutMs: safety.statementTimeoutMs },
    safety, name,
    ...(denied ? { blocked: policyBlockedMessage(denied, `Changing data on "${name}"`) } : {})
  }
}

/**
 * Throws before the worker is reached when the text changes data and policy forbids it, or when the connection is a
 * production one and the person has not typed its name. A plain read-only connection is left to the worker, which
 * says why in its own words.
 */
export function checkWrite(guarded: Guarded, sql: string, typedName: unknown): void {
  const verdict = guardSql(sql)
  if (!isMutating(verdict)) return
  if (guarded.blocked) throw new OxeQueryError('read-only', guarded.blocked, verdict.reasons)
  if (guarded.safety.readOnly) return
  if (guarded.safety.typedConfirmation && !nameMatches(typedName, guarded.name)) {
    throw new OxeQueryError('confirm-name', 'This is a production connection. Type its name to run a statement that changes data.', verdict.reasons)
  }
}

/** A row limit the person asked for, held to the environment's ceiling; `undefined` leaves the connection's own. */
export function capRows(requested: number | undefined, safety: ConnectionSafety): number | undefined {
  return requested === undefined ? undefined : Math.min(requested, safety.maxRowsCeiling)
}
