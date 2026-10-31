import { describe, expect, it } from 'vitest'
import { threadCommitDraft } from '../shared/threadCommitDraft'
import type { ThreadEvent, ThreadSnapshot } from '../shared/types/thread'

const snapshot = (events: ThreadEvent[], turns: string[], title = 'Add login form'): Pick<ThreadSnapshot, 'events' | 'turns' | 'thread'> => ({
  events,
  turns: turns.map((id, sequence) => ({ id, sequence, status: 'completed' as const, configuration: {} })),
  thread: { title } as ThreadSnapshot['thread']
})

describe('threadCommitDraft', () => {
  it('uses the conversation title and the asks of turns that changed files', () => {
    const draft = threadCommitDraft(snapshot([
      { type: 'message', id: 't1', role: 'user', text: 'Create the login form\nwith email and password' },
      { type: 'turn-diff', turnId: 't1', files: [{ path: 'src/Login.tsx', kind: 'added' }] },
      { type: 'completed', status: 'completed' },
      { type: 'message', id: 't2', role: 'user', text: 'What does this do?' },
      { type: 'completed', status: 'completed' },
      { type: 'message', id: 't3', role: 'user', text: 'Validate the email' },
      { type: 'turn-diff', turnId: 't3', files: [{ path: 'src/Login.tsx', kind: 'modified' }, { path: 'src/validate.ts', kind: 'added' }] },
      { type: 'completed', status: 'completed' }
    ] as ThreadEvent[], ['t1', 't2', 't3']))
    expect(draft.message).toBe('Add login form\n\n- Create the login form\n- Validate the email')
    expect(draft.prTitle).toBe('Add login form')
    expect(draft.prBody).toContain('## Files changed\n\n- `src/Login.tsx`\n- `src/validate.ts`')
    expect(draft.prBody).not.toContain('What does this do?')
  })

  it('falls back to a plain subject when nothing changed', () => {
    expect(threadCommitDraft(snapshot([], [], '')).message).toBe('Update project files')
  })
})
