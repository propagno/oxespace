import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { Profiler } from 'react'
import type { FileTreeNode } from '../../shared/types/ipc'
import type { Workspace } from '../../shared/types/workspace'
import { EditorPane } from '../../src/components/Editor/EditorPane'
import { useEditorStore } from '../../src/store/editor.store'
import { useWorkspaceStore } from '../../src/store/workspace.store'

vi.mock('@monaco-editor/react', () => ({
  default: ({ height, language, onChange, value, width }: { height?: number | string; language: string; onChange: (value: string) => void; value: string; width?: number | string }) => (
    <textarea aria-label={`monaco-${language}`} data-height={height} data-width={width} value={value} onChange={(event) => onChange(event.currentTarget.value)} />
  )
}))

// Self-hosting setup pulls real monaco-editor + ?worker modules; stub it out so
// the EditorPane render test stays light and headless.
vi.mock('../../src/lib/monacoSetup', () => ({}))

describe('EditorPane', () => {
  beforeEach(() => {
    window.localStorage.removeItem('oxe.editor-tree-width')
    const tree: FileTreeNode[] = [
      {
        name: 'src',
        relativePath: 'src',
        type: 'directory',
        size: null,
        children: [{ name: 'index.ts', relativePath: 'src/index.ts', type: 'file', size: 12 }]
      }
    ]
    useEditorStore.setState({ files: {}, tabs: {}, activePath: {} })
    useWorkspaceStore.setState({
      workspaces: [createWorkspace()],
      activeWorkspaceId: 'workspace-1',
      shellProfiles: [],
      isLoading: false,
      error: null
    })
    window.oxe = {
      app: { version: '0.1.4' },
      workspace: {} as never,
      terminal: {} as never,
      agent: {} as never,
      tasks: {} as never,
      fs: {
        listTree: vi.fn().mockResolvedValue(tree),
        readFile: vi.fn().mockResolvedValue({ relativePath: 'src/index.ts', content: 'const a = 1', size: 11, mtimeMs: 1 }),
        watchFile: vi.fn().mockResolvedValue({ watchId: 'watch-1' }),
        unwatchFile: vi.fn().mockResolvedValue(undefined),
        onFileChanged: vi.fn(() => vi.fn())
      }
    }
  })

  test('lists files and opens in Monaco read-only', async () => {
    const user = userEvent.setup()
    render(<EditorPane workspaceId="workspace-1" rootPath="C:/repo" />)

    await user.click(await screen.findByRole('treeitem', { name: /src/i }))
    await user.click(await screen.findByRole('treeitem', { name: /index\.ts/i }))
    const monaco = await screen.findByLabelText('monaco-typescript')
    expect(monaco).toHaveValue('const a = 1')
    expect(monaco).toHaveAttribute('data-height', '100%')
    expect(monaco).toHaveAttribute('data-width', '100%')
    expect(document.querySelector('.editor-browser')).toBeInTheDocument()
  })

  test('collapses and expands directories without losing file selection behavior', async () => {
    const user = userEvent.setup()
    render(<EditorPane workspaceId="workspace-1" rootPath="C:/repo" />)

    const directory = await screen.findByRole('treeitem', { name: /src/i })
    expect(directory).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByRole('treeitem', { name: /index\.ts/i })).not.toBeInTheDocument()

    await user.click(directory)
    expect(directory).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('treeitem', { name: /index\.ts/i })).toBeInTheDocument()

    await user.click(directory)
    expect(directory).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByRole('treeitem', { name: /index\.ts/i })).not.toBeInTheDocument()

    await user.click(directory)
    await user.click(screen.getByRole('treeitem', { name: /index\.ts/i }))

    expect(await screen.findByLabelText('monaco-typescript')).toHaveValue('const a = 1')
    expect(document.querySelector('.editor-body')).toBeInTheDocument()
    expect(document.querySelector('.editor-monaco-host')).toBeInTheDocument()
  })

  test('resizes the file tree with the keyboard and restores its width', async () => {
    const user = userEvent.setup()
    const { unmount } = render(<EditorPane workspaceId="workspace-1" rootPath="C:/repo" />)
    const separator = screen.getByRole('separator', { name: 'File tree width' })
    expect(separator).toHaveAttribute('aria-valuenow', '240')
    separator.focus()
    await user.keyboard('{ArrowRight}')
    expect(separator).toHaveAttribute('aria-valuenow', '256')
    await waitFor(() => expect(window.localStorage.getItem('oxe.editor-tree-width')).toBe('256'))
    unmount()
    render(<EditorPane workspaceId="workspace-1" rootPath="C:/repo" />)
    expect(screen.getByRole('separator', { name: 'File tree width' })).toHaveAttribute('aria-valuenow', '256')
  })

  test('does not re-render for editor changes in another workspace', async () => {
    let renders = 0
    render(<Profiler id="editor" onRender={() => { renders++ }}><EditorPane workspaceId="workspace-1" rootPath="C:/repo" /></Profiler>)
    await screen.findByText('src')
    await waitFor(() => expect(renders).toBeGreaterThan(0))
    const before = renders
    // Before the narrow selectors, each of these re-rendered the editor (it subscribed to the whole store): 5 extra renders.
    for (let index = 0; index < 5; index++) {
      act(() => { useEditorStore.setState(state => ({ tabs: { ...state.tabs, 'workspace-2': [{ path: `other-${index}.ts`, pinned: false }] as never } })) })
    }
    expect(renders - before).toBe(0)
  })
})

function createWorkspace(): Workspace {
  return {
    id: 'workspace-1',
    name: 'repo',
    rootPath: 'C:/repo',
    layout: '1x1',
    defaultShellProfileId: 'builtin-claude',
    autoStart: false,
    isActive: true,
    editorVisible: true,
    editorExpanded: false,
    editorWidthPercent: 40,
    panes: []
  }
}
