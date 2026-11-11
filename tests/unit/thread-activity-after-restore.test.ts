import { describe, expect, it } from 'vitest'
import { deriveThreadActivity } from '../../src/components/Threads/deriveThreadActivity'
import type { ThreadEvent, ThreadSnapshot } from '../../shared/types/thread'

const events: ThreadEvent[] = [
  { type: 'message', id: 'turn-1', role: 'user', text: 'What does price.js do?' },
  { type: 'message', id: 'a1', role: 'assistant', text: 'It rounds prices. Nothing else.' },
  { type: 'completed', status: 'completed' },
  { type: 'message', id: 'turn-2', role: 'user', text: 'Fix the rounding' },
  { type: 'tool', id: 't1', name: 'Edit', state: 'completed', detail: 'price.js', files: [{ path: '/repo/price.js', kind: 'update', source: 'tool-input', state: 'completed' }] },
  { type: 'message', id: 'a2', role: 'assistant', text: 'Fixed the rounding in price.js.' },
  { type: 'completed', status: 'completed' }
]

function snapshot(rewind?: ThreadSnapshot['thread']['rewind'], list: ThreadEvent[] = events): ThreadSnapshot {
  return {
    thread: { id: 'thread', workspaceId: 'ws', projectId: 'p', rootPath: '/repo', provider: 'claude', title: 'T', status: 'idle', lastTurnStatus: 'completed', createdAt: 1, updatedAt: 2, ...(rewind ? { rewind } : {}) },
    events: list,
    turns: []
  } as unknown as ThreadSnapshot
}

describe('the status line after a Restore (HML-F11-7)', () => {
  it('says Ready for review while the turn that changed files stands', () => {
    expect(deriveThreadActivity(snapshot(), [])).toMatchObject({ kind: 'ready', text: 'Fixed the rounding in price.js' })
  })

  it('goes back to the last answer that still stands once the files were restored', () => {
    // The undone turn stays in the history for Redo; it is not what the conversation ends with any more.
    const activity = deriveThreadActivity(snapshot({ turnId: 'turn-2', at: 3, removedTurns: 1, redoCheckpointIds: ['redo-1'] }), [])
    expect(activity).toMatchObject({ kind: 'done', text: 'It rounds prices' })
  })

  it('keeps Ready for review when the conversation went back but the files stayed on disk', () => {
    const activity = deriveThreadActivity(snapshot({ turnId: 'turn-2', at: 3, removedTurns: 1 }), [])
    expect(activity).toMatchObject({ kind: 'ready', text: 'It rounds prices' })
  })

  it('shows nothing when the restore undid the only turn', () => {
    expect(deriveThreadActivity(snapshot({ turnId: 'turn-1', at: 3, removedTurns: 2, redoCheckpointIds: ['redo-1'] }), [])).toBeNull()
  })
})
