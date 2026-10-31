/** Why a provider action failed, when its output says so explicitly; the interface words it (thread:actionFailure). */
export type ThreadActionFailureKind = 'declined' | 'permissions' | 'authentication' | 'disconnected' | 'unavailable' | 'timeout'

/** Classify explicit provider failures; input arguments are never evidence of failure. */
export function threadActionFailure(output: string): ThreadActionFailureKind | undefined {
  if (/user (?:denied|rejected|declined)|denied by (?:the )?user/i.test(output)) return 'declined'
  if (/permission denied|not allowed|permission.*(?:rejected|denied)|blocked by.*policy/i.test(output)) return 'permissions'
  if (/unauthorized|authentication.*(?:failed|expired)|token.*(?:expired|revoked)|\b401\b/i.test(output)) return 'authentication'
  if (/ECONN(?:REFUSED|RESET)|server.*disconnected|not reachable/i.test(output)) return 'disconnected'
  if (/unknown tool|tool.*not found|method not found|tool.*unavailable/i.test(output)) return 'unavailable'
  if (/timed? ?out|timeout/i.test(output)) return 'timeout'
  return undefined
}
