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

  test('describes the checkbox shortcut once, on the tree, not on every row', () => {
    renderTree()
    const tree = screen.getByRole('tree', { name: 'Review files' })
    expect(tree).toHaveAccessibleDescription(/Right Arrow to reach its reviewed checkbox/)
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

  describe('the reviewed checkbox', () => {
    const box = (path: string): HTMLElement => screen.getByRole('checkbox', { name: `Mark ${path} as reviewed` })

    test('is not a tab stop, so Tab crosses the tree in one step', async () => {
      renderTree()
      for (const checkbox of screen.getAllByRole('checkbox')) expect(checkbox).toHaveAttribute('tabindex', '-1')
      await waitFor(() => expect(screen.getAllByRole('treeitem').filter(row => row.tabIndex === 0)).toHaveLength(1))
    })

    test('Right on a file row moves focus to its checkbox and Left moves back', async () => {
      const user = userEvent.setup()
      renderTree()
      item(/^app\.ts/).focus()
      await user.keyboard('{ArrowRight}')
      expect(box('src/app.ts')).toHaveFocus()
      await user.keyboard('{ArrowLeft}')
      expect(item(/^app\.ts/)).toHaveFocus()
    })

    test('Space on the checkbox marks the file as reviewed without selecting it', async () => {
      const user = userEvent.setup()
      const props = renderTree()
      item(/^app\.ts/).focus()
      await user.keyboard('{ArrowRight}')
      await user.keyboard(' ')
      expect(props.onToggleReviewed).toHaveBeenCalledWith('src/app.ts')
      expect(props.onSelectFile).not.toHaveBeenCalled()
    })

    test('Up and Down on the checkbox go to the neighbouring rows', async () => {
      const user = userEvent.setup()
      renderTree()
      item(/^app\.ts/).focus()
      await user.keyboard('{ArrowRight}{ArrowDown}')
      expect(item(/README\.md/)).toHaveFocus()
      item(/^app\.ts/).focus()
      await user.keyboard('{ArrowRight}{ArrowUp}')
      expect(item(/util\.ts/)).toHaveFocus()
    })

    test('Right on a folder still expands or enters it rather than reaching a checkbox', async () => {
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
