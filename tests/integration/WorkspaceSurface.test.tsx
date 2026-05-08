import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
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

describe('WorkspaceSurface', () => {
  test('renders editor as a separate region when visible', () => {
    render(<WorkspaceSurface workspace={createWorkspace({ editorVisible: true })} maximizedPaneId={null} onToggleMaximize={() => undefined} onUpdateEditorState={() => undefined} />)

    expect(screen.getByTestId('workspace-grid')).toBeInTheDocument()
    expect(screen.getByTestId('workspace-editor-panel')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Collapse workspace editor' })).toBeInTheDocument()
  })

  test('shows a topbar editor control and persists visibility when collapsed', async () => {
    const user = userEvent.setup()
    const onUpdateEditorState = vi.fn()
    render(<WorkspaceSurface workspace={createWorkspace({ editorVisible: false })} maximizedPaneId={null} onToggleMaximize={() => undefined} onUpdateEditorState={onUpdateEditorState} />)

    expect(document.querySelector('.workspace-editor-rail')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Open workspace editor' }))

    expect(onUpdateEditorState).toHaveBeenCalledWith({ workspaceId: 'workspace-1', editorVisible: true, editorExpanded: false })
  })

  test('persists expanded and collapsed editor state', async () => {
    const user = userEvent.setup()
    const onUpdateEditorState = vi.fn()
    render(<WorkspaceSurface workspace={createWorkspace({ editorVisible: true })} maximizedPaneId={null} onToggleMaximize={() => undefined} onUpdateEditorState={onUpdateEditorState} />)

    await user.click(screen.getByText('Expand editor'))
    await user.click(screen.getByText('Collapse editor'))

    expect(onUpdateEditorState).toHaveBeenCalledWith({ workspaceId: 'workspace-1', editorExpanded: true, editorWidthPercent: 70 })
    expect(onUpdateEditorState).toHaveBeenCalledWith({ workspaceId: 'workspace-1', editorVisible: false, editorExpanded: false })
  })
})

function createWorkspace(overrides: Partial<Workspace> = {}): Workspace {
  return {
    id: 'workspace-1',
    name: 'repo',
    rootPath: 'C:/repo',
    layout: '1x1',
    defaultShellProfileId: 'builtin-claude',
    autoStart: false,
    isActive: true,
    editorVisible: false,
    editorExpanded: false,
    editorWidthPercent: 40,
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
