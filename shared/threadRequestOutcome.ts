import type { ThreadRequest, ThreadRequestResolution, ThreadRequestResponse } from './types/thread'

export function requestOutcome(kind: ThreadRequest['kind'], response: ThreadRequestResponse): { state: ThreadRequest['state']; resolution: ThreadRequestResolution } {
  if (response.decision === 'cancel') return { state: 'cancelled', resolution: 'cancelled-by-user' }
  if (response.decision === 'decline') return { state: 'resolved', resolution: 'declined' }
  if (kind === 'question') return { state: 'resolved', resolution: 'answered' }
  return { state: 'resolved', resolution: 'approved' }
}

export function requestOutcomeLabel(request: ThreadRequest): string {
  switch (request.resolution) {
    case 'answered': return 'Answer sent to agent'
    case 'approved': return 'Approval sent to agent'
    case 'declined': return 'Declined by you'
    case 'cancelled-by-user': return 'Cancelled by you'
    case 'turn-completed': return 'Turn finished; no response to this request was confirmed'
    case 'turn-failed': return 'Turn failed before this request was answered'
    case 'interrupted': return 'Turn interrupted before this request was answered'
    case 'connection-lost': return 'Connection closed; response not confirmed. This saved request cannot be answered.'
    default: return request.state === 'expired' ? 'Request expired' : request.state === 'cancelled' ? 'Request cancelled' : 'Request closed; outcome unavailable'
  }
}
