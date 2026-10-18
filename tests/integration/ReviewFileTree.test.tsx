import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, test, vi } from 'vitest'
import type { GitDiffFile } from '../../shared/types/git'
import { ReviewFileTree } from '../../src/components/Review/ReviewFileTree'

const file = (path: string): GitDiffFile => ({ path, status: 'M', additions: 1, deletions: 0, hunks: [] } as unknown as GitDiffFile)
const files = [file('src/lib/util.ts'), file('src/app.ts'), file('README.md')]

function renderTree(overrides: Partial<Parameters<typeof ReviewFileTree>[0]> = {}) {
  const props = {
    files, treeMode: 'structured' as const, reviewedFiles: [] as string[], collapsedDirs: [] as string[], selectedFile: null as string | null,
    onTreeModeChange: vi.fn(), onSelectFile: vi.fn(), onToggleReviewed: vi.fn(), onToggleDirCollapsed: vi.fn(), ...overrides
  }
  render(<ReviewFileTree {...props} />)
  return props
}
const item = (name: string | RegExp): HTMLElement => screen.getByRole('treeitem', { name })

describe('ReviewFileTree as an ARIA tree', () => {
  test('exposes a labelled tree whose rows carry their depth', () => {
    renderTree()
    expect(screen.getByRole('tree', { name: 'Review files' })).toBeInTheDocument()
    expect(item(/^src/)).toHaveAttribute('aria-level', '1')
    expect(item(/^lib/)).toHaveAttribute('aria-level', '2')
    expect(item(/util\.ts/)).toHaveAttribute('aria-level', '3')
    expect(item(/^app\.ts/)).toHaveAttribute('aria-level', '2')
    expect(item(/README\.md/)).toHaveAttribute('aria-level', '1')
    expect(item(/^src/)).toHaveAttribute('aria-expanded', 'true')
  })

  test('renders no tree without files, since a tree must own items (axe aria-required-children)', () => {
    renderTree({ files: [] })
    expect(screen.queryByRole('tree')).toBeNull()
    expect(screen.getByText('No files to review.')).toBeInTheDocument()
  })

  test('describes the review shortcut once, on the tree, not on every row', () => {
    renderTree()
    const tree = screen.getByRole('tree', { name: 'Review files' })
    expect(tree).toHaveAccessibleDescription(/Space to mark it reviewed/)
    for (const row of screen.getAllByRole('treeitem')) expect(row).not.toHaveAttribute('aria-describedby')
  })

  test('marks the selected file and keeps one row in the tab order', async () => {
    renderTree({ selectedFile: 'src/app.ts' })
    expect(item(/^app\.ts/)).toHaveAttribute('aria-selected', 'true')
    expect(item(/README\.md/)).toHaveAttribute('aria-selected', 'false')
    await waitFor(() => expect(screen.getAllByRole('treeitem').filter(row => row.tabIndex === 0)).toEqual([item(/^app\.ts/)]))
  })

  test('arrow keys walk the visible rows in screen order', async () => {
    const user = userEvent.setup()
    renderTree()
    const order = screen.getAllByRole('treeitem').map(row => row.textContent ?? '')
    item(/^src/).focus()
    await user.keyboard('{ArrowDown}')
    expect(screen.getAllByRole('treeitem')[1]).toHaveFocus()
    expect(order[1]).toMatch(/lib/)
    await user.keyboard('{End}')
    expect(screen.getAllByRole('treeitem').at(-1)).toHaveFocus()
    await user.keyboard('{Home}')
    expect(item(/^src/)).toHaveFocus()
  })

  test('Left on an open folder asks to collapse it', async () => {
    const user = userEvent.setup()
    const props = renderTree()
    item(/^src/).focus()
    await user.keyboard('{ArrowLeft}')
    expect(props.onToggleDirCollapsed).toHaveBeenCalledWith('src')
  })

  test('Right on an open folder moves into its first child; Left on a file returns to the parent', async () => {
    const user = userEvent.setup()
    renderTree()
    item(/^src/).focus()
    await user.keyboard('{ArrowRight}')
    expect(item(/^lib/)).toHaveFocus()
    item(/^app\.ts/).focus()
    await user.keyboard('{ArrowLeft}')
    expect(item(/^src/)).toHaveFocus()
  })

  test('Enter selects the file', async () => {
    const user = userEvent.setup()
    const props = renderTree()
    item(/README\.md/).focus()
    await user.keyboard('{Enter}')
    expect(props.onSelectFile).toHaveBeenCalledWith('README.md')
  })

  describe('the reviewed state', () => {
    test('is the file item’s own aria-checked; the pointer checkbox is hidden and out of the Tab order', async () => {
      renderTree({ reviewedFiles: ['README.md'] })
      expect(item(/README\.md/)).toHaveAttribute('aria-checked', 'true')
      expect(item(/^app\.ts/)).toHaveAttribute('aria-checked', 'false')
      // The tree owns only tree items (axe aria-required-children).
      expect(screen.queryAllByRole('checkbox')).toEqual([])
      await waitFor(() => expect(screen.getAllByRole('treeitem').filter(row => row.tabIndex === 0)).toHaveLength(1))
    })

    test('Space on a file marks it reviewed without selecting it', async () => {
      const user = userEvent.setup()
      const props = renderTree()
      item(/^app\.ts/).focus()
      await user.keyboard(' ')
      expect(props.onToggleReviewed).toHaveBeenCalledWith('src/app.ts')
      expect(props.onSelectFile).not.toHaveBeenCalled()
    })

    test('Right on a folder still expands or enters it', async () => {
      const user = userEvent.setup()
      renderTree()
      item(/^src/).focus()
      await user.keyboard('{ArrowRight}')
      expect(item(/^lib/)).toHaveFocus()
    })
  })

  test('flat mode lists every file at the first level', () => {
    renderTree({ treeMode: 'flat' })
    for (const row of screen.getAllByRole('treeitem')) expect(row).toHaveAttribute('aria-level', '1')
    expect(screen.getAllByRole('treeitem')).toHaveLength(3)
  })
})
