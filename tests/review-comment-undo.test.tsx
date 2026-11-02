import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it } from 'vitest'
import { DiffCard } from '../src/components/Review/DiffCard'
import { useDiffCommentsStore } from '../src/store/diff-comments.store'
import { Toaster } from '../src/ui'

const file = { path: 'src/a.ts', additions: 1, deletions: 0, mtime: null, hunks: [{ header: '@@ -1 +1,2 @@', lines: [
  { type: 'context' as const, oldLineNo: 1, newLineNo: 1, content: 'const a = 1' },
  { type: 'added' as const, oldLineNo: null, newLineNo: 2, content: 'const b = 2' }
] }] }
const comment = (id: string, lineNo: number, createdAt: number) => ({ id, workspaceId: 'w1', filePath: 'src/a.ts', side: 'new' as const, lineNo, lineContent: 'x', body: `Note ${id}`, createdAt })

beforeEach(() => { useDiffCommentsStore.setState({ comments: [comment('c1', 1, 1), comment('c2', 2, 2), { ...comment('c3', 1, 3), workspaceId: 'w2' }] }) })
afterEach(() => cleanup())

const renderCard = () => render(<><DiffCard file={file} workspaceId="w1" isReviewed={false} isSelected diffMode="unified" onToggleReviewed={() => {}} onSelect={() => {}} /><Toaster /></>)

it('deleting a review comment offers Undo, which puts it back where it was', async () => {
  renderCard()
  expect(screen.getByText('Note c1')).toBeInTheDocument()
  fireEvent.click(screen.getAllByRole('button', { name: 'Delete comment' })[0]!)
  expect(screen.queryByText('Note c1')).toBeNull()
  expect(useDiffCommentsStore.getState().comments.map(c => c.id)).toEqual(['c2', 'c3'])
  expect(await screen.findByText('Comment deleted')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Undo' }))
  expect(screen.getByText('Note c1')).toBeInTheDocument()
  expect(useDiffCommentsStore.getState().comments.map(c => c.id)).toEqual(['c1', 'c2', 'c3'])
  await waitFor(() => expect(screen.queryByText('Comment deleted')).toBeNull())
})

it('Undo does not duplicate a comment that is already back', () => {
  const removed = [comment('c1', 1, 1)]
  act(() => { useDiffCommentsStore.getState().remove('c1'); useDiffCommentsStore.getState().restore(removed); useDiffCommentsStore.getState().restore(removed) })
  expect(useDiffCommentsStore.getState().comments.map(c => c.id)).toEqual(['c1', 'c2', 'c3'])
})
