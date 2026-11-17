// Frozen acceptance test for 1.5.2 OxeCode/Shell F6 "marca" (OXE program oxespace-152-code, phase F6, Jira OXE-85, BRD-16).
// Written by the planner; the executor must not edit it. Source: the card OXE-85 spec-v1 (CA-1 to CA-4, CA-6, RT-1; CA-5,
// where each removed action lands, is the executor's list in the PR and the brand's check), the approved interface
// artifact JpDiD9nKrPrMXdcnkED4US (principle "Menus curtos e ordenados"), oxespace-152-brand/.brand-audit/BRD-lote-1.md
// (BRD-16) and M1-api-e-criterios.md; the coordination's binding (the card's task adds the data-ui its measures read and
// turns ITS OWN measures to enforced). Runs after OxeCode F5 (T23 owns PaneSessionRow.tsx); it builds on F5's version.
// It renders the real PaneContainer and PaneSessionRow over the real preload (tests/acceptance/f4/crf4-8-preload.ts).
// Today (main 66e0080d5) the terminal's ⋯ menu has 9 items in one run, "Clear terminal" disabled in view; the sidebar
// row's menu is a hand-made role=menu of raw buttons with Close among the rest.
// Contract, for both menus (the terminal's ⋯ "More pane actions" menu, [data-testid=pane-actions-menu], and the sidebar
// terminal row's context menu, role=menu):
// - At most 8 items (menuitem, menuitemcheckbox, menuitemradio; a submenu trigger counts 1), in groups split by
//   role=separator.
// - Nothing unavailable in view: no item disabled or aria-disabled (hide it instead).
// - The destructive items (a name starting Close/Fechar, Kill/Encerrar, Delete/Excluir, Remove/Remover) sit alone in the
//   last group: after the last separator, with nothing else there, and none before it.
// - No "More"/"Mais" submenu; a submenu exists only as a named natural group ("Abrir em ▸" with the editors).
// - Every item is the src/ui Menu's own item (no raw <button role=menuitem> styled by hand), height --row-1 (28, 32
//   comfortable, measured on CI as BRD-16.menu-item.height in scene code-menu, the terminal's ⋯ menu opened in OxeCode).
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { changeLanguage, i18n } from '../../../src/i18n'
import { useTerminalStore } from '../../../src/store/terminal.store'
import { useWorkspaceStore } from '../../../src/store/workspace.store'
import type { Workspace, WorkspacePane } from '../../../shared/types/workspace'
import { preloadOxe } from '../../acceptance/f4/crf4-8-preload'

vi.mock('../../../src/hooks/useGitBranch', () => ({ useGitBranch: () => ({ branch: 'main', detached: false, shortSha: null, error: null }) }))
vi.mock('../../../src/components/Panes/PaneContent', () => ({ PaneContent: () => null }))

const ROOT = process.cwd()

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
const MENU_MEASURES: readonly Pin[] = [{ id: 'BRD-16.menu-item.height', scene: 'code-menu', prop: 'height', expect: { token: '--row-1' } }]

const pane = { id: 'p1', workspaceId: 'ws-1', type: 'terminal', rowIndex: 0, columnIndex: 0, status: 'running', agentProfileId: null, agentName: null, displayName: null, shellProfileId: null, rootPath: null, createdAt: null } as unknown as WorkspacePane
const workspace = { id: 'ws-1', name: 'demo', rootPath: '/repo', defaultShellProfileId: null, panes: [pane] } as unknown as Workspace
const ITEM_ROLES = /^(menuitem|menuitemcheckbox|menuitemradio)$/
const nameOf = (el: Element): string => (el.getAttribute('aria-label') ?? el.textContent ?? '').replace(/\s+/g, ' ').trim()
const DESTRUCTIVE = /^(close|fechar|kill|encerrar|delete|excluir|remove|remover)\b/i

