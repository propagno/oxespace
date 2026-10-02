import type { ThreadEvent } from '../../../shared/types/thread'

/** Presentation facts derived from a turn, without guessing what the provider did. */
export function threadTurnPresentation(events: ThreadEvent[]) {
  const completed = [...events].reverse().find((event): event is Extract<ThreadEvent, { type: 'completed' }> => event.type === 'completed')
  const tools = events.filter((event): event is Extract<ThreadEvent, { type: 'tool' }> => event.type === 'tool')
  let lastAction = -1
  for (let index = events.length - 1; index >= 0; index--) {
    if (['tool', 'subagent', 'request', 'approval'].includes(events[index].type)) { lastAction = index; break }
  }
  const finalMessage = completed?.status === 'completed'
    ? [...events.slice(lastAction + 1)].reverse().find((event): event is Extract<ThreadEvent, { type: 'message' }> => event.type === 'message' && event.role === 'assistant')
    : undefined
  return {
    finalMessageId: finalMessage?.id,
    actionCount: tools.length,
    failedActions: tools.filter(event => event.state === 'failed').length,
    unconfirmedActions: tools.filter(event => event.state === 'unknown').length,
    awaitingInput: events.some(event => event.type === 'request' && event.request.state === 'pending')
  }
}
