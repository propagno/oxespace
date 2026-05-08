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
  defaultShellProfileId: 'builtin-claude',
  autoStart: false,
  isActive: true,
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
      }
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
})