/** The menu's own items (not a submenu's), in order, with the separators between them. */
function layout(menu: HTMLElement): Array<{ kind: 'item' | 'separator'; el: HTMLElement }> {
  const own = [...menu.querySelectorAll<HTMLElement>('[role]')].filter(el => el.closest('[role="menu"]') === menu)
  return own.flatMap(el => ITEM_ROLES.test(el.getAttribute('role') ?? '') ? [{ kind: 'item' as const, el }] : el.getAttribute('role') === 'separator' ? [{ kind: 'separator' as const, el }] : [])
}
function problems(menu: HTMLElement): string[] {
  const rows = layout(menu)
  const items = rows.filter(row => row.kind === 'item').map(row => row.el)
  const out: string[] = []
  if (items.length > 8) out.push(`${items.length} items: ${items.map(nameOf).join(' | ')}`)
  for (const item of items) if (item.getAttribute('aria-disabled') === 'true' || (item as HTMLButtonElement).disabled) out.push(`disabled in view: ${nameOf(item)}`)
  for (const item of items) if (item.getAttribute('aria-haspopup') && /^(more|mais)\b/i.test(nameOf(item))) out.push(`a "More" submenu: ${nameOf(item)}`)
  const lastSeparator = rows.map(row => row.kind).lastIndexOf('separator')
  const destructive = items.filter(item => DESTRUCTIVE.test(nameOf(item)))
  if (destructive.length) {
    const lastGroup = rows.slice(lastSeparator + 1).filter(row => row.kind === 'item').map(row => row.el)
    if (lastSeparator < 0) out.push('the destructive items are not in a group of their own')
    for (const item of lastGroup) if (!DESTRUCTIVE.test(nameOf(item))) out.push(`not destructive in the last group: ${nameOf(item)}`)
    for (const item of destructive) if (!lastGroup.includes(item)) out.push(`destructive outside the last group: ${nameOf(item)}`)
  }
  return out
}

async function preload(): Promise<void> {
  preloadOxe({ 'terminal.branch': () => ({ branch: 'main', startedOn: 'main', switched: false }) })
  useTerminalStore.setState({ panes: { p1: { status: 'running', error: null } }, activePaneId: null } as never)
  useWorkspaceStore.setState({ workspaces: [workspace], shellProfiles: [] } as never)
}
async function paneMenu(): Promise<HTMLElement> {
  await preload()
  const { PaneContainer } = await import('../../../src/components/Grid/PaneContainer')
  render(<PaneContainer pane={pane} workspace={workspace} agentProfile={null} autoStart={false} isMaximized={false} onToggleMaximize={() => undefined} />)
  await userEvent.click(screen.getByRole('button', { name: i18n.t('paneMenu.more', { ns: 'code', defaultValue: 'More pane actions' }) as string }))
  const menu = await screen.findByTestId('pane-actions-menu')
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 300)) })
  return menu
}
async function rowMenu(): Promise<HTMLElement> {
  await preload()
  const { PaneSessionRow } = await import('../../../src/components/Sidebar/PaneSessionRow')
  const { container } = render(<PaneSessionRow pane={pane} paneIndex={0} workspace={workspace} isActive={false} agentProfiles={[]} onClick={() => undefined} onActivatePane={() => undefined} />)
  const row = container.querySelector<HTMLElement>('[data-ui="sidebar-row"]') ?? container.firstElementChild as HTMLElement
  await act(async () => { fireEvent.contextMenu(row, { clientX: 40, clientY: 40 }) })
  const menu = await screen.findByRole('menu')
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 100)) })
  return menu
}

beforeEach(async () => { await changeLanguage('en') })
afterEach(() => { cleanup(); vi.restoreAllMocks() })

describe('OXE-85 BRD-16 short, ordered menus (A32)', () => {
  it.each(['en', 'pt-BR'])('the terminal menu (%s): at most 8, nothing disabled, destructive last and alone, no "More"', async locale => {
    await changeLanguage(locale)
    expect(problems(await paneMenu())).toEqual([])
  }, 30_000)

  it.each(['en', 'pt-BR'])('the sidebar row menu (%s): at most 8, nothing disabled, destructive last and alone, no "More"', async locale => {
    await changeLanguage(locale)
    const menu = await rowMenu()
    expect(problems(menu)).toEqual([])
    expect(layout(menu).some(row => row.kind === 'separator'), 'the row menu is grouped').toBe(true)
    expect(layout(menu).filter(row => row.kind === 'item').every(row => row.el.tagName !== 'BUTTON' || row.el.getAttribute('data-ui') !== null), 'items are the src/ui Menu\'s, not raw buttons').toBe(true)
  }, 30_000)

  it('turns its own BRD-16 measure to enforced', () => {
    expect(measureProblems('BRD-16', 'OXE-85', MENU_MEASURES)).toEqual([])
  })
})
