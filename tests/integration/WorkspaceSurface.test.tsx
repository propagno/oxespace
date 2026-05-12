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
      <button type="button" onClick={onToggleExpanded}>
        Expand editor
      </button>
      <button type="button" onClick={onCollapse}>
        Collapse editor
      </button>
    </section>
  )
}))

vi.mock('../../src/components/Workspace/WorkspaceOxePanel', () => ({
  WorkspaceOxePanel: ({
    onCollapse,
    onOpenArtifact,
    onToggleExpanded
  }: {
    onCollapse: () => void
    onOpenArtifact: (relativePath: string) => void
    onToggleExpanded: () => void
  }) => (
    <section data-testid="workspace-oxe-panel">
      <button type="button" onClick={onToggleExpanded}>
        Expand OXE
      </button>
      <button type="button" onClick={() => onOpenArtifact('.oxe/PLAN.md')}>
        Open PLAN
      </button>
      <button type="button" onClick={onCollapse}>
        Collapse OXE
      </button>
    </section>
  )
}))

vi.mock('../../src/components/Workspace/WorkspaceAgentsPanel', () => ({
  WorkspaceAgentsPanel: ({ onCollapse, onToggleExpanded }: { onCollapse: () => void; onToggleExpanded: () => void }) => (
    <section data-testid="workspace-agents-panel">
      <button type="button" onClick={onToggleExpanded}>
        Expand Agents
      </button>
      <button type="button" onClick={onCollapse}>
        Collapse Agents
      </button>
    </section>
  )
}))

