/** Classify explicit provider failures; input arguments are never evidence of failure. */
export function threadActionFailure(output: string): { label: string; guidance: string } | undefined {
  if (/user (?:denied|rejected|declined)|denied by (?:the )?user/i.test(output)) return { label: 'Declined by you', guidance: 'The action was not authorized. Change the request or explicitly approve a new attempt.' }
  if (/permission denied|not allowed|permission.*(?:rejected|denied)|blocked by.*policy/i.test(output)) return { label: 'Blocked by permissions', guidance: 'Review conversation access and the provider’s saved rules. Access was not expanded automatically.' }
  if (/unauthorized|authentication.*(?:failed|expired)|token.*(?:expired|revoked)|\b401\b/i.test(output)) return { label: 'Authentication required', guidance: 'Reconnect the affected account or server in Connections before trying again.' }
  if (/ECONN(?:REFUSED|RESET)|server.*disconnected|not reachable/i.test(output)) return { label: 'Server disconnected', guidance: 'Check the server in Connections and reconnect it. The action was not automatically repeated.' }
  if (/unknown tool|tool.*not found|method not found|tool.*unavailable/i.test(output)) return { label: 'Tool unavailable', guidance: 'Refresh the server’s tool list in Connections and check whether this tool is supported.' }
  if (/timed? ?out|timeout/i.test(output)) return { label: 'Response timed out', guidance: 'The remote outcome is unconfirmed. Check its state before repeating an action that changes data.' }
  return undefined
}
