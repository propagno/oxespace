import { beforeEach, describe, expect, test, vi } from 'vitest'
import { useOxeStore } from '../../src/store/oxe.store'
import type { OxeApi } from '../../shared/types/ipc'

describe('oxe.store', () => {
  beforeEach(() => {
    useOxeStore.setState({ byWorkspaceId: {} })
    vi.restoreAllMocks()
  })

  test('loads status keyed by workspace', async () => {
    const status = {
      workspaceId: 'workspace-1',
      rootPath: 'C:/repo',
      isOxeProject: true,
      engine: { available: false, version: null, command: 'oxe-cc', message: 'missing' },
      state: null,
      artifacts: [{ kind: 'state' as const, label: 'STATE', relativePath: '.oxe/STATE.md', exists: true, size: 10, mtimeMs: 1 }],
      warnings: [],
      updatedAt: '2026-05-09T00:00:00Z'
    }
    mockOxeApi({
      getStatus: vi.fn().mockResolvedValue(status),
      getStatusJson: vi.fn().mockResolvedValue(status),
      listArtifacts: vi.fn().mockResolvedValue([]),
      listArtifactsRich: vi.fn().mockResolvedValue([]),
      getFreshness: vi.fn().mockResolvedValue({ state: 'fresh', reason: null, lastStatusAt: null, latestWorkspaceMtimeMs: null, dirtyFiles: [], suggestedActions: [] }),
      onWorkspaceDrift: vi.fn()
    })

    await useOxeStore.getState().loadStatus('workspace-1', 'C:/repo')

    expect(window.oxe.oxe.getStatusJson).toHaveBeenCalledWith({ workspaceId: 'workspace-1', rootPath: 'C:/repo' })
    expect(useOxeStore.getState().byWorkspaceId['workspace-1'].status?.isOxeProject).toBe(true)
    expect(useOxeStore.getState().byWorkspaceId['workspace-1'].artifacts).toHaveLength(1)
  })

  test('keeps errors scoped to the workspace', async () => {
    mockOxeApi({
      getStatus: vi.fn().mockRejectedValue(new Error('boom')),
      getStatusJson: vi.fn().mockRejectedValue(new Error('boom')),
      listArtifacts: vi.fn().mockResolvedValue([]),
      listArtifactsRich: vi.fn().mockResolvedValue([]),
      getFreshness: vi.fn().mockResolvedValue({ state: 'fresh', reason: null, lastStatusAt: null, latestWorkspaceMtimeMs: null, dirtyFiles: [], suggestedActions: [] }),
      onWorkspaceDrift: vi.fn()
    })

    await useOxeStore.getState().loadStatus('workspace-2', 'C:/repo')

    expect(useOxeStore.getState().byWorkspaceId['workspace-2'].error).toBe('boom')
    expect(useOxeStore.getState().byWorkspaceId['workspace-1']).toBeUndefined()
  })
})

function mockOxeApi(oxe: OxeApi['oxe']): void {
  Object.defineProperty(window, 'oxe', {
    configurable: true,
    value: {
      oxe
    }
  })
}
