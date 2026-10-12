import { describe, expect, it } from 'vitest'
import type { ThreadEvent } from '../shared/types/thread'
import { threadTurnPresentation } from '../src/components/Threads/threadTurnPresentation'

describe('Thread turn presentation', () => {
  it('marks only the completed response after the last action as final', () => {
    const events: ThreadEvent[] = [
      { type: 'message', id: 'request', role: 'user', text: 'Fix the flow' },
      { type: 'message', id: 'progress', role: 'assistant', text: 'I will inspect it.' },
      { type: 'tool', id: 'check', name: 'Bash', state: 'completed', detail: 'npm test' },
      { type: 'message', id: 'answer', role: 'assistant', text: 'Fixed and validated.' },
      { type: 'completed', status: 'completed' }
    ]
    expect(threadTurnPresentation(events)).toMatchObject({ finalMessageId: 'answer', actionCount: 1, failedActions: 0 })
    expect(threadTurnPresentation(events.slice(0, -1)).finalMessageId).toBeUndefined()
  })

  it('does not present an unfinished or failed turn as a final answer', () => {
    const events: ThreadEvent[] = [
      { type: 'message', id: 'partial', role: 'assistant', text: 'Checking.' },
      { type: 'tool', id: 'unknown', name: 'Bash', state: 'unknown', detail: 'git status' },
      { type: 'completed', status: 'failed' }
    ]
    expect(threadTurnPresentation(events)).toMatchObject({ finalMessageId: undefined, actionCount: 1, unconfirmedActions: 1 })
  })
})
