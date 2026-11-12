import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ThreadEvent, ThreadFileHunk, ThreadTurnFileStatus } from '../../shared/types/thread'
import { ThreadTurnChanges } from '../../src/components/Threads/ThreadFileActivity'

afterEach(cleanup)

const patch = '--- a/x\n+++ b/x\n@@ -1 +1 @@\n-old\n+new\n'
const file = (path: string) => ({ path, kind: 'update' as const, state: 'completed' as const, source: 'native-patch' as const, patch, additions: 1, deletions: 1 })
const events: ThreadEvent[] = [
  { type: 'message', id: 'turn-1', role: 'user', text: 'Edit' },
  { type: 'tool', id: 'a', name: 'fileChange', state: 'completed', detail: 'a', files: [file('/repo/src/price.ts'), file('/repo/src/tax.ts')] },
  { type: 'completed', status: 'completed' }
]
const states: ThreadTurnFileStatus[] = [
  { path: 'src/price.ts', root: '/repo', state: 'pending', preExists: true, postExists: true },
  { path: 'src/tax.ts', root: '/repo', state: 'pending', preExists: true, postExists: true }
]
const hunk = (id: string, oldLine: string, newLine: string, start: number): ThreadFileHunk => ({ id, oldStart: start, oldLines: [oldLine], newStart: start, newLines: [newLine] })

function renderChanges(openFirst: boolean, loadHunks = vi.fn(async (): Promise<ThreadFileHunk[]> => [hunk('h1', 'return total', 'return round(total)', 3), hunk('h2', 'const tax = 0', 'const tax = 0.2', 9)])) {
  render(<ThreadTurnChanges openFirst={openFirst} events={events} root="/repo" onOpen={vi.fn()} loadFileStates={async () => states}
    onUndoFile={vi.fn(async () => {})} loadHunks={loadHunks} onUndoHunk={vi.fn(async () => {})} />)
  return loadHunks
}

describe('the changes of the latest turn (OxeChat, diff in the conversation)', () => {
  it('opens the first pending file by itself, with its first block and a way to the rest', async () => {
    const loadHunks = renderChanges(true)
    const review = await screen.findByLabelText('Changes in src/price.ts')
    expect(loadHunks).toHaveBeenCalledWith('src/price.ts')
    expect(review).toHaveTextContent('+ return round(total)')
    // The second block waits behind one button; the other file stays closed.
    expect(review).not.toHaveTextContent('const tax = 0.2')
    expect(screen.queryByLabelText('Changes in src/tax.ts')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Show 1 more change in this file' }))
    expect(screen.getByLabelText('Changes in src/price.ts')).toHaveTextContent('+ const tax = 0.2')
  })

  it('stays closed for an older turn, and when the blocks cannot be read', async () => {
    renderChanges(false)
    await screen.findByRole('button', { name: 'Review changes in src/price.ts' })
    expect(screen.queryByLabelText('Changes in src/price.ts')).toBeNull()
    cleanup()
    const failing = renderChanges(true, vi.fn(async (): Promise<ThreadFileHunk[]> => { throw Error('gone') }))
    await waitFor(() => expect(failing).toHaveBeenCalled())
    expect(screen.queryByLabelText('Changes in src/price.ts')).toBeNull()
  })

  it('asks again when the turn just ended and its file states are not there yet', async () => {
    // The checkpoint of a turn is finalized a moment after the turn ends: the first answer is empty.
    const loadFileStates = vi.fn<() => Promise<ThreadTurnFileStatus[]>>().mockResolvedValueOnce([]).mockResolvedValue(states)
    render(<ThreadTurnChanges openFirst events={events} root="/repo" onOpen={vi.fn()} loadFileStates={loadFileStates}
      onUndoFile={vi.fn(async () => {})} loadHunks={async () => [hunk('h1', 'return total', 'return round(total)', 3)]} onUndoHunk={vi.fn(async () => {})} />)
    expect(await screen.findByLabelText('Changes in src/price.ts', {}, { timeout: 4000 })).toHaveTextContent('+ return round(total)')
    expect(loadFileStates).toHaveBeenCalledTimes(2)
  })

  it('counts what this turn changed when its checkpoint says, not each file against the last commit (B-1)', async () => {
    // The events say +1 -1 per file; the checkpoint says this turn added one line to price.ts and two to tax.ts.
    const own: ThreadTurnFileStatus[] = [{ ...states[0], additions: 1, deletions: 0 }, { ...states[1], additions: 2, deletions: 0 }]
    render(<ThreadTurnChanges events={events} root="/repo" onOpen={vi.fn()} loadFileStates={async () => own}
      onUndoFile={vi.fn(async () => {})} loadHunks={async () => []} onUndoHunk={vi.fn(async () => {})} />)
    const card = screen.getByLabelText('Changed files')
    await waitFor(() => expect(card.querySelector('header')).toHaveTextContent('+3−0'))
    expect(screen.getByTitle('/repo/src/price.ts')).toHaveTextContent('+1−0')
    expect(screen.getByTitle('/repo/src/tax.ts')).toHaveTextContent('+2−0')
  })

  it('a review the person opens shows every block', async () => {
    renderChanges(false)
    fireEvent.click(await screen.findByRole('button', { name: 'Review changes in src/tax.ts' }))
    const review = await screen.findByLabelText('Changes in src/tax.ts')
    expect(review).toHaveTextContent('+ const tax = 0.2')
    expect(screen.queryByRole('button', { name: /more change/ })).toBeNull()
  })
})
