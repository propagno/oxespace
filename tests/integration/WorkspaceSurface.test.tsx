import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useEffect, useState, type ReactElement } from 'react'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import type { Workspace } from '../../shared/types/workspace'
import { WorkspaceSurface } from '../../src/components/Workspace/WorkspaceSurface'

const gridLifecycle = {
  mounts: 0,
  unmounts: 0
}

vi.mock('../../src/components/Grid/WorkspaceGrid', () => ({
  WorkspaceGrid: () => {
    useEffect(() => {
      gridLifecycle.mounts += 1
      return () => {
        gridLifecycle.unmounts += 1
      }
    }, [])
    return <div data-testid="workspace-grid">Grid</div>
  }
}))

vi.mock('../../src/components/Workspace/WorkspaceEditorPanel', () => ({
  WorkspaceEditorPanel: ({ onCollapse, onToggleExpanded }: { onCollapse: () => void; onToggleExpanded: () => void }) => (
    <section data-testid="workspace-editor-panel">
      <button type="button" onClick={onToggleExpanded}>Expand editor</button>
      <button type="button" onClick={onCollapse}>Collapse editor</button>
    </section>
  )
}))

vi.mock('../../src/components/Workspace/WorkspaceGitHubPanel', () => ({
  WorkspaceGitHubPanel: ({ onCollapse, onToggleExpanded }: { onCollapse: () => void; onToggleExpanded: () => void }) => (
    <section data-testid="workspace-github-panel">
      <button type="button" onClick={onToggleExpanded}>Expand GitHub</button>
      <button type="button" onClick={onCollapse}>Collapse GitHub</button>
    </section>
  )
}))

vi.mock('../../src/components/Workspace/WorkspaceBackgroundPanel', () => ({
  WorkspaceBackgroundPanel: ({ onCollapse, onToggleExpanded }: { onCollapse: () => void; onToggleExpanded: () => void }) => (
    <section data-testid="workspace-background-panel">
      <button type="button" onClick={onToggleExpanded}>Expand Background</button>
      <button type="button" onClick={onCollapse}>Collapse Background</button>
    </section>
  )
}))

vi.mock('../../src/components/Workspace/WorkspaceScriptsPanel', () => ({
  WorkspaceScriptsPanel: ({ onCollapse, onToggleExpanded }: { onCollapse: () => void; onToggleExpanded: () => void }) => (
    <section data-testid="workspace-scripts-panel">
      <button type="button" onClick={onToggleExpanded}>Expand Scripts</button>
      <button type="button" onClick={onCollapse}>Collapse Scripts</button>
    </section>
  )
}))

vi.mock('../../src/components/Workspace/WorkspaceWebPreviewPanel', () => ({
  WorkspaceWebPreviewPanel: ({ onCollapse, onToggleExpanded }: { onCollapse: () => void; onToggleExpanded: () => void }) => (
    <section data-testid="workspace-web-preview-panel">
      <button type="button" onClick={onToggleExpanded}>Expand Web Preview</button>
      <button type="button" onClick={onCollapse}>Collapse Web Preview</button>
    </section>
  )
}))

vi.mock('../../src/components/Workspace/WorkspaceReviewPanel', () => ({
  WorkspaceReviewPanel: ({ onCollapse, onToggleExpanded }: { onCollapse: () => void; onToggleExpanded: () => void }) => (
    <section data-testid="workspace-review-panel">
      <button type="button" onClick={onToggleExpanded}>Expand Review</button>
      <button type="button" onClick={onCollapse}>Collapse Review</button>
    </section>
  )
}))

