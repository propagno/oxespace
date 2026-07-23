import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, test, vi } from 'vitest'
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
        writeFile: vi.fn().mockResolvedValue({ relativePath: 'src/index.ts', size: 11, mtimeMs: 2 }),
        watchFile: vi.fn().mockResolvedValue({ watchId: 'watch-1' }),
        unwatchFile: vi.fn().mockResolvedValue(undefined),
        onFileChanged: vi.fn(() => vi.fn())
      }
    }
  })

  test('lists files, opens in Monaco and marks dirty/saved', async () => {
    const user = userEvent.setup()
    render(<EditorPane workspaceId="workspace-1" rootPath="C:/repo" />)

    await user.click(await screen.findByRole('button', { name: /src/i }))
    await user.click(await screen.findByRole('button', { name: /index\.ts/i }))
    const monaco = await screen.findByLabelText('monaco-typescript')
    expect(monaco).toHaveValue('const a = 1')
    expect(monaco).toHaveAttribute('data-height', '100%')
    expect(monaco).toHaveAttribute('data-width', '100%')
    expect(document.querySelector('.editor-browser')).toBeInTheDocument()

    await user.clear(screen.getByLabelText('monaco-typescript'))
    await user.type(screen.getByLabelText('monaco-typescript'), 'const a = 2')
    expect(screen.getByText('dirty')).toBeInTheDocument()

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 's', ctrlKey: true }))
    await waitFor(() => expect(window.oxe.fs.writeFile).toHaveBeenCalledWith(expect.objectContaining({ content: 'const a = 2' })))
    expect(screen.getByText('saved')).toBeInTheDocument()
  })

  test('collapses and expands directories without losing file selection behavior', async () => {
    const user = userEvent.setup()
    render(<EditorPane workspaceId="workspace-1" rootPath="C:/repo" />)

    const directory = await screen.findByRole('button', { name: /src/i })
    expect(directory).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByRole('button', { name: /index\.ts/i })).not.toBeInTheDocument()

    await user.click(directory)
    expect(directory).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('button', { name: /index\.ts/i })).toBeInTheDocument()

    await user.click(directory)
    expect(directory).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByRole('button', { name: /index\.ts/i })).not.toBeInTheDocument()

    await user.click(directory)
    await user.click(screen.getByRole('button', { name: /index\.ts/i }))

    expect(await screen.findByLabelText('monaco-typescript')).toHaveValue('const a = 1')
    expect(document.querySelector('.editor-body')).toBeInTheDocument()
    expect(document.querySelector('.editor-monaco-host')).toBeInTheDocument()
  })

  test('shows conflict without overwriting dirty content', async () => {
    const user = userEvent.setup()
    render(<EditorPane workspaceId="workspace-1" rootPath="C:/repo" />)

    await user.click(await screen.findByRole('button', { name: /src/i }))
    await user.click(await screen.findByRole('button', { name: /index\.ts/i }))
    await user.clear(screen.getByLabelText('monaco-typescript'))
    await user.type(screen.getByLabelText('monaco-typescript'), 'local')

    useEditorStore.getState().markExternalChange({
      watchId: 'watch-1',
      workspaceId: 'workspace-1',
      relativePath: 'src/index.ts',
      content: 'external',
      size: 8,
      mtimeMs: 3
    })

    expect(await screen.findByText('External change detected')).toBeInTheDocument()
    expect(screen.getByLabelText('monaco-typescript')).toHaveValue('local')
    expect(screen.getByLabelText('External content')).toHaveTextContent('external')
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
