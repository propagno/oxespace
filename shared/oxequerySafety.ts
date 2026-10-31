import type { ConnectionEnvironment, ConnectionSafety, EnvironmentLimit } from './types/oxequery'

/**
 * Safe production (roadmap Q5), the part the editor and the main process both need: what a connection really
 * allows after its environment's limits, and who may type what before a statement that changes data runs.
 * Pure on purpose, so the toolbar shows exactly what the main process enforces.
 */
export type EnvironmentLimits = Record<ConnectionEnvironment, EnvironmentLimit>

/** Production reads at most 1,000 rows and gives a statement 30 seconds; the other kinds leave the connection's own values alone. */
export const DEFAULT_ENVIRONMENT_LIMITS: EnvironmentLimits = {
  local: { maxRows: null, statementTimeoutMs: null },
  dev: { maxRows: null, statementTimeoutMs: null },
  prod: { maxRows: 1000, statementTimeoutMs: 30_000 }
}

/** The most rows any query may ask for, whatever the environment (the same bound the service puts on `maxRows`). */
export const MAX_ROWS = 100_000

export interface SafetyConnection { environment: ConnectionEnvironment; readOnly: boolean; maxRows: number; statementTimeoutMs: number }

/** The lower of the connection's value and the environment's ceiling; a missing ceiling changes nothing. */
function capped(own: number, ceiling: number | null): number {
  return ceiling === null ? own : Math.min(own, ceiling)
}

/** What the connection allows now: its own settings, lowered by the environment's ceilings and raised to read-only by policy. */
export function effectiveSafety(connection: SafetyConnection, limits: EnvironmentLimits, readOnlyByPolicy: boolean): ConnectionSafety {
  const limit = limits[connection.environment]
  return {
    readOnly: connection.readOnly || readOnlyByPolicy,
    // Policy wins the explanation: a person cannot turn it off from the connection's form.
    readOnlyBy: readOnlyByPolicy ? 'policy' : connection.readOnly ? 'connection' : null,
    typedConfirmation: connection.environment === 'prod',
    maxRows: capped(connection.maxRows, limit.maxRows),
    maxRowsCeiling: limit.maxRows ?? MAX_ROWS,
    statementTimeoutMs: capped(connection.statementTimeoutMs, limit.statementTimeoutMs)
  }
}

/** Whether the typed text is the connection's name. Case matters and surrounding space does not: a name is an identity, not a hint. */
export function nameMatches(typed: unknown, name: string): boolean {
  return typeof typed === 'string' && typed.trim() === name.trim() && name.trim().length > 0
}

/** The resource a `db.write` policy rule is matched against: `<environment>:<connection name>`. */
export function dbWriteResource(environment: ConnectionEnvironment, name: string): string {
  return `${environment}:${name}`
}
