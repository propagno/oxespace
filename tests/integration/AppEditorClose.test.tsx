import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import type { Workspace } from '../../shared/types/workspace'
import { App } from '../../src/App'
import { useEditorStore } from '../../src/store/editor.store'
import { useWorkspaceStore } from '../../src/store/workspace.store'

vi.mock('../../src/components/Sidebar/Sidebar', () => ({
  Sidebar: () => <aside data-testid="sidebar" />
}))

vi.mock('../../src/components/Grid/WorkspaceGrid', () => ({
  WorkspaceGrid: ({ onClosePane }: { onClosePane: (paneId: string) => void }) => (
    <button type="button" onClick={() => onClosePane('pane-1')}>
      close editor pane
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
        delete: vi.fn(),
        closePane: vi.fn().mockResolvedValue(undefined),
        splitPane: vi.fn(),
        updatePaneType: vi.fn(),
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
        'pane-1': {
          paneId: 'pane-1',
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

  test('cancel keeps a dirty editor pane open', async () => {
    const user = userEvent.setup()
    vi.spyOn(window, 'confirm').mockReturnValue(false)

    render(<App />)
    await user.click(await screen.findByRole('button', { name: 'close editor pane' }))

    expect(window.confirm).toHaveBeenCalledWith('Discard unsaved editor changes?')
    expect(window.oxe.workspace.closePane).not.toHaveBeenCalled()
    expect(useEditorStore.getState().files['pane-1']).toBeDefined()
  })

  test('confirm closes a dirty editor pane and clears editor state', async () => {
    const user = userEvent.setup()
    vi.spyOn(window, 'confirm').mockReturnValue(true)

    render(<App />)
    await user.click(await screen.findByRole('button', { name: 'close editor pane' }))

    expect(window.oxe.fs.unwatchFile).toHaveBeenCalledWith({ watchId: 'watch-1' })
    expect(window.oxe.workspace.closePane).toHaveBeenCalledWith('pane-1')
    expect(useEditorStore.getState().files['pane-1']).toBeUndefined()
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
    panes: [
      {
        id: 'pane-1',
        workspaceId: 'workspace-1',
        type: 'editor',
        rowIndex: 0,
        columnIndex: 0,
        shellProfileId: null,
        status: 'idle'
      }
    ]
  }
}
