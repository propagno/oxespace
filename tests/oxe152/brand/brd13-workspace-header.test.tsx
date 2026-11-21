// Frozen acceptance test for 1.5.2 OxeCode/Shell F6 "marca" (OXE program oxespace-152-code, phase F6, Jira OXE-79, BRD-13).
// Written by the planner; the executor must not edit it. Source: the card OXE-79 spec-v1 (CA-1 to CA-3, RT-1 to RT-3),
// oxespace-152-brand/.brand-audit/BRD-lote-1.md (BRD-13) and M1-api-e-criterios.md; the coordination's binding (the card's
// task adds the data-ui its measures read and turns ITS OWN measures to enforced). Runs after OxeCode F5 (T24/T25 own
// WorkspaceSurface.tsx and the workspace bar's buttons); it builds on F5's version.
// Today (main 66e0080d5) the workspace bar shows the workspace chip and "N panes"/"N painéis", no branch, and the panel
// buttons are raw <button>s with a visible label.
// Contract:
// - The workspace's header (the <header> named code:workspace.topbar.label) is [data-ui=workspace-header]. Its title is the
//   workspace itself: a status dot, the workspace's name and the branch, the branch on [data-ui=workspace-branch] in the
//   mono face (--font-mono, measured on CI) with the text useGitBranch reports. No "OxeCode ·" and no pane count
//   (code:workspace.status.panes) anywhere in the header.
// - A branch that is not known (useGitBranch gives no branch nor shortSha) is not shown: no [data-ui=workspace-branch],
//   never "Branch unavailable" (code:pane.branchUnavailable or any such text).
// - The panel group is [data-ui=panel-group] inside the header: every control in it is a <button> with an accessible name
//   and a title (the tooltip), square at --control-md (28, 32 comfortable, measured on CI), no visible text label; the
//   toggle of an open panel is aria-pressed="true", a closed one "false". No change indicator in the title (RT-1).
// - src/design/targets/brd-13.json (new, card OXE-79): the measures below, enforced and locked, scene code-workspace.
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Workspace } from '../../../shared/types/workspace'
import { WorkspaceSurface } from '../../../src/components/Workspace/WorkspaceSurface'
import type { WorkbenchPanelItem } from '../../../src/components/Workbench/WorkbenchPanelMenu'
import { changeLanguage, i18n } from '../../../src/i18n'
import { useUIStore } from '../../../src/store/ui.store'

const mocks = vi.hoisted(() => ({ branch: 'feat/pix-webhook' as string | null }))
vi.mock('../../../src/hooks/useGitBranch', () => ({ useGitBranch: () => ({ branch: mocks.branch, detached: false, shortSha: null, error: mocks.branch ? null : 'unavailable' }) }))
vi.mock('../../../src/components/Grid/WorkspaceGrid', () => ({ WorkspaceGrid: () => <div data-testid="workspace-grid" /> }))
vi.mock('../../../src/components/Grid/WorkspaceSplitGrid', () => ({ WorkspaceSplitGrid: () => <div data-testid="workspace-grid" /> }))

const ROOT = process.cwd()
const tc = (key: string, options: Record<string, unknown> = {}): string => i18n.t(key, { ns: 'code', ...options }) as string

