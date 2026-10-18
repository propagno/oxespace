import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ThreadEvent, ThreadTurnFileStatus } from '../shared/types/thread'
import { ThreadTurnChanges } from '../src/components/Threads/ThreadFileActivity'

afterEach(cleanup)

const patch = '--- a/x\n+++ b/x\n@@ -1 +1 @@\n-old\n+new\n'
const file = (path: string) => ({ path, kind: 'update' as const, state: 'completed' as const, source: 'native-patch' as const, patch, additions: 1, deletions: 1 })
const events: ThreadEvent[] = [
  { type: 'message', id: 'turn-1', role: 'user', text: 'Edit both' },
  { type: 'tool', id: 'a', name: 'fileChange', state: 'completed', detail: 'a.ts', files: [file('/repo/src/a.ts')] },
  { type: 'tool', id: 'b', name: 'fileChange', state: 'completed', detail: 'b.ts', files: [file('/repo/b.ts')] },
  { type: 'completed', status: 'completed' }
]

describe('ThreadTurnChanges per-file undo', () => {
  it('shows each file state and undoes one file, then refreshes', async () => {
    let states: ThreadTurnFileStatus[] = [
      { path: 'src/a.ts', state: 'pending', preExists: true, postExists: true },
      { path: 'b.ts', state: 'modified', preExists: true, postExists: true }
    ]
    const loadFileStates = vi.fn(async () => states)
    const onUndoFile = vi.fn(async (path: string) => { states = states.map(s => s.path === path ? { ...s, state: 'reverted' } : s) })
    render(<ThreadTurnChanges events={events} root="/repo" onOpen={vi.fn()} loadFileStates={loadFileStates} onUndoFile={onUndoFile} />)

    const undo = await screen.findByRole('button', { name: 'Undo src/a.ts' })
    expect(screen.getByText('Edited later')).toBeTruthy()
    // A file edited after the turn cannot be undone from here.
    expect(screen.queryByRole('button', { name: 'Undo b.ts' })).toBeNull()

    fireEvent.click(undo)
    await waitFor(() => expect(screen.getByText('Reverted')).toBeTruthy())
    expect(onUndoFile).toHaveBeenCalledWith('src/a.ts')
    expect(loadFileStates).toHaveBeenCalledTimes(2)
  })

  it('reports a failed undo without changing the row', async () => {
    const loadFileStates = vi.fn(async () => [{ path: 'src/a.ts', state: 'pending' as const, preExists: true, postExists: true }])
    const onUndoFile = vi.fn(async () => { throw Error('src/a.ts changed after this turn') })
    render(<ThreadTurnChanges events={events} root="/repo" onOpen={vi.fn()} loadFileStates={loadFileStates} onUndoFile={onUndoFile} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Undo src/a.ts' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('changed after this turn')
  })

  it('without the loader the summary behaves as before', () => {
    render(<ThreadTurnChanges events={events} root="/repo" onOpen={vi.fn()} />)
    expect(screen.queryByRole('button', { name: /Undo src/ })).toBeNull()
    expect(screen.getByText('src/a.ts')).toBeTruthy()
  })
})
