// Frozen acceptance test for 1.5.2 P0 (Jira OXE-367; A16). Written by the planner; the executor must not edit it.
// WorkspaceSurface asks window.oxe.workspace.rootStatus(id). When it answers { available: false } the grid (and so every
// terminal start) is replaced by an alert (data-testid workspace-missing-root, the existing ErrorState primitive, no
// new visual element) with two actions: code:workspace.missingRoot.relink (pickFolder, then
// window.oxe.workspace.relink, then the store takes the returned workspace) and code:sidebar.remove (asks, then
// workspace.store closeWorkspace). With no answer, or { available: true }, the surface is as before.
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { Workspace } from '../../../shared/types/workspace'
import { WorkspaceSurface } from '../../../src/components/Workspace/WorkspaceSurface'
import { i18n } from '../../../src/i18n'
import { useWorkspaceStore } from '../../../src/store/workspace.store'

vi.mock('../../../src/components/Grid/WorkspaceGrid', () => ({ WorkspaceGrid: () => <div data-testid="workspace-grid" /> }))
vi.mock('../../../src/components/Grid/WorkspaceSplitGrid', () => ({ WorkspaceSplitGrid: () => <div data-testid="workspace-grid" /> }))

const workspace = {
  id: 'ws-1', name: 'api', rootPath: '/work/api', layout: '1x1', layoutPreset: 1, themeId: 'midnight', uiDensity: 'compact', defaultShellProfileId: 'sh', autoStart: false, isActive: true,
  panes: [{ id: 'p1', workspaceId: 'ws-1', type: 'terminal', rowIndex: 0, columnIndex: 0, shellProfileId: 'sh', status: 'idle', agentProfileId: null, agentName: null, displayName: null, createdAt: null, rootPath: null }]
} as unknown as Workspace
const noop = (): void => undefined
let api: { rootStatus: ReturnType<typeof vi.fn>; pickFolder: ReturnType<typeof vi.fn>; relink: ReturnType<typeof vi.fn>; delete: ReturnType<typeof vi.fn> }
let closeWorkspace: ReturnType<typeof vi.fn>

beforeEach(() => {
  api = {
    rootStatus: vi.fn(async () => ({ available: false })),
    pickFolder: vi.fn(async () => '/work/api-moved'),
    relink: vi.fn(async () => ({ ...workspace, rootPath: '/work/api-moved' })),
    delete: vi.fn(async () => undefined)
  }
  closeWorkspace = vi.fn(async () => undefined)
  window.oxe = { ...window.oxe, workspace: api } as never
  useWorkspaceStore.setState({ workspaces: [workspace], closeWorkspace } as never)
})
afterEach(cleanup)

const confirmation = (): Promise<HTMLElement> => vi.waitFor(() => {
  const dialog = document.querySelector<HTMLElement>('[role="alertdialog"], [role="dialog"]')
  expect(dialog, 'the confirmation is open').not.toBeNull()
  return dialog!
})

function surface(): void {
  render(<WorkspaceSurface {...({
    workspace, workspaces: [workspace], activePaneId: null, maximizedPaneId: null, webPreviewVisible: false, integrationVisible: false, searchVisible: false,
    onToggleMaximize: noop, onCloseWebPreview: noop, onCloseIntegration: noop, onCloseSearch: noop, onRunCommand: noop, onSelectWorkspace: noop,
    onUpdateEditorState: noop, onUpdateReviewState: noop, onUpdateGitHubState: noop, onUpdateBackgroundState: noop, onUpdateWorktreeState: noop
  } as never as Parameters<typeof WorkspaceSurface>[0])} />)
}

describe('OXE-367 · the workspace folder is gone', () => {
  test('the missing folder state replaces the terminals and offers Relink and Remove', async () => {
    surface()
    const state = await screen.findByTestId('workspace-missing-root')
    expect(screen.queryByTestId('workspace-grid'), 'no pane tries to start').toBeNull()
    expect(i18n.exists('code:workspace.missingRoot.relink'), 'the action is in the catalog').toBe(true)
    within(state).getByRole('button', { name: i18n.t('code:workspace.missingRoot.relink') })
    within(state).getByRole('button', { name: i18n.t('code:sidebar.remove') })
  })

  test('Relink sends the picked folder to main and the store takes the new root', async () => {
    surface()
    const state = await screen.findByTestId('workspace-missing-root')
    fireEvent.click(within(state).getByRole('button', { name: i18n.t('code:workspace.missingRoot.relink') }))
    await vi.waitFor(() => expect(api.relink).toHaveBeenCalledWith({ workspaceId: 'ws-1', rootPath: '/work/api-moved' }))
    await vi.waitFor(() => expect(useWorkspaceStore.getState().workspaces[0].rootPath).toBe('/work/api-moved'))
  })

  test('Remove asks first and then removes only the workspace', async () => {
    surface()
    const state = await screen.findByTestId('workspace-missing-root')
    fireEvent.click(within(state).getByRole('button', { name: i18n.t('code:sidebar.remove') }))
    expect(closeWorkspace, 'nothing is removed before confirming').not.toHaveBeenCalled()
    const dialog = await confirmation()
    fireEvent.click(within(dialog).getByRole('button', { name: i18n.t('code:sidebar.remove') }))
    await vi.waitFor(() => expect(closeWorkspace).toHaveBeenCalledWith('ws-1'))
  })

  test('a folder that is there shows the terminals as before', async () => {
    api.rootStatus.mockResolvedValue({ available: true })
    surface()
    expect(await screen.findByTestId('workspace-grid')).toBeInTheDocument()
    expect(screen.queryByTestId('workspace-missing-root')).toBeNull()
  })
})
