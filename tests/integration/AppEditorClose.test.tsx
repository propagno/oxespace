import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import type { Workspace } from '../../shared/types/workspace'
import { App } from '../../src/App'
import { useEditorStore } from '../../src/store/editor.store'
import { useWorkspaceStore } from '../../src/store/workspace.store'

vi.mock('../../src/components/Sidebar/Sidebar', () => ({
  Sidebar: ({ onCloseWorkspace }: { onCloseWorkspace: (workspaceId: string) => void }) => (
    <aside data-testid="sidebar">
      <button type="button" onClick={() => onCloseWorkspace('workspace-1')}>
        close workspace
      </button>
    </aside>
  )
}))

vi.mock('../../src/components/Workspace/WorkspaceSurface', () => ({
  WorkspaceSurface: ({ onClosePane }: { onClosePane: (paneId: string) => void }) => (
    <button type="button" onClick={() => onClosePane('pane-1')}>
      close terminal pane
    </button>
  )
}))

vi.mock('../../src/components/Workspace/NewWorkspaceModal', () => ({
  NewWorkspaceModal: () => null
}))

vi.mock('../../src/components/Settings/SettingsModal', () => ({
  SettingsModal: () => null
}))

vi.mock('../../src/components/Agents/AgentConfigModal', () => ({
  AgentConfigModal: () => null
}))

describe('App editor close guard', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    window.oxe = {
      app: { version: '0.1.4' },
      workspace: {
        list: vi.fn().mockResolvedValue([createWorkspace()]),
        create: vi.fn(),
        setActive: vi.fn(),
        delete: vi.fn().mockResolvedValue(undefined),
        closePane: vi.fn().mockResolvedValue(undefined),
        splitPane: vi.fn(),
        updatePaneType: vi.fn(),
        updateEditorState: vi.fn(),
        pickFolder: vi.fn(),
        shellProfiles: vi.fn().mockResolvedValue([])
      },
      terminal: {} as never,
      agent: {
        list: vi.fn().mockResolvedValue([]),
        create: vi.fn(),
        update: vi.fn(),
        delete: vi.fn(),
        discover: vi.fn().mockResolvedValue([]),
        getReadiness: vi.fn().mockResolvedValue([])
      },
      tasks: {} as never,
      background: {
        list: vi.fn().mockResolvedValue([]),
        start: vi.fn(),
        stop: vi.fn(),
        getOutput: vi.fn(),
        onOutput: vi.fn(() => vi.fn()),
        onUpdate: vi.fn(() => vi.fn())
      },
      mcp: {
        list: vi.fn().mockResolvedValue([]),
        create: vi.fn(),
        update: vi.fn(),
        delete: vi.fn(),
        start: vi.fn(),
        stop: vi.fn(),
        callTool: vi.fn(),
        onHealth: vi.fn(() => vi.fn())
      },
      skill: {
        list: vi.fn().mockResolvedValue([]),
        get: vi.fn(),
        invoke: vi.fn(),
        onChange: vi.fn(() => vi.fn())
      },
      fs: {
        listTree: vi.fn(),
        readFile: vi.fn(),
        writeFile: vi.fn(),
        watchFile: vi.fn(),
        unwatchFile: vi.fn().mockResolvedValue(undefined),
        onFileChanged: vi.fn(() => vi.fn())
      }
    }
    useWorkspaceStore.setState({
      workspaces: [createWorkspace()],
      activeWorkspaceId: 'workspace-1',
      shellProfiles: [],
      isLoading: false,
      error: null
    })
    useEditorStore.setState({
      files: {
        'workspace-1': {
          workspaceId: 'workspace-1',
          rootPath: 'C:/repo',
          relativePath: 'README.md',
          content: 'dirty',
          lastSavedContent: 'clean',
          language: 'markdown',
          watchId: 'watch-1',
          isLoading: false,
          isSaving: false,
          error: null,
          conflict: null
        }
      }
    })
  })

  test('closing a terminal pane does not prompt for a workspace editor dirty file', async () => {
    const user = userEvent.setup()

    render(<App />)
    await user.click(await screen.findByRole('button', { name: 'close terminal pane' }))

    expect(window.oxe.workspace.closePane).toHaveBeenCalledWith('pane-1')
    expect(useEditorStore.getState().files['workspace-1']).toBeDefined()
  })

  test('dirty workspace close is blocked inline without native confirm', async () => {
    const user = userEvent.setup()

    render(<App />)
    await user.click(await screen.findByRole('button', { name: 'close workspace' }))

    expect(await screen.findByText(/unsaved editor changes/i)).toBeInTheDocument()
    expect(window.oxe.workspace.delete).not.toHaveBeenCalled()
    expect(useEditorStore.getState().files['workspace-1']).toBeDefined()
  })

  test('closes workspace and clears clean editor state', async () => {
    const user = userEvent.setup()
    useEditorStore.setState((state) => ({
      files: {
        ...state.files,
        'workspace-1': state.files['workspace-1'] ? { ...state.files['workspace-1'], content: 'dirty', lastSavedContent: 'dirty' } : null
      }
    }))

    render(<App />)
    await user.click(await screen.findByRole('button', { name: 'close workspace' }))

    expect(window.oxe.fs.unwatchFile).toHaveBeenCalledWith({ watchId: 'watch-1' })
    expect(window.oxe.workspace.delete).toHaveBeenCalledWith('workspace-1')
    expect(useEditorStore.getState().files['workspace-1']).toBeUndefined()
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
    panes: [
      {
        id: 'pane-1',
        workspaceId: 'workspace-1',
        type: 'terminal',
        rowIndex: 0,
        columnIndex: 0,
        shellProfileId: null,
        status: 'idle'
      }
    ]
  }
}
