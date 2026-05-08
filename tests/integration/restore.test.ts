import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import type { ShellProfile, Workspace } from '../../shared/types/workspace'
import { useWorkspaceStore } from '../../src/store/workspace.store'

const shellProfiles: ShellProfile[] = [
  { id: 'builtin-claude', name: 'claude', executable: 'claude', args: [], isBuiltin: true }
]

const restoredWorkspaces: Workspace[] = [
  {
    id: 'workspace-manual',
    name: 'manual',
    rootPath: 'C:/manual',
    layout: '1x1',
    defaultShellProfileId: 'builtin-claude',
    autoStart: false,
    isActive: true,
    panes: [
      {
        id: 'pane-manual',
        workspaceId: 'workspace-manual',
        type: 'terminal',
        rowIndex: 0,
        columnIndex: 0,
        shellProfileId: 'builtin-claude',
        status: 'idle'
      }
    ]
  }
]

describe('restore flows', () => {
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
        list: vi.fn().mockResolvedValue(restoredWorkspaces),
        shellProfiles: vi.fn().mockResolvedValue(shellProfiles),
        create: vi.fn(),
        setActive: vi.fn(),
        delete: vi.fn(),
        closePane: vi.fn(),
        pickFolder: vi.fn()
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

  test('restores persisted workspaces without starting terminals when autoStart is false', async () => {
    const { result } = renderHook(() => useWorkspaceStore())

    await act(async () => {
      await result.current.bootstrap()
    })

    expect(result.current.workspaces).toEqual(restoredWorkspaces)
    expect(result.current.activeWorkspaceId).toBe('workspace-manual')
    expect(window.oxe.terminal.start).not.toHaveBeenCalled()
  })
})
