import type { ThreadEvent, ThreadSnapshot } from '../../../../shared/types/thread'

export type ThreadRecoveryCause = 'restart' | 'shutdown'

/**
 * Settles process-owned state without claiming that a provider operation did or
 * did not happen. Ambiguous delivery remains `unknown` for an explicit choice.
 */
export function settleVolatileThreadSnapshot(snapshot: ThreadSnapshot, cause: ThreadRecoveryCause, completedAt = Date.now()): void {
  const reason = cause === 'restart' ? 'OXESpace restarted' : 'OXESpace closed'
  if (snapshot.thread.cliActive) snapshot.thread.cliNotice = 'This conversation needs to recover its saved session. Choose Recover conversation.'
  snapshot.thread.status = 'interrupted'
  snapshot.thread.providerObservation = { state: 'unknown', source: 'unavailable', observedAt: completedAt,
    nativeTurnId: snapshot.turns?.at(-1)?.nativeId,
    detail: `${reason} before the native result was confirmed. The local execution was closed; the provider outcome remains unknown. No queued message was resent.` }
  for (const turn of snapshot.turns ?? []) if (turn.status === 'running') { turn.status = 'interrupted'; turn.completedAt = completedAt }
  const resolvedRequests = new Set(snapshot.events.filter(event => event.type === 'request-resolved').map(event => event.id))
  const resolvedApprovals = new Set(snapshot.events.filter(event => event.type === 'approval-resolved').map(event => event.id))
  const requestResolutions: ThreadEvent[] = [], approvalResolutions: ThreadEvent[] = []
  for (const event of snapshot.events) {
    if (event.type === 'request' && event.request.state === 'pending') {
      event.request.state = 'cancelled'
      event.request.resolution = 'connection-lost'
      event.request.resolvedAt = completedAt
      if (!resolvedRequests.has(event.id)) requestResolutions.push({ type: 'request-resolved', id: event.id, state: 'cancelled', resolution: 'connection-lost', resolvedAt: event.request.resolvedAt })
    } else if (event.type === 'approval' && !resolvedApprovals.has(event.id)) {
      approvalResolutions.push({ type: 'approval-resolved', id: event.id })
    } else if (event.type === 'tool' && event.state === 'running') {
      event.state = 'unknown'; event.completedAt = completedAt
      event.output = event.output || `Outcome unconfirmed because ${reason} before the provider reported a result.`
      if (event.files) event.files = event.files.map(file => file.state === 'running' ? { ...file, state: 'unknown' } : file)
    } else if (event.type === 'subagent' && event.state === 'running') {
      event.state = 'unknown'; event.completedAt = completedAt
      event.agents = event.agents.map(agent => agent.status === 'running' || agent.status === 'pending' ? { ...agent, status: 'unknown', message: agent.message || `Task outcome unconfirmed because ${reason}.` } : agent)
    } else if (event.type === 'turn-diff') {
      event.files = event.files.map(file => file.state === 'running' ? { ...file, state: 'unknown' } : file)
    }
  }
  snapshot.events.push(...requestResolutions, ...approvalResolutions)
  const activeTurn = snapshot.turns?.at(-1)
  if (activeTurn?.status === 'interrupted') {
    const turnStart = snapshot.events.findIndex(event => event.type === 'message' && event.role === 'user' && event.id === activeTurn.id)
    const alreadySettled = turnStart >= 0 && snapshot.events.slice(turnStart).some(event => event.type === 'completed')
    if (!alreadySettled) snapshot.events.push({ type: 'completed', status: 'interrupted', error: `${reason} before this turn completed.` })
  }
  snapshot.thread.queue = snapshot.thread.queue?.map(item => item.state === 'sending' ? { ...item, state: 'unknown', error: `Delivery could not be confirmed because ${reason}.` } : item)
  snapshot.thread.cliActive = false
}
