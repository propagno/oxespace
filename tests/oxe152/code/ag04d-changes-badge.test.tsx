// Frozen acceptance test for 1.5.2 OxeCode/Shell F6 (OXE program oxespace-152-code, phase F6, Jira OXE-185, AG-04d), the
// window part. Written by the planner; the executor must not edit it. Source: the card OXE-185 (CA-1, RN-1; the same rule
// as OXE-169: "Alterações, N arquivos" / "Changes, N files", hidden at 0, "99+" above 99), approved by MARCA. Runs after
// OxeCode F5 (T24/T25 own WorkspaceSurface.tsx and turn the Changes toggle into an IconButton) and after A39's source.
// Today (main 66e0080d5) OxeCode's Changes button is only the icon and the label, with no count.
// Contract: the Changes toggle of the workspace bar (named from code:panels.changes) reads useChangedFilesCount for the
// active scope (window.oxe.git.changedCount({ rootPath: scope.rootPath })) without opening the panel; with N > 0 its
// accessible name is the plural pair panels.changesCount ("Changes, N files" / "Alterações, N arquivos"; the pair OXE-169
// adds, or this card adds it in code.json: one pair) and it shows N, "99+" above 99; at 0 no badge and the plain name.
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Workspace } from '../../../shared/types/workspace'
import { WorkspaceSurface } from '../../../src/components/Workspace/WorkspaceSurface'
import type { WorkbenchPanelItem } from '../../../src/components/Workbench/WorkbenchPanelMenu'
import { changeLanguage, i18n } from '../../../src/i18n'

vi.mock('../../../src/hooks/useGitBranch', () => ({ useGitBranch: () => ({ branch: 'main', detached: false, shortSha: null, error: null }) }))
vi.mock('../../../src/components/Grid/WorkspaceGrid', () => ({ WorkspaceGrid: () => <div data-testid="workspace-grid" /> }))
vi.mock('../../../src/components/Grid/WorkspaceSplitGrid', () => ({ WorkspaceSplitGrid: () => <div data-testid="workspace-grid" /> }))

const tc = (key: string): string => i18n.t(key, { ns: 'code' }) as string
function workspace(): Workspace {
  return { id: 'workspace-1', name: 'demo-repo', rootPath: '/repo', layout: '1x1', layoutPreset: 1, themeId: 'midnight', uiDensity: 'compact', defaultShellProfileId: 'builtin-claude', autoStart: false, isActive: true,
    editorVisible: false, editorExpanded: false, editorWidthPercent: 40, reviewPanelVisible: false, reviewPanelExpanded: false, reviewPanelWidthPercent: 36, githubPanelVisible: false, githubPanelExpanded: false,
    githubPanelWidthPercent: 40, githubActiveTab: 'status', backgroundPanelVisible: false, backgroundPanelExpanded: false, backgroundPanelWidthPercent: 28,
    panes: [{ id: 'pane-1', workspaceId: 'workspace-1', type: 'terminal', rowIndex: 0, columnIndex: 0, shellProfileId: 'builtin-claude', status: 'idle', agentProfileId: null, agentName: null, displayName: null, createdAt: null, modelOverride: null, rootPath: null }] } as unknown as Workspace
}
let changedCount: ReturnType<typeof vi.fn>
function mount(count: number): void {
  changedCount = vi.fn(async () => count)
  Object.defineProperty(window, 'oxe', { configurable: true, value: { ...(window as unknown as { oxe?: object }).oxe, git: { changedCount, getBranch: vi.fn(async () => ({ branch: 'main', detached: false, shortSha: null })) } } })
  const ws = workspace()
  const panels: WorkbenchPanelItem[] = [{ id: 'changes', active: false, onToggle: vi.fn() }, { id: 'browser', active: false, onToggle: vi.fn() }]
  render(<WorkspaceSurface workspace={ws} maximizedPaneId={null} onToggleMaximize={() => undefined} webPreviewVisible={false} integrationVisible={false} searchVisible={false}
    onCloseWebPreview={() => undefined} onCloseIntegration={() => undefined} onCloseSearch={() => undefined} onRunCommand={() => undefined} onUpdateEditorState={() => undefined}
    onUpdateReviewState={() => undefined} onUpdateGitHubState={() => undefined} onUpdateBackgroundState={() => undefined} onUpdateWorktreeState={() => undefined}
    onSelectWorkspace={() => undefined} workspaces={[ws]} activePaneId={null} panels={panels} />)
}
const changes = (): HTMLElement => screen.getByRole('button', { name: new RegExp(`^${tc('panels.changes')}|^Alterações`) })

afterEach(async () => { cleanup(); vi.restoreAllMocks(); await changeLanguage('en') })

describe('OXE-185 AG-04d the OxeCode Changes button counts the files (A40)', () => {
  it.each([[1, 'Changes, 1 file', '1'], [99, 'Changes, 99 files', '99'], [100, 'Changes, 100 files', '99+']])('with %s changed files the button is named "%s" and shows %s', async (count, name, shown) => {
    mount(count)
    await waitFor(() => expect(changes()).toHaveAccessibleName(name))
    expect(changes().textContent ?? '').toContain(shown)
    expect(changedCount).toHaveBeenCalledWith({ rootPath: '/repo' })
  })

  it('pt-BR names it "Alterações, N arquivos"', async () => {
    await changeLanguage('pt-BR')
    mount(3)
    await waitFor(() => expect(changes()).toHaveAccessibleName('Alterações, 3 arquivos'))
  })

  it('at 0 there is no badge and the plain name', async () => {
    mount(0)
    await waitFor(() => expect(changedCount).toHaveBeenCalled())
    await new Promise(resolve => setTimeout(resolve, 50))
    expect(changes()).toHaveAccessibleName(tc('panels.changes'))
    expect((changes().textContent ?? '').replace(tc('panels.changes'), '')).not.toMatch(/\d/)
  })
})