describe('WorkspaceSurface', () => {
  test('renders editor as a separate region when visible', () => {
    render(
      <WorkspaceSurface
        workspace={createWorkspace({ editorVisible: true })}
        maximizedPaneId={null}
        onToggleMaximize={() => undefined}
        onOpenCommandPalette={() => undefined}
        onOpenWorkspaceSettings={() => undefined}
        onUpdateEditorState={() => undefined}
        onUpdateOxeState={() => undefined}
        onOpenOxeArtifact={() => undefined}
        onRunOxeCommand={() => undefined}
      />
    )

    expect(screen.getByTestId('workspace-grid')).toBeInTheDocument()
    expect(screen.getByTestId('workspace-editor-panel')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Collapse workspace editor' })).toBeInTheDocument()
  })

  test('shows a topbar editor control and persists visibility when collapsed', async () => {
    const user = userEvent.setup()
    const onUpdateEditorState = vi.fn()
    render(
      <WorkspaceSurface
        workspace={createWorkspace({ editorVisible: false })}
        maximizedPaneId={null}
        onToggleMaximize={() => undefined}
        onOpenCommandPalette={() => undefined}
        onOpenWorkspaceSettings={() => undefined}
        onUpdateEditorState={onUpdateEditorState}
        onUpdateOxeState={() => undefined}
        onOpenOxeArtifact={() => undefined}
        onRunOxeCommand={() => undefined}
      />
    )

    expect(document.querySelector('.workspace-editor-rail')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Open workspace editor' }))

    expect(onUpdateEditorState).toHaveBeenCalledWith({ workspaceId: 'workspace-1', editorVisible: true, editorExpanded: false })
  })

  test('persists expanded and collapsed editor state', async () => {
    const user = userEvent.setup()
    const onUpdateEditorState = vi.fn()
    render(
      <WorkspaceSurface
        workspace={createWorkspace({ editorVisible: true })}
        maximizedPaneId={null}
        onToggleMaximize={() => undefined}
        onOpenCommandPalette={() => undefined}
        onOpenWorkspaceSettings={() => undefined}
        onUpdateEditorState={onUpdateEditorState}
        onUpdateOxeState={() => undefined}
        onOpenOxeArtifact={() => undefined}
        onRunOxeCommand={() => undefined}
      />
    )

    await user.click(screen.getByText('Expand editor'))
    await user.click(screen.getByText('Collapse editor'))

    expect(onUpdateEditorState).toHaveBeenCalledWith({ workspaceId: 'workspace-1', editorExpanded: true, editorWidthPercent: 70 })
    expect(onUpdateEditorState).toHaveBeenCalledWith({ workspaceId: 'workspace-1', editorVisible: false, editorExpanded: false })
  })

  test('renders OXE panel as a separate region and persists visibility', async () => {
    const user = userEvent.setup()
    const onUpdateOxeState = vi.fn()
    render(
      <WorkspaceSurface
        workspace={createWorkspace({ oxePanelVisible: true })}
        maximizedPaneId={null}
        onToggleMaximize={() => undefined}
        onOpenCommandPalette={() => undefined}
        onOpenWorkspaceSettings={() => undefined}
        onUpdateEditorState={() => undefined}
        onUpdateOxeState={onUpdateOxeState}
        onOpenOxeArtifact={() => undefined}
        onRunOxeCommand={() => undefined}
      />
    )

    expect(screen.getByTestId('workspace-grid')).toBeInTheDocument()
    expect(screen.getByTestId('workspace-oxe-panel')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Collapse OXE panel' })).toBeInTheDocument()

    await user.click(screen.getByText('Expand OXE'))
    await user.click(screen.getByText('Collapse OXE'))

    expect(onUpdateOxeState).toHaveBeenCalledWith({ workspaceId: 'workspace-1', oxePanelExpanded: true, oxePanelWidthPercent: 70 })
    expect(onUpdateOxeState).toHaveBeenCalledWith({ workspaceId: 'workspace-1', oxePanelVisible: false, oxePanelExpanded: false })
  })

  test('renders Agents panel as a separate workspace region and persists visibility', async () => {
    const user = userEvent.setup()
    const onUpdateAgentsState = vi.fn()
    render(
      <WorkspaceSurface
        workspace={createWorkspace({ agentsPanelVisible: true })}
        maximizedPaneId={null}
        onToggleMaximize={() => undefined}
        onOpenCommandPalette={() => undefined}
        onOpenWorkspaceSettings={() => undefined}
        onUpdateEditorState={() => undefined}
        onUpdateOxeState={() => undefined}
        onUpdateAgentsState={onUpdateAgentsState}
        onOpenOxeArtifact={() => undefined}
        onRunOxeCommand={() => undefined}
        onOpenWorkflowArtifact={() => undefined}
        activePaneId={null}
      />
    )

    expect(screen.getByTestId('workspace-grid')).toBeInTheDocument()
    expect(screen.getByTestId('workspace-agents-panel')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Collapse Agents panel' })).toBeInTheDocument()

    await user.click(screen.getByText('Expand Agents'))
    await user.click(screen.getByText('Collapse Agents'))

    expect(onUpdateAgentsState).toHaveBeenCalledWith({ workspaceId: 'workspace-1', agentsPanelExpanded: true, agentsPanelWidthPercent: 70 })
    expect(onUpdateAgentsState).toHaveBeenCalledWith({ workspaceId: 'workspace-1', agentsPanelVisible: false, agentsPanelExpanded: false })
  })

  test('keeps grid visible after collapsing OXE panel from expanded layout', async () => {
    const user = userEvent.setup()
    render(<ControlledSurface />)

    expect(screen.getByTestId('workspace-grid')).toBeInTheDocument()
    expect(screen.getByTestId('workspace-oxe-panel')).toBeInTheDocument()

    await user.click(screen.getByText('Collapse OXE'))

    expect(screen.getByTestId('workspace-grid')).toBeInTheDocument()
    expect(screen.queryByTestId('workspace-oxe-panel')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Open OXE panel' })).toBeInTheDocument()
  })

  test('keeps grid and editor visible after opening an OXE artifact then collapsing OXE', async () => {
    const user = userEvent.setup()
    render(<ControlledOxeArtifactSurface />)

    await user.click(screen.getByText('Open PLAN'))
    await user.click(screen.getByText('Collapse OXE'))

    expect(screen.getByTestId('workspace-grid')).toBeInTheDocument()
    expect(screen.getByTestId('workspace-editor-panel')).toBeInTheDocument()
    expect(screen.queryByTestId('workspace-oxe-panel')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Open OXE panel' })).toBeInTheDocument()
  })
})

function ControlledSurface(): ReactElement {
  const [workspace, setWorkspace] = useState(
    createWorkspace({
      editorVisible: true,
      editorExpanded: true,
      editorWidthPercent: 70,
      oxePanelVisible: true,
      oxePanelExpanded: true,
      oxePanelWidthPercent: 70
    })
  )

  return (
    <WorkspaceSurface
      workspace={workspace}
      maximizedPaneId={null}
      onToggleMaximize={() => undefined}
      onOpenCommandPalette={() => undefined}
      onOpenWorkspaceSettings={() => undefined}
      onUpdateEditorState={(input) => setWorkspace((current) => ({ ...current, ...input }))}
      onUpdateOxeState={(input) => setWorkspace((current) => ({ ...current, ...input }))}
      onOpenOxeArtifact={() => undefined}
      onRunOxeCommand={() => undefined}
    />
  )
}

function ControlledOxeArtifactSurface(): ReactElement {
  const [workspace, setWorkspace] = useState(
    createWorkspace({
      editorVisible: false,
      editorExpanded: true,
      editorWidthPercent: 70,
      oxePanelVisible: true,
      oxePanelExpanded: false,
      oxePanelWidthPercent: 36
    })
  )

  return (
    <WorkspaceSurface
      workspace={workspace}
      maximizedPaneId={null}
      onToggleMaximize={() => undefined}
      onOpenCommandPalette={() => undefined}
      onOpenWorkspaceSettings={() => undefined}
      onUpdateEditorState={(input) =>
        setWorkspace((current) => ({
          ...current,
          ...input,
          editorWidthPercent: input.editorWidthPercent ?? (input.editorVisible ? 40 : current.editorWidthPercent),
          editorExpanded: input.editorExpanded ?? (input.editorVisible ? false : current.editorExpanded)
        }))
      }
      onUpdateOxeState={(input) => setWorkspace((current) => ({ ...current, ...input }))}
      onOpenOxeArtifact={() => setWorkspace((current) => ({ ...current, editorVisible: true, editorExpanded: false, editorWidthPercent: 40 }))}
      onRunOxeCommand={() => undefined}
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
    oxePanelVisible: false,
    oxePanelExpanded: false,
    oxePanelWidthPercent: 36,
    agentsPanelVisible: false,
    agentsPanelExpanded: false,
    agentsPanelWidthPercent: 36,
    panes: [
      {
        id: 'pane-1',
        workspaceId: 'workspace-1',
        type: 'terminal',
        rowIndex: 0,
        columnIndex: 0,
        shellProfileId: 'builtin-claude',
        status: 'idle'
      }
    ],
    ...overrides
  }
}
