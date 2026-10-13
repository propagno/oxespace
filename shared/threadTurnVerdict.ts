/**
 * What a finished turn amounted to, derived only from recorded events: the
 * same answer for the timeline, a supervising agent reading the thread, and
 * Agent Work results. Nothing here guesses what the provider did.
 */
import type { ThreadEvent, ThreadFailure, ThreadSnapshot } from './types/thread'

export type ThreadFailureAction = 'retry' | 'wait' | 'reconnect' | 'compact' | 'close-other-session' | 'change-configuration' | 'review-permissions' | 'raise-budget' | 'none'

export interface ThreadFailureGuidance {
  /** Sending the same turn again can reasonably succeed without changing anything. */
  retryable: boolean
  action: ThreadFailureAction
  title: string
}

const GUIDANCE: Record<ThreadFailure['code'], ThreadFailureGuidance> = {
  authentication: { retryable: false, action: 'reconnect', title: 'Sign-in required' },
  usage: { retryable: false, action: 'wait', title: 'Usage allowance exhausted' },
  'rate-limit': { retryable: true, action: 'wait', title: 'Request limit reached' },
  context: { retryable: false, action: 'compact', title: 'Context window full' },
  budget: { retryable: false, action: 'raise-budget', title: 'Budget reached' },
  server: { retryable: true, action: 'retry', title: 'Provider unavailable' },
  network: { retryable: true, action: 'retry', title: 'Connection failed' },
  sandbox: { retryable: false, action: 'review-permissions', title: 'Blocked by the sandbox' },
  configuration: { retryable: false, action: 'change-configuration', title: 'Configuration rejected' },
  'session-busy': { retryable: false, action: 'close-other-session', title: 'Session active elsewhere' },
  unknown: { retryable: true, action: 'retry', title: 'Turn failed' }
}

export function failureGuidance(code: ThreadFailure['code'] | undefined): ThreadFailureGuidance {
  return GUIDANCE[code ?? 'unknown'] ?? GUIDANCE.unknown
}

export interface ThreadTurnVerdict {
  turnId: string
  status: 'running' | 'completed' | 'completed-with-warnings' | 'failed' | 'interrupted'
  filesChanged: string[]
  toolCalls: number
  failedToolCalls: number
  unconfirmedToolCalls: number
  durationMs?: number
  failure?: { code: ThreadFailure['code']; message: string } & ThreadFailureGuidance
  /** The agent's closing message, bounded. */
  summary?: string
}

const SUMMARY_LIMIT = 2000

/** Events of one turn: from its user message up to the next turn's user message. */
export function turnEvents(snapshot: Pick<ThreadSnapshot, 'events' | 'turns'>, turnId: string): ThreadEvent[] {
  const turns = snapshot.turns ?? []
  const index = turns.findIndex(turn => turn.id === turnId)
  if (index < 0) return []
  const start = snapshot.events.findIndex(event => event.type === 'message' && event.role === 'user' && event.id === turnId)
  if (start < 0) return []
  const next = turns[index + 1]
  const end = next ? snapshot.events.findIndex((event, position) => position > start && event.type === 'message' && event.role === 'user' && event.id === next.id) : -1
  return snapshot.events.slice(start, end < 0 ? undefined : end)
}

export function turnVerdict(snapshot: Pick<ThreadSnapshot, 'events' | 'turns'>, turnId: string): ThreadTurnVerdict | undefined {
  const turn = snapshot.turns?.find(value => value.id === turnId)
  if (!turn) return undefined
  const events = turnEvents(snapshot, turnId)
  const tools = events.filter((event): event is Extract<ThreadEvent, { type: 'tool' }> => event.type === 'tool')
  const completed = [...events].reverse().find((event): event is Extract<ThreadEvent, { type: 'completed' }> => event.type === 'completed')
  const failed = tools.filter(tool => tool.state === 'failed').length
  const unconfirmed = tools.filter(tool => tool.state === 'unknown').length
  const files = new Set<string>()
  for (const event of events) if (event.type === 'turn-diff') for (const file of event.files) files.add(file.path)
  const status: ThreadTurnVerdict['status'] = turn.status === 'running' ? 'running'
    : turn.status === 'completed' ? (failed || unconfirmed ? 'completed-with-warnings' : 'completed')
    : turn.status
  const failure = completed?.failure
  const closing = status.startsWith('completed')
    ? [...events].reverse().find((event): event is Extract<ThreadEvent, { type: 'message' }> => event.type === 'message' && event.role === 'assistant')
    : undefined
  return {
    turnId,
    status,
    filesChanged: [...files].sort(),
    toolCalls: tools.length,
    failedToolCalls: failed,
    unconfirmedToolCalls: unconfirmed,
    ...(turn.startedAt && turn.completedAt ? { durationMs: Math.max(0, turn.completedAt - turn.startedAt) } : {}),
    ...(failure ? { failure: { code: failure.code, message: failure.message, ...failureGuidance(failure.code) } } : {}),
    ...(closing?.text ? { summary: closing.text.slice(0, SUMMARY_LIMIT) } : {})
  }
}