type Pin = { id: string; scene: string; prop: string; expect: Record<string, unknown> }
/** What is wrong with the card's own measures in src/design/targets (empty when they are delivered and enforced). */
function measureProblems(brd: string, card: string, pins: readonly Pin[]): string[] {
  const dir = join(ROOT, 'src/design/targets')
  const file = join(dir, `${brd.toLowerCase()}.json`)
  if (!existsSync(file)) return [`src/design/targets/${brd.toLowerCase()}.json does not exist`]
  const doc = JSON.parse(readFileSync(file, 'utf8')) as { brd: string; card: string | null; platform: string; measures: Array<Record<string, unknown>> }
  const lock = (JSON.parse(readFileSync(join(dir, 'enforced.lock.json'), 'utf8')) as { enforced: string[] }).enforced
  // SOURCE-TEXT check (marked): the conformance spec must measure the scene, or an enforced measure is never checked.
  const spec = readFileSync(join(ROOT, 'e2e/brand/brand-conformance.spec.ts'), 'utf8')
  const problems = [...(doc.brd === brd ? [] : [`brd is ${doc.brd}`]), ...(doc.card === card ? [] : [`card is ${doc.card}`]), ...(doc.platform === 'desktop' ? [] : ['platform is not desktop'])]
  for (const pin of pins) {
    const measure = doc.measures.find(item => item.id === pin.id)
    if (!measure) { problems.push(`${pin.id} is missing`); continue }
    if (measure.state !== 'enforced') problems.push(`${pin.id} is ${String(measure.state)}`)
    if (!lock.includes(pin.id)) problems.push(`${pin.id} is not in enforced.lock.json`)
    if (measure.scene !== pin.scene) problems.push(`${pin.id} scene ${String(measure.scene)}`)
    if (measure.prop !== pin.prop) problems.push(`${pin.id} prop ${String(measure.prop)}`)
    if (JSON.stringify(measure.expect) !== JSON.stringify(pin.expect)) problems.push(`${pin.id} expect ${JSON.stringify(measure.expect)}`)
    if (JSON.stringify([...(measure.densities as string[] ?? [])].sort()) !== '["comfortable","compact"]') problems.push(`${pin.id} densities`)
    if (JSON.stringify([...(measure.themes as string[] ?? [])].sort()) !== '["dark","light"]') problems.push(`${pin.id} themes`)
    if (!new RegExp(`measureScene\\(page, '${pin.scene}'`).test(spec)) problems.push(`${pin.id}: the conformance spec does not measure scene ${pin.scene}`)
  }
  return problems
}
const HEADER_MEASURES: readonly Pin[] = [
  // liberação de teste congelado: coordenação 16/11, BRD-13.branch.font-family fica pending até uma cena de conformidade ter um branch git (OXE-286); as demais medidas e asserções não mudam (OXE-79)
  { id: 'BRD-13.panel-button.height', scene: 'code-workspace', prop: 'height', expect: { token: '--control-md' } },
  { id: 'BRD-13.panel-button.width', scene: 'code-workspace', prop: 'width', expect: { token: '--control-md' } }
]

function workspace(): Workspace {
  return { id: 'workspace-1', name: 'demo-repo', rootPath: 'C:/repo/demo-repo', layout: '1x1', layoutPreset: 1, themeId: 'midnight', uiDensity: 'compact', defaultShellProfileId: 'builtin-claude', autoStart: false, isActive: true,
    editorVisible: false, editorExpanded: false, editorWidthPercent: 40, reviewPanelVisible: false, reviewPanelExpanded: false, reviewPanelWidthPercent: 36, githubPanelVisible: false, githubPanelExpanded: false,
    githubPanelWidthPercent: 40, githubActiveTab: 'status', backgroundPanelVisible: false, backgroundPanelExpanded: false, backgroundPanelWidthPercent: 28,
    panes: ['pane-1', 'pane-2', 'pane-3', 'pane-4'].map((id, index) => ({ id, workspaceId: 'workspace-1', type: 'terminal', rowIndex: Math.floor(index / 2), columnIndex: index % 2, shellProfileId: 'builtin-claude', status: 'idle',
      agentProfileId: null, agentName: null, displayName: null, createdAt: null, modelOverride: null, rootPath: null })) } as unknown as Workspace
}
function renderSurface(): void {
  const ws = workspace()
  const panels: WorkbenchPanelItem[] = [{ id: 'changes', active: true, onToggle: vi.fn() }, { id: 'browser', active: false, onToggle: vi.fn() }]
  render(<WorkspaceSurface workspace={ws} maximizedPaneId={null} onToggleMaximize={() => undefined} webPreviewVisible={false} integrationVisible={false} searchVisible={false}
    onCloseWebPreview={() => undefined} onCloseIntegration={() => undefined} onCloseSearch={() => undefined} onRunCommand={() => undefined} onUpdateEditorState={() => undefined}
    onUpdateReviewState={() => undefined} onUpdateGitHubState={() => undefined} onUpdateBackgroundState={() => undefined} onUpdateWorktreeState={() => undefined}
    onSelectWorkspace={() => undefined} workspaces={[ws]} activePaneId={null} panels={panels} />)
}
const header = (): HTMLElement => {
  const found = document.querySelectorAll<HTMLElement>('[data-ui="workspace-header"]')
  expect(found, 'one workspace-header').toHaveLength(1)
  return found[0]
}

