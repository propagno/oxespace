import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import type { FileTreeNode } from '../../shared/types/ipc'
import { FileBrowser } from '../../src/components/Editor/FileBrowser'

const nodes: FileTreeNode[] = [
  { name: 'src', relativePath: 'src', type: 'directory' },
  { name: 'docs', relativePath: 'docs', type: 'directory' },
  { name: 'README.md', relativePath: 'README.md', type: 'file' }
]
const children: Record<string, FileTreeNode[]> = {
  src: [
    { name: 'lib', relativePath: 'src/lib', type: 'directory' },
    { name: 'app.ts', relativePath: 'src/app.ts', type: 'file' }
  ],
  'src/lib': [{ name: 'util.ts', relativePath: 'src/lib/util.ts', type: 'file' }],
  docs: []
}

function renderTree(selectedPath: string | null = null) {
  const onOpenFile = vi.fn()
  render(<FileBrowser nodes={nodes} rootPath="/repo" workspaceId="ws" selectedPath={selectedPath} onOpenFile={onOpenFile} />)
  return { onOpenFile }
}
const row = (name: string): HTMLElement => screen.getByRole('treeitem', { name })
const tabStops = (): string[] => screen.getAllByRole('treeitem').filter(item => item.tabIndex === 0).map(item => item.textContent ?? '')

describe('FileBrowser as an ARIA tree', () => {
  beforeEach(() => {
    window.oxe = {
      ...window.oxe,
      fs: { listTree: vi.fn(async ({ relativePath }: { relativePath: string }) => children[relativePath] ?? []) }
    } as unknown as typeof window.oxe
  })

  test('exposes a labelled tree inside the files landmark, with level, position and size on every row', () => {
    renderTree()
    expect(screen.getByRole('navigation', { name: 'Workspace files' })).toBeInTheDocument()
    expect(screen.getByRole('tree', { name: 'Files' })).toBeInTheDocument()
    const src = row('src')
    expect(src).toHaveAttribute('aria-level', '1')
    expect(src).toHaveAttribute('aria-posinset', '1')
    expect(src).toHaveAttribute('aria-setsize', '3')
    expect(src).toHaveAttribute('aria-expanded', 'false')
    expect(row('README.md')).toHaveAttribute('aria-posinset', '3')
    expect(row('README.md')).not.toHaveAttribute('aria-expanded')
  })

  test('marks only the open file as selected', () => {
    renderTree('README.md')
    expect(row('README.md')).toHaveAttribute('aria-selected', 'true')
    expect(row('src')).not.toHaveAttribute('aria-selected', 'true')
  })

  test('keeps exactly one row in the tab order and starts on the selected file', async () => {
    renderTree('README.md')
    await waitFor(() => expect(tabStops()).toEqual(['README.md']))
  })

  test('starts on the first row when nothing is selected', async () => {
    renderTree()
    await waitFor(() => expect(tabStops()).toEqual(['src']))
  })

  test('moves between rows with the arrow keys, Home and End', async () => {
    const user = userEvent.setup()
    renderTree()
    row('src').focus()
    await user.keyboard('{ArrowDown}')
    expect(row('docs')).toHaveFocus()
    await user.keyboard('{ArrowDown}')
    expect(row('README.md')).toHaveFocus()
    await user.keyboard('{ArrowDown}')
    expect(row('README.md')).toHaveFocus()
    await user.keyboard('{ArrowUp}')
    expect(row('docs')).toHaveFocus()
    await user.keyboard('{Home}')
    expect(row('src')).toHaveFocus()
    await user.keyboard('{End}')
    expect(row('README.md')).toHaveFocus()
  })

  test('the focused row becomes the single tab stop', async () => {
    const user = userEvent.setup()
    renderTree()
    row('src').focus()
    await user.keyboard('{ArrowDown}')
    await waitFor(() => expect(tabStops()).toEqual(['docs']))
  })

  test('Right expands a folder, loads its children and then moves into them; Left goes back', async () => {
    const user = userEvent.setup()
    renderTree()
    row('src').focus()
    await user.keyboard('{ArrowRight}')
    await waitFor(() => expect(row('src')).toHaveAttribute('aria-expanded', 'true'))
    const lib = await screen.findByRole('treeitem', { name: 'lib' })
    expect(lib).toHaveAttribute('aria-level', '2')
    expect(lib).toHaveAttribute('aria-posinset', '1')
    expect(lib).toHaveAttribute('aria-setsize', '2')

    await user.keyboard('{ArrowRight}')
    expect(lib).toHaveFocus()
    await user.keyboard('{ArrowLeft}')
    expect(row('src')).toHaveFocus()
    await user.keyboard('{ArrowLeft}')
    await waitFor(() => expect(row('src')).toHaveAttribute('aria-expanded', 'false'))
    expect(screen.queryByRole('treeitem', { name: 'lib' })).not.toBeInTheDocument()
  })

  test('Left on a nested file moves to its parent folder', async () => {
    const user = userEvent.setup()
    renderTree()
    row('src').focus()
    await user.keyboard('{ArrowRight}')
    const app = await screen.findByRole('treeitem', { name: 'app.ts' })
    app.focus()
    await user.keyboard('{ArrowLeft}')
    expect(row('src')).toHaveFocus()
  })

  test('Enter opens a file', async () => {
    const user = userEvent.setup()
    const { onOpenFile } = renderTree()
    row('README.md').focus()
    await user.keyboard('{Enter}')
    expect(onOpenFile).toHaveBeenCalledWith('README.md')
  })

  test('Right and Left do nothing on a file at the top level', async () => {
    const user = userEvent.setup()
    renderTree()
    row('README.md').focus()
    await user.keyboard('{ArrowRight}{ArrowLeft}')
    expect(row('README.md')).toHaveFocus()
  })
})