describe('WorkspaceSurface', () => {
  beforeEach(() => {
    gridLifecycle.mounts = 0
    gridLifecycle.unmounts = 0
  })

  test('renders editor as a separate region when visible', async () => {
    renderSurface(createWorkspace({ editorVisible: true }))

    expect(screen.getByTestId('workspace-grid')).toBeInTheDocument()
    // Panels are lazy-loaded — await the async import boundary.
    expect(await screen.findByTestId('workspace-editor-panel')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Collapse editor' })).toBeInTheDocument()
  })

  test('keeps WorkspaceGrid mounted across maximize/restore so terminal scrollback survives', async () => {
    const workspace = createWorkspace({ editorVisible: true })
    const { rerender } = render(
      <WorkspaceSurface
        workspace={workspace}
        maximizedPaneId={null}
        onToggleMaximize={() => undefined}
        scriptsVisible={false}
        webPreviewVisible={false}
        integrationVisible={false}
        onCloseScripts={() => undefined}
        onCloseWebPreview={() => undefined}
        onCloseIntegration={() => undefined}
        onRunCommand={() => undefined}
        onUpdateEditorState={() => undefined}
        onUpdateReviewState={() => undefined}
        onUpdateGitHubState={() => undefined}
        onUpdateBackgroundState={() => undefined}
        onUpdateWorktreeState={() => undefined}
        onSelectWorkspace={() => undefined}
        workspaces={[workspace]}
        activePaneId={null}
      />
    )

    expect(screen.getByTestId('workspace-grid')).toBeInTheDocument()
    expect(await screen.findByTestId('workspace-editor-panel')).toBeInTheDocument()
    expect(gridLifecycle.mounts).toBe(1)
    expect(gridLifecycle.unmounts).toBe(0)

    // Maximize: side panels hide for full-width terminal, grid host must stay.
    rerender(
      <WorkspaceSurface
        workspace={workspace}
        maximizedPaneId="pane-1"
        onToggleMaximize={() => undefined}
        scriptsVisible={false}
        webPreviewVisible={false}
        integrationVisible={false}
        onCloseScripts={() => undefined}
        onCloseWebPreview={() => undefined}
        onCloseIntegration={() => undefined}
        onRunCommand={() => undefined}
        onUpdateEditorState={() => undefined}
        onUpdateReviewState={() => undefined}
        onUpdateGitHubState={() => undefined}
        onUpdateBackgroundState={() => undefined}
        onUpdateWorktreeState={() => undefined}
        onSelectWorkspace={() => undefined}
        workspaces={[workspace]}
        activePaneId={null}
      />
    )

    expect(screen.getByTestId('workspace-grid')).toBeInTheDocument()
    expect(screen.queryByTestId('workspace-editor-panel')).not.toBeInTheDocument()
    expect(gridLifecycle.mounts).toBe(1)
    expect(gridLifecycle.unmounts).toBe(0)

    // Restore: side panels return; grid still the same instance.
    rerender(
      <WorkspaceSurface
        workspace={workspace}
        maximizedPaneId={null}
        onToggleMaximize={() => undefined}
        scriptsVisible={false}
        webPreviewVisible={false}
        integrationVisible={false}
        onCloseScripts={() => undefined}
        onCloseWebPreview={() => undefined}
        onCloseIntegration={() => undefined}
        onRunCommand={() => undefined}
        onUpdateEditorState={() => undefined}
        onUpdateReviewState={() => undefined}
        onUpdateGitHubState={() => undefined}
        onUpdateBackgroundState={() => undefined}
        onUpdateWorktreeState={() => undefined}
        onSelectWorkspace={() => undefined}
        workspaces={[workspace]}
        activePaneId={null}
      />
    )

    expect(screen.getByTestId('workspace-grid')).toBeInTheDocument()
    expect(await screen.findByTestId('workspace-editor-panel')).toBeInTheDocument()
    expect(gridLifecycle.mounts).toBe(1)
    expect(gridLifecycle.unmounts).toBe(0)
  })

  test('does not render the removed topbar Tools dropdown', () => {
    renderSurface(createWorkspace())

    expect(screen.queryByRole('button', { name: 'Tools' })).not.toBeInTheDocument()
    expect(screen.getByLabelText('Workspace status')).toBeInTheDocument()
  })

  test('persists expanded and collapsed editor state', async () => {
    const user = userEvent.setup()
    const onUpdateEditorState = vi.fn()
    renderSurface(createWorkspace({ editorVisible: true }), { onUpdateEditorState })

    await user.click(screen.getByText('Expand editor'))
    await user.click(screen.getByText('Collapse editor'))

    expect(onUpdateEditorState).toHaveBeenCalledWith({ workspaceId: 'workspace-1', editorExpanded: true, editorWidthPercent: 70 })
    expect(onUpdateEditorState).toHaveBeenCalledWith({ workspaceId: 'workspace-1', editorVisible: false, editorExpanded: false })
  })

  test('renders Scripts and Web Preview as separate workspace regions', async () => {
    const user = userEvent.setup()
    const onCloseScripts = vi.fn()
    const onCloseWebPreview = vi.fn()
    renderSurface(createWorkspace(), { scriptsVisible: true, webPreviewVisible: true, onCloseScripts, onCloseWebPreview })

    expect(screen.getByTestId('workspace-grid')).toBeInTheDocument()
    expect(await screen.findByTestId('workspace-scripts-panel')).toBeInTheDocument()
    expect(await screen.findByTestId('workspace-web-preview-panel')).toBeInTheDocument()

    await user.click(screen.getByText('Collapse Scripts'))
    await user.click(screen.getByText('Collapse Web Preview'))

    expect(onCloseScripts).toHaveBeenCalled()
    expect(onCloseWebPreview).toHaveBeenCalled()
  })

  test('renders GitHub panel separately and collapses it', async () => {
    const user = userEvent.setup()
    render(<ControlledSurface />)

    expect(screen.getByTestId('workspace-grid')).toBeInTheDocument()
    expect(await screen.findByTestId('workspace-github-panel')).toBeInTheDocument()

    await user.click(screen.getByText('Collapse GitHub'))
    expect(screen.getByTestId('workspace-grid')).toBeInTheDocument()
    expect(screen.queryByTestId('workspace-github-panel')).not.toBeInTheDocument()
  })
})

function renderSurface(
  workspace: Workspace,
  overrides: Partial<Parameters<typeof WorkspaceSurface>[0]> = {}
): void {
  render(
    <WorkspaceSurface
      workspace={workspace}
      maximizedPaneId={null}
      onToggleMaximize={() => undefined}
      scriptsVisible={false}
      webPreviewVisible={false}
      integrationVisible={false}
      onCloseScripts={() => undefined}
      onCloseWebPreview={() => undefined}
      onCloseIntegration={() => undefined}
      onRunCommand={() => undefined}
      onUpdateEditorState={() => undefined}
      onUpdateReviewState={() => undefined}
      onUpdateGitHubState={() => undefined}
      onUpdateBackgroundState={() => undefined}
      onUpdateWorktreeState={() => undefined}
      onSelectWorkspace={() => undefined}
      workspaces={[workspace]}
      activePaneId={null}
      {...overrides}
    />
  )
}

function ControlledSurface(): ReactElement {
  const [workspace, setWorkspace] = useState(createWorkspace({ githubPanelVisible: true, githubPanelExpanded: true, githubPanelWidthPercent: 70 }))

  return (
    <WorkspaceSurface
      workspace={workspace}
      maximizedPaneId={null}
      onToggleMaximize={() => undefined}
      scriptsVisible={false}
      webPreviewVisible={false}
      integrationVisible={false}
      onCloseScripts={() => undefined}
      onCloseWebPreview={() => undefined}
      onCloseIntegration={() => undefined}
      onRunCommand={() => undefined}
      onUpdateEditorState={(input) => setWorkspace((current) => ({ ...current, ...input }))}
      onUpdateReviewState={(input) => setWorkspace((current) => ({ ...current, ...input }))}
      onUpdateGitHubState={(input) => setWorkspace((current) => ({ ...current, ...input }))}
      onUpdateBackgroundState={(input) => setWorkspace((current) => ({ ...current, ...input }))}
      onUpdateWorktreeState={(input) => setWorkspace((current) => ({ ...current, ...input }))}
      onSelectWorkspace={() => undefined}
      workspaces={[workspace]}
      activePaneId={null}
    />
  )
}

function createWorkspace(overrides: Partial<Workspace> = {}): Workspace {
  return {
    id: 'workspace-1',
    name: 'repo',
    rootPath: 'C:/repo',
    layout: '1x1',
    layoutPreset: 1,
    themeId: 'midnight',
    uiDensity: 'compact',
    defaultShellProfileId: 'builtin-claude',
    autoStart: false,
    isActive: true,
    editorVisible: false,
    editorExpanded: false,
    editorWidthPercent: 40,
    reviewPanelVisible: false,
    reviewPanelExpanded: false,
    reviewPanelWidthPercent: 36,
    githubPanelVisible: false,
    githubPanelExpanded: false,
    githubPanelWidthPercent: 40,
    githubActiveTab: 'status',
    backgroundPanelVisible: false,
    backgroundPanelExpanded: false,
    backgroundPanelWidthPercent: 28,
    panes: [
      {
        id: 'pane-1',
        workspaceId: 'workspace-1',
        type: 'terminal',
        rowIndex: 0,
        columnIndex: 0,
        shellProfileId: 'builtin-claude',
        status: 'idle',
        agentProfileId: null,
        agentName: null,
        displayName: null,
        createdAt: null,
        modelOverride: null,
        rootPath: null
      }
    ],
    ...overrides
  }
}