afterEach(async () => {
  cleanup()
  vi.restoreAllMocks()
  mocks.branch = 'feat/pix-webhook'
  useUIStore.setState({ isSidebarCollapsed: false, collapsedSidebars: { ...useUIStore.getState().collapsedSidebars, code: false } })
  await changeLanguage('en')
})

describe('OXE-79 BRD-13 the OxeCode workspace header (A29)', () => {
  it.each(['en', 'pt-BR'])('the title (%s) is the workspace: dot, name and the branch in mono; no "OxeCode ·" nor pane count', async locale => {
    await changeLanguage(locale)
    // liberação de teste congelado: coordenação 20/11 (OXE-279 / POLISH-09 #2(b)), 'demo-repo' no workspace-header é verificado com a lateral recolhida (isSidebarCollapsed: true); nenhuma outra asserção do BRD-13 muda
    useUIStore.setState({ isSidebarCollapsed: true, collapsedSidebars: { ...useUIStore.getState().collapsedSidebars, code: true } })
    renderSurface()
    expect(header()).toHaveAccessibleName(tc('workspace.topbar.label'))
    expect(header()).toHaveTextContent('demo-repo')
    const branch = header().querySelectorAll('[data-ui="workspace-branch"]')
    expect(branch).toHaveLength(1)
    expect((branch[0].textContent ?? '').trim()).toBe('feat/pix-webhook')
    const text = header().textContent ?? ''
    expect(text).not.toMatch(/OxeCode\s*·/)
    expect(text).not.toContain(tc('workspace.status.panes', { count: 4 }))
  })

  it('an unknown branch is not shown', () => {
    mocks.branch = null
    renderSurface()
    expect(header().querySelectorAll('[data-ui="workspace-branch"]')).toHaveLength(0)
    expect(header().textContent ?? '').not.toMatch(/branch unavailable|ramo indispon/i)
  })

  it('the panel group: icon buttons with a name and a tooltip, the open panel pressed', () => {
    renderSurface()
    const groups = header().querySelectorAll<HTMLElement>('[data-ui="panel-group"]')
    expect(groups, 'one panel-group in the header').toHaveLength(1)
    const buttons = [...groups[0].querySelectorAll<HTMLButtonElement>('button')]
    expect(buttons.length).toBeGreaterThanOrEqual(2)
    for (const button of buttons) {
      const name = button.getAttribute('aria-label') ?? ''
      expect(name, 'every panel button has a name').not.toBe('')
      expect(button.getAttribute('title') ?? '', `${name} has a tooltip`).not.toBe('')
      const visible = [...button.childNodes].map(node => node.nodeType === Node.TEXT_NODE ? node.textContent : (node as Element).matches?.('svg, [aria-hidden="true"], .sr-only') ? '' : node.textContent).join('').trim()
      expect(visible, `${name} shows an icon, not a text label`).toBe('')
    }
    const changes = screen.getByRole('button', { name: tc('panels.changes') })
    const browser = screen.getByRole('button', { name: tc('panels.browser') })
    expect(groups[0].contains(changes) && groups[0].contains(browser)).toBe(true)
    expect([changes.getAttribute('aria-pressed'), browser.getAttribute('aria-pressed')]).toEqual(['true', 'false'])
  })

  it('turns its own BRD-13 measures to enforced', () => {
    expect(measureProblems('BRD-13', 'OXE-79', HEADER_MEASURES)).toEqual([])
  })
})
