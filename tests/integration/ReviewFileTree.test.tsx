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

  test('Enter selects the file and the reviewed checkbox keeps its own keys', async () => {
    const user = userEvent.setup()
    const props = renderTree()
    item(/README\.md/).focus()
    await user.keyboard('{Enter}')
    expect(props.onSelectFile).toHaveBeenCalledWith('README.md')
    const box = screen.getByRole('checkbox', { name: 'Mark README.md as reviewed' })
    box.focus()
    await user.keyboard('{ArrowDown}')
    expect(box).toHaveFocus()
  })

  test('flat mode lists every file at the first level', () => {
    renderTree({ treeMode: 'flat' })
    for (const row of screen.getAllByRole('treeitem')) expect(row).toHaveAttribute('aria-level', '1')
    expect(screen.getAllByRole('treeitem')).toHaveLength(3)
  })
})
