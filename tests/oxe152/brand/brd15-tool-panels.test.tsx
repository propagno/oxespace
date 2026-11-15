// Frozen acceptance test for 1.5.2 OxeCode/Shell F6 "marca" (OXE program oxespace-152-code, phase F6, Jira OXE-84, BRD-15).
// Written by the planner; the executor must not edit it. Source: the card OXE-84 spec-v1 (CA-1 to CA-3, RT-1; CA-4 empty
// states and CA-5 Browser at 960 px are left to the conformance scene and marca/fidelidade, asked of the brand),
// oxespace-152-brand/.brand-audit/BRD-lote-1.md (BRD-15) and M1-api-e-criterios.md (DockPanel); the coordination's binding
// (the card's task adds the data-ui its measures read and turns ITS OWN measures to enforced). It renders the real panels
// over the real preload (tests/acceptance/f4/crf4-8-preload.ts, read only) with a main that never answers, so every panel
// is caught loading.
// Today (main 66e0080d5) each of the nine panels draws its own <header class="workspace-editor-header"> (title span,
// expand and collapse tile buttons) and Changes waits behind a centred "Loading changes…".
// Contract:
// - The nine OxeCode panels (panelCatalog CODE_BAR_PANELS + CODE_MENU_PANELS: changes, browser, git, files, search,
//   worktrees, httpCalls, android, containers; their Workspace*Panel wrappers) are each one src/ui DockPanel:
//   [data-ui=dock-panel], role region named with the panel's title (code:panels.<id>), the title an <h2> in its header
//   (36, 40 comfortable, --bar-lg; 13/600, measured on CI), the close control (code:workspace.panel.collapse) the header's
//   last control, after the actions. No workspace-editor-header left in them. The data-testid of each wrapper stays.
// - A panel on its way shows the src/ui Skeleton ([data-skeleton]), never the centred "Loading changes…"
//   (code:changes.loading) nor any LoadingState line, in Changes at least.
// - The Changes count (coordination 15/11, as in OXE-169): "Changes, N files" / "Alterações, N arquivos" through the plural
//   pair panels.changesCount_one/_other (pt-BR also _many), in code.json or thread.json (whichever OxeChat F4's T13 used:
//   one pair, never two), hidden at 0, "99+" above 99. Where OxeCode reads N (the Changes panel's file list) and which
//   control carries it (the Changes toggle or the DockPanel count) is asked of the brand: only the pair is frozen here.
// - src/design/targets/brd-15.json (new, card OXE-84): the measures below, enforced and locked, scene code-workspace (the
//   scene opens Changes and Browser).
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { act, cleanup, render, within } from '@testing-library/react'
import type { ReactElement } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { changeLanguage, i18n } from '../../../src/i18n'
import { useWorkspaceStore } from '../../../src/store/workspace.store'
import type { Workspace } from '../../../shared/types/workspace'
import { preloadOxe } from '../../acceptance/f4/crf4-8-preload'
import { WorkspaceReviewPanel } from '../../../src/components/Workspace/WorkspaceReviewPanel'
import { WorkspaceWebPreviewPanel } from '../../../src/components/Workspace/WorkspaceWebPreviewPanel'
import { WorkspaceGitHubPanel } from '../../../src/components/Workspace/WorkspaceGitHubPanel'
import { WorkspaceEditorPanel } from '../../../src/components/Workspace/WorkspaceEditorPanel'
import { WorkspaceSearchPanel } from '../../../src/components/Workspace/WorkspaceSearchPanel'
import { WorkspaceWorktreePanel } from '../../../src/components/Workspace/WorkspaceWorktreePanel'
import { WorkspaceHttpCallsPanel } from '../../../src/components/Workspace/WorkspaceHttpCallsPanel'
import { WorkspaceAndroidPanel } from '../../../src/components/Workspace/WorkspaceAndroidPanel'
import { WorkspaceContainersPanel } from '../../../src/components/Workspace/WorkspaceContainersPanel'

// Some panel modules read matchMedia when they load (the editor); jsdom has none.
vi.hoisted(() => {
  if (typeof window !== 'undefined' && !window.matchMedia) {
    Object.defineProperty(window, 'matchMedia', { configurable: true, value: (query: string) => ({ matches: false, media: query, onchange: null, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent: () => false }) })
  }
  if (typeof window !== 'undefined' && !('ResizeObserver' in window)) Object.assign(window, { ResizeObserver: class { observe(): void {} unobserve(): void {} disconnect(): void {} } })
})
vi.mock('../../../src/hooks/useGitBranch', () => ({ useGitBranch: () => ({ branch: 'main', detached: false, shortSha: null, error: null }) }))

const ROOT = process.cwd()
const tc = (key: string): string => i18n.t(key, { ns: 'code' }) as string

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
const PANEL_MEASURES: readonly Pin[] = [
  { id: 'BRD-15.panel-header.height', scene: 'code-workspace', prop: 'height', expect: { token: '--bar-lg' } },
  { id: 'BRD-15.panel-title.font-size', scene: 'code-workspace', prop: 'font-size', expect: { token: '--text-sm' } },
  { id: 'BRD-15.panel-title.font-weight', scene: 'code-workspace', prop: 'font-weight', expect: { token: '--weight-semibold' } }
]

