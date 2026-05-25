import { renderHook, act } from '@testing-library/react'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import type { Workspace, WorkspacePane } from '../../shared/types/workspace'
import { useSlashDispatcher } from '../../src/lib/useSlashDispatcher'
import { useIntegrationStore } from '../../src/store/integration.store'

const workspace: Workspace = {
  id: 'workspace-1',
  name: 'demo',
  rootPath: 'C:/demo',
  layout: '1x1',
  layoutPreset: 1,
  themeId: 'midnight',
  uiDensity: 'compact',
  defaultShellProfileId: 'builtin-claude',
  autoStart: false,
  isActive: true,
  panes: []
}

const pane: WorkspacePane = {
  id: 'pane-1',
  workspaceId: 'workspace-1',
  type: 'terminal',
  rowIndex: 0,
  columnIndex: 0,
  shellProfileId: 'builtin-claude',
  status: 'running',
  agentProfileId: null,
  agentName: null,
  displayName: null,
  createdAt: null,
  rootPath: null
}

describe('useSlashDispatcher — /integration', () => {
  const terminalWrite = vi.fn().mockResolvedValue(undefined)

  beforeEach(() => {
    terminalWrite.mockClear()
    // Stub the IPC surface so the dispatcher can run without the real
    // preload bridge. Only `terminal.write` (used by every sub-command to
    // surface output) and `integration.buildContext` matter for these tests.
    Object.defineProperty(window, 'oxe', {
      configurable: true,
      value: {
        terminal: { write: terminalWrite },
        integration: {
          buildContext: vi.fn().mockResolvedValue({ groupId: 'g1', text: '# CONTEXT_MARKDOWN_FROM_IPC' }),
          createHandoff: vi.fn().mockResolvedValue({ id: 'h1', groupId: 'g1', fromMemberId: 'm1', toMemberId: 'm2', title: 't', content: 'c', status: 'sent', createdAt: 0 })
        }
      }
    })
    useIntegrationStore.setState({ groups: [], handoffs: {}, activeGroupId: null, activeMemberId: null, isLoading: false, error: null })
  })

  test('writes a friendly hint when the pane is not part of any integration', async () => {
    const { result } = renderHook(() => useSlashDispatcher({ workspace, pane }))
    await act(async () => {
      await result.current({ id: 'integration', label: '/integration', hint: '', description: '' }, '')
    })
    expect(terminalWrite).toHaveBeenCalledTimes(1)
    const data = terminalWrite.mock.calls[0][0].data as string
    expect(data).toMatch(/not part of any integration/i)
  })

  test('writes the buildContext result when the pane belongs to a member', async () => {
    useIntegrationStore.setState({
      groups: [
        {
          id: 'g1',
          name: 'Feature X',
          goal: 'Cross-repo work',
          description: null,
          status: 'active',
          activeWorkspaceId: 'workspace-1',
          members: [
            {
              id: 'm1',
              groupId: 'g1',
              workspaceId: 'workspace-1',
              workspaceName: 'demo',
              paneId: 'pane-1',
              rootPath: 'C:/demo',
              role: 'srv',
              alias: 'demo-srv',
              branch: 'main',
              activeProvider: null,
              activeSessionId: null,
              activeSessionLabel: null,
              lastIntent: null,
              lastResult: null,
              blockers: null,
              createdAt: 0,
              updatedAt: 0
            }
          ],
          createdAt: 0,
          updatedAt: 0
        }
      ],
      activeGroupId: 'g1',
      activeMemberId: 'm1'
    })

    const { result } = renderHook(() => useSlashDispatcher({ workspace, pane }))
    await act(async () => {
      await result.current({ id: 'integration', label: '/integration', hint: '', description: '' }, '')
    })
    expect(terminalWrite).toHaveBeenCalledTimes(1)
    const data = terminalWrite.mock.calls[0][0].data as string
    expect(data).toContain('CONTEXT_MARKDOWN_FROM_IPC')
  })

  test('"members" sub-command lists each member with branch and agent slot', async () => {
    useIntegrationStore.setState({
      groups: [
        {
          id: 'g1',
          name: 'F',
          goal: '',
          description: null,
          status: 'active',
          activeWorkspaceId: 'workspace-1',
          members: [
            {
              id: 'm1', groupId: 'g1', workspaceId: 'workspace-1', workspaceName: 'demo', paneId: 'pane-1', rootPath: 'C:/demo',
              role: 'srv', alias: 'srv-demo', branch: 'main', activeProvider: 'claude', activeSessionId: 'sess', activeSessionLabel: null,
              lastIntent: null, lastResult: null, blockers: null, createdAt: 0, updatedAt: 0
            },
            {
              id: 'm2', groupId: 'g1', workspaceId: 'workspace-2', workspaceName: 'fed-repo', paneId: null, rootPath: 'C:/fed',
              role: 'fed', alias: 'fed-app', branch: 'feat/checkout', activeProvider: null, activeSessionId: null, activeSessionLabel: null,
              lastIntent: null, lastResult: null, blockers: null, createdAt: 0, updatedAt: 0
            }
          ],
          createdAt: 0, updatedAt: 0
        }
      ],
      activeGroupId: 'g1', activeMemberId: 'm1'
    })

    const { result } = renderHook(() => useSlashDispatcher({ workspace, pane }))
    await act(async () => {
      await result.current({ id: 'integration', label: '/integration', hint: '', description: '' }, 'members')
    })
    const data = terminalWrite.mock.calls[0][0].data as string
    expect(data).toMatch(/srv\/srv-demo/)
    expect(data).toMatch(/branch=main/)
    expect(data).toMatch(/agent=claude/)
    expect(data).toMatch(/fed\/fed-app/)
    expect(data).toMatch(/branch=feat\/checkout/)
    expect(data).toMatch(/agent=—/)
  })

  test('"handoff <role> <message>" creates a handoff via the store IPC', async () => {
    useIntegrationStore.setState({
      groups: [
        {
          id: 'g1', name: 'F', goal: '', description: null, status: 'active', activeWorkspaceId: 'workspace-1',
          members: [
            { id: 'm1', groupId: 'g1', workspaceId: 'workspace-1', workspaceName: 'demo', paneId: 'pane-1', rootPath: 'C:/demo', role: 'srv', alias: 'srv', branch: 'main', activeProvider: null, activeSessionId: null, activeSessionLabel: null, lastIntent: null, lastResult: null, blockers: null, createdAt: 0, updatedAt: 0 },
            { id: 'm2', groupId: 'g1', workspaceId: 'workspace-2', workspaceName: 'fed', paneId: null, rootPath: 'C:/fed', role: 'fed', alias: 'fed', branch: 'main', activeProvider: null, activeSessionId: null, activeSessionLabel: null, lastIntent: null, lastResult: null, blockers: null, createdAt: 0, updatedAt: 0 }
          ],
          createdAt: 0, updatedAt: 0
        }
      ],
      activeGroupId: 'g1', activeMemberId: 'm1'
    })

    const { result } = renderHook(() => useSlashDispatcher({ workspace, pane }))
    await act(async () => {
      await result.current({ id: 'integration', label: '/integration', hint: '', description: '' }, 'handoff fed Please ship the checkout endpoint')
    })

    expect((window.oxe.integration.createHandoff as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith(expect.objectContaining({
      groupId: 'g1',
      fromMemberId: 'm1',
      toMemberId: 'm2',
      content: 'Please ship the checkout endpoint',
      status: 'sent'
    }))
  })
})
