import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState, type ReactElement } from 'react'
import { describe, expect, test, vi } from 'vitest'
import type { Workspace } from '../../shared/types/workspace'
import { WorkspaceSurface } from '../../src/components/Workspace/WorkspaceSurface'

vi.mock('../../src/components/Grid/WorkspaceGrid', () => ({
  WorkspaceGrid: () => <div data-testid="workspace-grid">Grid</div>
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
  test('renders editor as a separate region when visible', () => {
    renderSurface(createWorkspace({ editorVisible: true }))

    expect(screen.getByTestId('workspace-grid')).toBeInTheDocument()
    expect(screen.getByTestId('workspace-editor-panel')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Collapse editor' })).toBeInTheDocument()
  })

  test('shows a topbar editor control and persists visibility when collapsed', async () => {
    const user = userEvent.setup()
    const onUpdateEditorState = vi.fn()
    renderSurface(createWorkspace({ editorVisible: false }), { onUpdateEditorState })

    await user.click(screen.getByRole('button', { name: 'Tools' }))
    await user.click(screen.getByRole('menuitem', { name: /Editor/ }))

    expect(onUpdateEditorState).toHaveBeenCalledWith({ workspaceId: 'workspace-1', editorVisible: true, editorExpanded: false })
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
    expect(screen.getByTestId('workspace-scripts-panel')).toBeInTheDocument()
    expect(screen.getByTestId('workspace-web-preview-panel')).toBeInTheDocument()

    await user.click(screen.getByText('Collapse Scripts'))
    await user.click(screen.getByText('Collapse Web Preview'))

    expect(onCloseScripts).toHaveBeenCalled()
    expect(onCloseWebPreview).toHaveBeenCalled()
  })

  test('renders GitHub panel separately and never exposes removed OXE tools', async () => {
    const user = userEvent.setup()
    render(<ControlledSurface />)

    expect(screen.getByTestId('workspace-grid')).toBeInTheDocument()
    expect(screen.getByTestId('workspace-github-panel')).toBeInTheDocument()

    await user.click(screen.getByText('Collapse GitHub'))
    expect(screen.getByTestId('workspace-grid')).toBeInTheDocument()
    expect(screen.queryByTestId('workspace-github-panel')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Tools' }))
    expect(screen.queryByRole('menuitem', { name: /OXE/ })).not.toBeInTheDocument()
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
      onOpenCommandPalette={() => undefined}
      onOpenWorkspaceSettings={() => undefined}
      onOpenHistory={() => undefined}
      onOpenMcp={() => undefined}
      onOpenSkills={() => undefined}
      onOpenScripts={() => undefined}
      onOpenWebPreview={() => undefined}
      scriptsVisible={false}
      webPreviewVisible={false}
      onCloseScripts={() => undefined}
      onCloseWebPreview={() => undefined}
      onRunCommand={() => undefined}
      onUpdateEditorState={() => undefined}
      onUpdateReviewState={() => undefined}
      onUpdateGitHubState={() => undefined}
      onUpdateBackgroundState={() => undefined}
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
      onOpenCommandPalette={() => undefined}
      onOpenWorkspaceSettings={() => undefined}
      onOpenHistory={() => undefined}
      onOpenMcp={() => undefined}
      onOpenSkills={() => undefined}
      onOpenScripts={() => undefined}
      onOpenWebPreview={() => undefined}
      scriptsVisible={false}
      webPreviewVisible={false}
      onCloseScripts={() => undefined}
      onCloseWebPreview={() => undefined}
      onRunCommand={() => undefined}
      onUpdateEditorState={(input) => setWorkspace((current) => ({ ...current, ...input }))}
      onUpdateReviewState={(input) => setWorkspace((current) => ({ ...current, ...input }))}
      onUpdateGitHubState={(input) => setWorkspace((current) => ({ ...current, ...input }))}
      onUpdateBackgroundState={(input) => setWorkspace((current) => ({ ...current, ...input }))}
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
