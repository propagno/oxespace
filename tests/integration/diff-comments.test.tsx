import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, test } from 'vitest'
import type { GitDiffFile } from '../../shared/types/git'
import { formatDiffComments, type DiffComment } from '../../shared/types/diff-comments'
import { useDiffCommentsStore } from '../../src/store/diff-comments.store'
import { DiffCard } from '../../src/components/Review/DiffCard'

function comment(partial: Partial<DiffComment>): DiffComment {
  return {
    id: 'c1',
    workspaceId: 'ws-1',
    filePath: 'src/a.ts',
    side: 'new',
    lineNo: 10,
    lineContent: 'const x = 1',
    body: 'rename this',
    createdAt: 1,
    ...partial
  }
}

describe('formatDiffComments', () => {
  test('renders the File:/Line:/User comment: contract, ordered by path then line', () => {
    const text = formatDiffComments([
      comment({ id: 'c2', filePath: 'src/b.ts', lineNo: 5, body: 'extract helper' }),
      comment({ id: 'c1', filePath: 'src/a.ts', lineNo: 10, body: 'rename this' })
    ])
    expect(text).toContain('Review comments on the current diff (2):')
    expect(text.indexOf('src/a.ts')).toBeLessThan(text.indexOf('src/b.ts'))
    expect(text).toContain('File: src/a.ts')
    expect(text).toContain('Line: 10 (new side)')
    expect(text).toContain('Code: const x = 1')
    expect(text).toContain('User comment: rename this')
    expect(text).toContain('Please address each comment')
  })

  test('empty input produces an empty string', () => {
    expect(formatDiffComments([])).toBe('')
  })
})

describe('diff-comments store + DiffCard integration', () => {
  beforeEach(() => {
    localStorage.clear()
    useDiffCommentsStore.setState({ comments: [] })
  })

  test('store add/remove/clear scoped by workspace', () => {
    const { add, remove, clear } = useDiffCommentsStore.getState()
    add({ workspaceId: 'ws-1', filePath: 'a.ts', side: 'new', lineNo: 1, lineContent: 'x', body: 'one' })
    add({ workspaceId: 'ws-2', filePath: 'b.ts', side: 'old', lineNo: 2, lineContent: 'y', body: 'two' })
    expect(useDiffCommentsStore.getState().comments).toHaveLength(2)

    const first = useDiffCommentsStore.getState().comments[0]
    remove(first.id)
    expect(useDiffCommentsStore.getState().comments).toHaveLength(1)

    clear('ws-2')
    expect(useDiffCommentsStore.getState().comments).toHaveLength(0)
  })

  test('adds a comment through the DiffCard inline editor', async () => {
    const user = userEvent.setup()
    const file: GitDiffFile = {
      path: 'src/foo.ts',
      additions: 1,
      deletions: 0,
      mtime: null,
      hunks: [
        {
          header: '@@ -1,2 +1,3 @@',
          lines: [
            { type: 'context', oldLineNo: 1, newLineNo: 1, content: 'const a = 1' },
            { type: 'added', oldLineNo: null, newLineNo: 2, content: 'const b = 2' }
          ]
        }
      ]
    }

    render(
      <DiffCard
        file={file}
        workspaceId="ws-1"
        isReviewed={false}
        isSelected
        diffMode="unified"
        onToggleReviewed={() => undefined}
        onSelect={() => undefined}
      />
    )

    // Open the editor on the added line (second commentable row).
    const addButtons = screen.getAllByTestId('diff-comment-add')
    await user.click(addButtons[1])
    const input = await screen.findByPlaceholderText(/Comment for the agent/i)
    await user.type(input, 'null-check this')
    await user.click(screen.getByRole('button', { name: 'Add' }))

    const comments = useDiffCommentsStore.getState().comments
    expect(comments).toHaveLength(1)
    expect(comments[0]).toMatchObject({
      workspaceId: 'ws-1',
      filePath: 'src/foo.ts',
      side: 'new',
      lineNo: 2,
      lineContent: 'const b = 2',
      body: 'null-check this'
    })
    // The saved comment renders as a thread row.
    expect(screen.getByTestId('diff-comment-row')).toHaveTextContent('null-check this')
  })
})
