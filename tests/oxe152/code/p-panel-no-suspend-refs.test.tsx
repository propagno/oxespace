// OXE-310, beside the frozen p-panel-no-suspend.test.tsx (which stays as written): WorkspaceSurface after the hook
// cleanup. Its side panels open and switch as before, the side-panel list carries no resize handler that read refs
// while rendering (the ones there were never called; the outer panel's persistSideWidth does the work), and nothing is
// read from a ref while the list is built. Same mocked panels and workspace as the frozen spec.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { act, cleanup, render, screen } from '@testing-library/react'
import { useEffect } from 'react'
import { afterEach, describe, expect, test, vi } from 'vitest'
import type { Workspace } from '../../../shared/types/workspace'

const mocked = (testid: string) => () => <section data-testid={testid} />
vi.mock('../../../src/components/Grid/WorkspaceGrid', () => ({ WorkspaceGrid: () => <div data-testid="workspace-grid" /> }))
vi.mock('../../../src/components/Grid/WorkspaceSplitGrid', () => ({ WorkspaceSplitGrid: () => { useEffect(() => undefined, []); return <div data-testid="workspace-grid" /> } }))
vi.mock('../../../src/components/Workspace/WorkspaceEditorPanel', () => ({ WorkspaceEditorPanel: mocked('workspace-editor-panel') }))
vi.mock('../../../src/components/Workspace/WorkspaceGitHubPanel', () => ({ WorkspaceGitHubPanel: mocked('workspace-github-panel') }))
vi.mock('../../../src/components/Workspace/WorkspaceBackgroundPanel', () => ({ WorkspaceBackgroundPanel: mocked('workspace-background-panel') }))
vi.mock('../../../src/components/Workspace/WorkspaceWebPreviewPanel', () => ({ WorkspaceWebPreviewPanel: mocked('workspace-web-preview-panel') }))
vi.mock('../../../src/components/Workspace/WorkspaceReviewPanel', () => ({ WorkspaceReviewPanel: mocked('workspace-review-panel') }))
vi.mock('../../../src/components/Workspace/WorkspaceWorktreePanel', () => ({ WorkspaceWorktreePanel: mocked('workspace-worktree-panel') }))
vi.mock('../../../src/components/Workspace/WorkspaceSearchPanel', () => ({ WorkspaceSearchPanel: mocked('workspace-search-panel') }))

function createWorkspace(overrides: Partial<Workspace> = {}): Workspace {
  return { id: 'workspace-1', name: 'repo', rootPath: 'C:/repo', layout: '1x1', layoutPreset: 1, themeId: 'midnight', uiDensity: 'compact', defaultShellProfileId: 'builtin-claude', autoStart: false, isActive: true,
    editorVisible: false, editorExpanded: false, editorWidthPercent: 40, reviewPanelVisible: false, reviewPanelExpanded: false, reviewPanelWidthPercent: 36, githubPanelVisible: false, githubPanelExpanded: false, githubPanelWidthPercent: 40, githubActiveTab: 'status',
    backgroundPanelVisible: false, backgroundPanelExpanded: false, backgroundPanelWidthPercent: 28, worktreePanelVisible: false,
    panes: [{ id: 'pane-1', workspaceId: 'workspace-1', type: 'terminal', rowIndex: 0, columnIndex: 0, shellProfileId: 'builtin-claude', status: 'idle', agentProfileId: null, agentName: null, displayName: null, createdAt: null, modelOverride: null, rootPath: null }],
    ...overrides } as Workspace
}
type Extra = { webPreviewVisible?: boolean; searchVisible?: boolean }
const props = (workspace: Workspace, extra: Extra = {}) => ({ workspace, maximizedPaneId: null, onToggleMaximize: () => undefined, webPreviewVisible: extra.webPreviewVisible ?? false, integrationVisible: false, searchVisible: extra.searchVisible ?? false, onCloseWebPreview: () => undefined, onCloseIntegration: () => undefined, onCloseSearch: () => undefined, onRunCommand: () => undefined, onUpdateEditorState: () => undefined, onUpdateReviewState: () => undefined, onUpdateGitHubState: () => undefined, onUpdateBackgroundState: () => undefined, onUpdateWorktreeState: () => undefined, onSelectWorkspace: () => undefined, workspaces: [workspace], activePaneId: null })

afterEach(() => { cleanup() })

describe('OXE-310 · WorkspaceSurface after the hook cleanup', () => {
  test('WorkspaceSurface preserves panel state and focus refs cleanly', async () => {
    const { preloadWorkspacePanels } = await import('../../../src/components/Workspace/panelChunks') as { preloadWorkspacePanels: () => Promise<void> }
    await preloadWorkspacePanels()
    const { WorkspaceSurface } = await import('../../../src/components/Workspace/WorkspaceSurface')
    const { rerender } = render(<WorkspaceSurface {...props(createWorkspace({ githubPanelVisible: true }))} />)
    expect(screen.queryByTestId('workspace-github-panel')).not.toBeNull()
    act(() => { rerender(<WorkspaceSurface {...props(createWorkspace({ githubPanelVisible: true, reviewPanelVisible: true }))} />) })
    expect(screen.queryByTestId('workspace-review-panel')).not.toBeNull()
    act(() => { rerender(<WorkspaceSurface {...props(createWorkspace({ githubPanelVisible: true }))} />) })
    expect(screen.queryByTestId('workspace-github-panel')).not.toBeNull()
    expect(screen.queryByTestId('workspace-review-panel')).toBeNull()

    const source = readFileSync(join(process.cwd(), 'src/components/Workspace/WorkspaceSurface.tsx'), 'utf8')
    const entry = /interface SidePanelEntry \{([\s\S]*?)\n\}/.exec(source)?.[1] ?? ''
    expect(entry, 'the side-panel entry carries no resize handler').not.toMatch(/onResize/)
    const builder = source.slice(source.indexOf('const sidePanels: SidePanelEntry[] = []'), source.indexOf('const rootAvailable ='))
    expect(builder.length).toBeGreaterThan(0)
    expect(builder, 'no ref read while the side-panel list is built').not.toMatch(/\.current\b/)
  }, 30_000)
})
