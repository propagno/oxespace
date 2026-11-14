// Frozen acceptance test for 1.5.2 OxeCode A3 (OXE program oxespace-152-code, phase F2, Jira OXE-40 and OXE-56).
// Written by the planner; the executor must not edit it.
// Cause (diagnosis: scratchpad diag-oxecode-perf.md): WorkspaceSurface uses plain React.lazy for its side panels, so
// the first open of each panel shows the Suspense fallback for ~300 ms even when the module has already loaded (React
// holds a revealed fallback). The bare import() prefetch does not help a plain lazy. Contract:
// src/components/Workspace/panelChunks.ts exports `preloadWorkspacePanels(): Promise<void>`, which loads every side
// panel's chunk (src/lib/chunk.ts `chunk`); WorkspaceSurface renders the panels with `lazyFrom` over those chunks and
// starts the preload itself after first paint. Once the chunks have arrived, opening a panel renders it in the same
// commit, with no `panel-loading` fallback.
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

const PANELS: Array<{ name: string; testid: string; open: { ws?: Partial<Workspace>; extra?: Extra } }> = [
  { name: 'Commit & pull request', testid: 'workspace-github-panel', open: { ws: { githubPanelVisible: true } } },
  { name: 'Changes', testid: 'workspace-review-panel', open: { ws: { reviewPanelVisible: true } } },
  { name: 'Background', testid: 'workspace-background-panel', open: { ws: { backgroundPanelVisible: true } } },
  { name: 'Worktrees', testid: 'workspace-worktree-panel', open: { ws: { worktreePanelVisible: true } as Partial<Workspace> } },
  { name: 'Browser', testid: 'workspace-web-preview-panel', open: { extra: { webPreviewVisible: true } } },
  { name: 'Find in files', testid: 'workspace-search-panel', open: { extra: { searchVisible: true } } },
  { name: 'Files', testid: 'workspace-editor-panel', open: { ws: { editorVisible: true } } }
]

afterEach(() => { cleanup() })

describe('A3 · a side panel opens in the same commit once its chunk has arrived (OXE-40, OXE-56)', () => {
  test.each(PANELS)('$name renders at once, with no loading fallback', async ({ testid, open }) => {
    const { preloadWorkspacePanels } = await import('../../../src/components/Workspace/panelChunks') as { preloadWorkspacePanels: () => Promise<void> }
    await preloadWorkspacePanels()
    const { WorkspaceSurface } = await import('../../../src/components/Workspace/WorkspaceSurface')
    const closed = createWorkspace()
    const { rerender } = render(<WorkspaceSurface {...props(closed)} />)
    const fallbacks: string[] = []
    const observer = new MutationObserver(records => { for (const record of records) record.addedNodes.forEach(node => {
      if (node instanceof HTMLElement && (node.matches('[data-testid="panel-loading"]') || node.querySelector('[data-testid="panel-loading"]'))) fallbacks.push('fallback')
    }) })
    observer.observe(document.body, { childList: true, subtree: true })
    act(() => { rerender(<WorkspaceSurface {...props(createWorkspace(open.ws), open.extra)} />) })
    expect(screen.queryByTestId(testid)).not.toBeNull()
    observer.disconnect()
    expect(fallbacks).toEqual([])
  }, 30_000)

  test('WorkspaceSurface starts the preload by itself: after first paint every panel opens without a fallback', async () => {
    const { WorkspaceSurface } = await import('../../../src/components/Workspace/WorkspaceSurface')
    const closed = createWorkspace()
    const { rerender } = render(<WorkspaceSurface {...props(closed)} />)
    await vi.waitFor(async () => {
      const chunks = await import('../../../src/components/Workspace/panelChunks') as { WORKSPACE_PANEL_CHUNKS?: Record<string, { get: () => unknown }> }
      expect(chunks.WORKSPACE_PANEL_CHUNKS).toBeDefined()
      for (const chunk of Object.values(chunks.WORKSPACE_PANEL_CHUNKS!)) expect(chunk.get()).toBeDefined()
    }, { timeout: 5000, interval: 50 })
    act(() => { rerender(<WorkspaceSurface {...props(createWorkspace({ githubPanelVisible: true }))} />) })
    expect(screen.queryByTestId('workspace-github-panel')).not.toBeNull()
  }, 30_000)
})
