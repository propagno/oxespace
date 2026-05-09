import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import type { ShellProfile, Workspace } from '../../shared/types/workspace'
import { useWorkspaceStore } from '../../src/store/workspace.store'

const shellProfiles: ShellProfile[] = [
  { id: 'builtin-claude', name: 'claude', executable: 'claude', args: [], isBuiltin: true }
]

const workspace: Workspace = {
  id: 'workspace-1',
  name: 'repo',
  rootPath: 'C:/projects/repo',
  layout: '2x2',
  layoutPreset: 4,
  themeId: 'midnight',
  uiDensity: 'compact',
  defaultShellProfileId: 'builtin-claude',
  autoStart: false,
  isActive: true,
  editorVisible: false,
  editorExpanded: false,
  editorWidthPercent: 40,
  panes: [
    { id: 'pane-1', workspaceId: 'workspace-1', type: 'terminal', rowIndex: 0, columnIndex: 0, shellProfileId: 'builtin-claude', status: 'idle' }
  ]
}

describe('workspace.store', () => {
  beforeEach(() => {
    useWorkspaceStore.setState({
      workspaces: [],
      shellProfiles: [],
      activeWorkspaceId: null,
      isLoading: false,
      error: null
    })

    window.oxe = {
      app: { version: '0.1.0' },
      workspace: {
        list: vi.fn().mockResolvedValue([workspace]),
        shellProfiles: vi.fn().mockResolvedValue(shellProfiles),
        create: vi.fn().mockResolvedValue(workspace),
        setActive: vi.fn().mockResolvedValue(workspace),
        delete: vi.fn().mockResolvedValue(undefined),
        closePane: vi.fn().mockResolvedValue(undefined),
        splitPane: vi.fn().mockResolvedValue(workspace),
        updatePaneType: vi.fn().mockResolvedValue(workspace),
        updateEditorState: vi.fn().mockResolvedValue({ ...workspace, editorVisible: true }),
        updateSettings: vi.fn().mockResolvedValue({ ...workspace, themeId: 'nord', layoutPreset: 6, layout: '2x3' }),
        pickFolder: vi.fn().mockResolvedValue(null)
      },
      terminal: {
        start: vi.fn(),
        write: vi.fn(),
        resize: vi.fn(),
        stop: vi.fn(),
        restart: vi.fn(),
        onData: vi.fn(),
        onExit: vi.fn()
      },
      agent: {} as never,
      tasks: {} as never,
      fs: {} as never
    }
  })

  test('bootstraps workspaces and shell profiles', async () => {
    const { result } = renderHook(() => useWorkspaceStore())

    await act(async () => {
      await result.current.bootstrap()
    })

    expect(result.current.workspaces).toHaveLength(1)
    expect(result.current.shellProfiles).toEqual(shellProfiles)
    expect(result.current.activeWorkspaceId).toBe('workspace-1')
  })

  test('creates a workspace and marks it active', async () => {
    const { result } = renderHook(() => useWorkspaceStore())

    await act(async () => {
      await result.current.createWorkspace({ rootPath: 'C:/projects/repo', layout: '2x2' })
    })

    expect(window.oxe.workspace.create).toHaveBeenCalledWith({ rootPath: 'C:/projects/repo', layout: '2x2' })
    expect(result.current.activeWorkspaceId).toBe('workspace-1')
  })

  test('persists editor layout state for a workspace', async () => {
    useWorkspaceStore.setState({ workspaces: [workspace], activeWorkspaceId: 'workspace-1' })
    const { result } = renderHook(() => useWorkspaceStore())

    await act(async () => {
      await result.current.updateEditorState({ workspaceId: 'workspace-1', editorVisible: true })
    })

    expect(window.oxe.workspace.updateEditorState).toHaveBeenCalledWith({ workspaceId: 'workspace-1', editorVisible: true })
    expect(result.current.workspaces[0]?.editorVisible).toBe(true)
  })

  test('persists workspace settings', async () => {
    useWorkspaceStore.setState({ workspaces: [workspace], activeWorkspaceId: 'workspace-1' })
    const { result } = renderHook(() => useWorkspaceStore())

    await act(async () => {
      await result.current.updateSettings({ workspaceId: 'workspace-1', themeId: 'nord', layoutPreset: 6 })
    })

    expect(window.oxe.workspace.updateSettings).toHaveBeenCalledWith({ workspaceId: 'workspace-1', themeId: 'nord', layoutPreset: 6 })
    expect(result.current.workspaces[0]?.themeId).toBe('nord')
    expect(result.current.workspaces[0]?.layoutPreset).toBe(6)
  })
})
