import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import type { FileTreeNode } from '../../shared/types/ipc'
import type { Workspace, WorkspacePane } from '../../shared/types/workspace'
import { EditorPane } from '../../src/components/Editor/EditorPane'
import { useEditorStore } from '../../src/store/editor.store'
import { useWorkspaceStore } from '../../src/store/workspace.store'

vi.mock('@monaco-editor/react', () => ({
  default: ({ language, onChange, value }: { language: string; onChange: (value: string) => void; value: string }) => (
    <textarea aria-label={`monaco-${language}`} value={value} onChange={(event) => onChange(event.currentTarget.value)} />
  )
}))

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
    useEditorStore.setState({ files: {} })
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
    render(<EditorPane pane={createPane()} workspaceId="workspace-1" />)

    await user.click(await screen.findByRole('button', { name: /index\.ts/i }))
    expect(await screen.findByLabelText('monaco-typescript')).toHaveValue('const a = 1')

    await user.clear(screen.getByLabelText('monaco-typescript'))
    await user.type(screen.getByLabelText('monaco-typescript'), 'const a = 2')
    expect(screen.getByText('dirty')).toBeInTheDocument()

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 's', ctrlKey: true }))
    await waitFor(() => expect(window.oxe.fs.writeFile).toHaveBeenCalledWith(expect.objectContaining({ content: 'const a = 2' })))
    expect(screen.getByText('saved')).toBeInTheDocument()
  })

  test('shows conflict without overwriting dirty content', async () => {
    const user = userEvent.setup()
    render(<EditorPane pane={createPane()} workspaceId="workspace-1" />)

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
    panes: [createPane()]
  }
}

function createPane(): WorkspacePane {
  return {
    id: 'pane-1',
    workspaceId: 'workspace-1',
    type: 'editor',
    rowIndex: 0,
    columnIndex: 0,
    shellProfileId: 'builtin-claude',
    status: 'idle'
  }
}
