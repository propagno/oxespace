import type { ConversationThread, ThreadStatus } from '../../shared/types/thread'

/**
 * One decision for "should this thread demand attention", used for both the
 * unread marker and the OS notification so the two can never disagree.
 *
 * Only transitions notify. The first sighting of a thread, a status that did not
 * change, and a turn the user stopped themselves say nothing; an outcome the
 * app cannot establish (no `lastTurnStatus`) is never reported as success.
 */
export type ThreadAttentionKind = 'finished' | 'needs-approval' | 'failed'

export interface ThreadAttentionInput {
  previous: ThreadStatus | undefined
  current: Pick<ConversationThread, 'status' | 'lastTurnStatus'>
  /** The thread is on screen in a focused window. */
  viewing: boolean
}

export interface ThreadAttentionDecision {
  kind: ThreadAttentionKind | null
  /** Mark the thread unread in the sidebar. */
  unread: boolean
  /** Raise an OS notification. */
  notify: boolean
}

const NONE: ThreadAttentionDecision = { kind: null, unread: false, notify: false }

export function decideThreadAttention({ previous, current, viewing }: ThreadAttentionInput): ThreadAttentionDecision {
  if (previous === undefined || previous === current.status) return NONE

  let kind: ThreadAttentionKind | null = null
  if (current.status === 'approval') kind = 'needs-approval'
  else if (current.status === 'failed') kind = 'failed'
  else if (current.status === 'idle' && (previous === 'running' || previous === 'approval') && current.lastTurnStatus === 'completed') {
    kind = 'finished'
  }
  if (!kind) return NONE

  // A thread being watched needs no toast, and its own unread dot would only
  // flash. Everything else gets both.
  return { kind, unread: !viewing, notify: !viewing }
}

export function threadAttentionText(kind: ThreadAttentionKind, title: string): { title: string; body: string } {
  const name = title.trim() || 'Conversa'
  switch (kind) {
    case 'needs-approval': return { title: `${name} — precisa de aprovação`, body: 'O agente está aguardando sua decisão para continuar.' }
    case 'failed': return { title: `${name} — falhou`, body: 'O turno terminou com erro. Abra a conversa para ver o motivo.' }
    case 'finished': return { title: `${name} — terminou`, body: 'O agente concluiu o turno.' }
  }
}