const workspace = { id: 'ws-1', name: 'demo', rootPath: '/repo', defaultShellProfileId: null, panes: [], githubActiveTab: 'status' } as unknown as Workspace
const scope = { rootPath: '/repo', label: 'demo', kind: 'workspace' } as never
const common = { isExpanded: false, onCollapse: () => undefined, onToggleExpanded: () => undefined }
const PANELS: Array<[string, () => ReactElement]> = [
  ['changes', () => <WorkspaceReviewPanel workspace={workspace} scope={scope} {...common} />],
  ['browser', () => <WorkspaceWebPreviewPanel workspace={workspace} onRunCommand={() => undefined} {...common} />],
  ['git', () => <WorkspaceGitHubPanel workspace={workspace} scope={scope} activeTab={'status' as never} onTabChange={() => undefined} {...common} />],
  ['files', () => <WorkspaceEditorPanel workspace={workspace} scope={scope} {...common} />],
  ['search', () => <WorkspaceSearchPanel workspace={workspace} {...common} />],
  ['worktrees', () => <WorkspaceWorktreePanel workspace={workspace} activePaneId={null} {...common} />],
  ['httpCalls', () => <WorkspaceHttpCallsPanel workspace={workspace} {...common} />],
  ['android', () => <WorkspaceAndroidPanel {...common} />],
  ['containers', () => <WorkspaceContainersPanel {...common} />]
]
async function mount(make: () => ReactElement): Promise<HTMLElement> {
  // A main that never answers: every read stays pending, so the panel is caught loading.
  preloadOxe(new Proxy({}, { get: () => () => new Promise(() => undefined) }) as never)
  useWorkspaceStore.setState({ workspaces: [workspace], shellProfiles: [] } as never)
  const view = render(make())
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 450)) })
  return view.container
}

beforeEach(async () => { await changeLanguage('en') })
afterEach(() => { cleanup(); vi.restoreAllMocks() })

describe('OXE-84 BRD-15 the nine panels on one mould (A31)', () => {
  it.each(PANELS)('%s is a DockPanel: a region named by its h2 title, close last', async (id, make) => {
    const container = await mount(make)
    const panels = container.querySelectorAll<HTMLElement>('[data-ui="dock-panel"]')
    expect(panels, `${id}: one dock-panel`).toHaveLength(1)
    const panel = panels[0]
    const title = tc(`panels.${id}`)
    expect(panel).toHaveAttribute('aria-label', title)
    expect(within(container).getAllByRole('region', { name: title })).toContain(panel)
    const header = panel.querySelector('header')
    expect(header?.querySelector('h2')?.textContent?.trim(), `${id}: the h2 is the title`).toBe(title)
    const controls = [...(header?.querySelectorAll<HTMLElement>('button, [role="button"]') ?? [])]
    expect(controls.at(-1)?.getAttribute('aria-label'), `${id}: close is last`).toBe(tc('workspace.panel.collapse'))
    expect(container.querySelectorAll('.workspace-editor-header'), `${id}: no hand-made header`).toHaveLength(0)
  }, 30_000)

  it('Changes on its way shows the skeleton, never the centred "Loading changes…"', async () => {
    const container = await mount(PANELS[0][1])
    expect(container.textContent ?? '').not.toContain(tc('changes.loading'))
    expect(container.textContent ?? '').not.toContain(i18n.t('ui.loadingEllipsis') as string)
    expect(container.querySelectorAll('[data-skeleton]').length, 'a skeleton').toBeGreaterThan(0)
  }, 30_000)

  it('the Changes count is the plural pair panels.changesCount, as in OXE-169', () => {
    const flat = (value: unknown, prefix = ''): Record<string, string> => Object.assign({}, ...Object.entries(value as Record<string, unknown>).map(([name, item]) =>
      typeof item === 'string' ? { [prefix + name]: item } : flat(item, `${prefix}${name}.`)))
    const pair = (locale: string): Record<string, string | undefined> => {
      const found = ['code', 'thread'].map(ns => flat(JSON.parse(readFileSync(join(ROOT, `shared/locales/${locale}/${ns}.json`), 'utf8')))).filter(keys => 'panels.changesCount_one' in keys)
      expect(found.length, `${locale}: one pair, in one catalog`).toBe(1)
      return { one: found[0]['panels.changesCount_one'], other: found[0]['panels.changesCount_other'], many: found[0]['panels.changesCount_many'] }
    }
    expect(pair('en')).toMatchObject({ one: 'Changes, {{count}} file', other: 'Changes, {{count}} files' })
    expect(pair('pt-BR')).toEqual({ one: 'Alterações, {{count}} arquivo', other: 'Alterações, {{count}} arquivos', many: 'Alterações, {{count}} arquivos' })
  })

  it('turns its own BRD-15 measures to enforced', () => {
    expect(measureProblems('BRD-15', 'OXE-84', PANEL_MEASURES)).toEqual([])
  })
})
