import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ThreadSnapshot } from '../shared/types/thread'
import { pendingChanges, ThreadDockChanges } from '../src/components/Threads/ThreadDockChanges'

const original = window.oxe
afterEach(() => { cleanup(); window.oxe = original; localStorage.clear() })

describe('pending changes across turns', () => {
  it('lists files still as a turn left them, newest turn first, minus the kept ones', () => {
    const results = [
      { turnId: 't1', files: [{ path: 'a.ts', state: 'pending' }, { path: 'b.ts', state: 'reverted' }] },
      { turnId: 't2', files: [{ path: 'c.ts', state: 'pending' }, { path: 'd.ts', state: 'modified' }] }
    ]
    expect(pendingChanges(results, new Set())).toEqual([{ turnId: 't2', path: 'c.ts' }, { turnId: 't1', path: 'a.ts' }])
    expect(pendingChanges(results, new Set(['t2|c.ts']))).toEqual([{ turnId: 't1', path: 'a.ts' }])
  })

  describe('the strip', () => {
    const turnFiles = vi.fn()
    const undoTurnFile = vi.fn()
    const snapshot = { thread: { id: 'th', updatedAt: 1 }, events: [], turns: [{ id: 't1', status: 'completed' }, { id: 't2', status: 'completed' }] } as unknown as ThreadSnapshot

    beforeEach(() => {
      turnFiles.mockReset(); undoTurnFile.mockReset()
      turnFiles.mockImplementation(async (_thread: string, turnId: string) => turnId === 't1' ? [{ path: 'a.ts', state: 'pending' }] : [{ path: 'c.ts', state: 'pending' }])
      undoTurnFile.mockResolvedValue(undefined)
      window.oxe = { ...original, thread: { ...original?.thread, turnFiles, undoTurnFile } } as typeof window.oxe
    })

    it('counts the files, opens the list, and keeps a file for good', async () => {
      render(<ThreadDockChanges snapshot={snapshot} running={false} onViewChanges={() => {}} />)
      const toggle = await screen.findByRole('button', { name: /2 files changed/ })
      expect(toggle).toHaveAttribute('aria-expanded', 'false')
      fireEvent.click(toggle)
      expect(toggle).toHaveAttribute('aria-expanded', 'true')
      fireEvent.click(screen.getByRole('button', { name: 'Keep c.ts' }))
      expect(screen.getByRole('button', { name: /1 file changed/ })).toBeInTheDocument()
      expect(JSON.parse(localStorage.getItem('oxe.thread.kept:th')!)).toEqual(['t2|c.ts'])
    })

    it('undoes every file newest turn first, and hides while a turn runs', async () => {
      const view = render(<ThreadDockChanges snapshot={snapshot} running={false} onViewChanges={() => {}} />)
      await screen.findByRole('button', { name: /2 files changed/ })
      turnFiles.mockResolvedValue([])
      await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Undo all' })) })
      expect(undoTurnFile.mock.calls).toEqual([['th', 't2', 'c.ts'], ['th', 't1', 'a.ts']])
      await waitFor(() => expect(screen.queryByTestId('thread-dock-changes')).toBeNull())
      view.rerender(<ThreadDockChanges snapshot={snapshot} running onViewChanges={() => {}} />)
      expect(screen.queryByTestId('thread-dock-changes')).toBeNull()
    })

    it('shows why an undo was refused', async () => {
      undoTurnFile.mockRejectedValue(new Error("Error invoking remote method 'thread:undo-turn-file': Error: Restore blocked: a.ts changed after this checkpoint"))
      render(<ThreadDockChanges snapshot={snapshot} running={false} onViewChanges={() => {}} />)
      fireEvent.click(await screen.findByRole('button', { name: /2 files changed/ }))
      await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Undo a.ts' })) })
      expect(await screen.findByRole('alert')).toHaveTextContent(/^Restore blocked: a\.ts changed after this checkpoint$/)
    })
  })
})
