import { describe, expect, it } from 'vitest'
import { sessionChangeGroups } from '../src/components/Threads/threadChanges'
import { requestOutcome, requestOutcomeLabel } from '../shared/threadRequestOutcome'
import type { ThreadEvent, ThreadRequest } from '../shared/types/thread'

describe('session change history', () => {
  it('groups repeated file operations by turn and prefers verified evidence without hiding steps', () => {
    const events: ThreadEvent[] = [
      { type: 'message', id: 'user-1', role: 'user', text: 'Update the guide\nwith examples' },
      { type: 'tool', id: 'edit-1', name: 'Edit', state: 'completed', detail: '', files: [{ path: 'docs/guide.md', kind: 'update', source: 'tool-input', state: 'completed' }] },
      { type: 'tool', id: 'edit-2', name: 'Edit', state: 'completed', detail: '', files: [{ path: 'docs/guide.md', kind: 'update', source: 'native-patch', state: 'completed', additions: 2, deletions: 1 }] },
      { type: 'message', id: 'user-2', role: 'user', text: 'Revise the tests' },
      { type: 'tool', id: 'edit-3', name: 'Edit', state: 'failed', detail: '', files: [{ path: 'tests/guide.test.ts', kind: 'update', source: 'tool-input', state: 'failed' }] }
    ]
    const groups = sessionChangeGroups(events)
    expect(groups.map(group => [group.sequence, group.label])).toEqual([[2, 'Revise the tests'], [1, 'Update the guide']])
    expect(groups[0].files[0].primary.file.state).toBe('failed')
    expect(groups[1].files[0].operations).toHaveLength(2)
    expect(groups[1].files[0].primary.toolId).toBe('edit-2')
  })
})

describe('request outcomes', () => {
  const question = { kind: 'question', state: 'resolved', title: 'Choose', id: 'q', nativeId: 'q', nativeMethod: 'AskUserQuestion', generation: 1, createdAt: 1 } as ThreadRequest
  it('separates an answer from a refusal and a turn failure', () => {
    expect(requestOutcome('question', { answers: { choice: ['A'] } })).toEqual({ state: 'resolved', resolution: 'answered' })
    expect(requestOutcome('question', { decision: 'decline' })).toEqual({ state: 'resolved', resolution: 'declined' })
    expect(requestOutcomeLabel({ ...question, resolution: 'turn-failed' })).toContain('Turn failed')
    expect(requestOutcomeLabel({ ...question, resolution: 'declined' })).toBe('Declined by you')
  })
})
