// Frozen acceptance test for 1.5.2 OxeCode/Shell F6 "marca" (OXE program oxespace-152-code, phase F6, Jira OXE-82, BRD-14).
// Written by the planner; the executor must not edit it. Source: the card OXE-82 spec-v1 (CA-1, CA-2, CA-3, CA-5, CA-6;
// CA-4, the running time, waits for its source: asked of the brand), oxespace-152-brand/.brand-audit/BRD-lote-1.md (BRD-14)
// and M1-api-e-criterios.md (PaneHeader); the coordination's binding (the card's task adds the data-ui its measures read and
// turns ITS OWN measures to enforced). It renders the real PaneContainer over the real preload
// (tests/acceptance/f4/crf4-8-preload.ts, read only), as tests/oxe152/code/a2-pane-header-context-menu.test.tsx does.
// Today (main 66e0080d5) the pane header is a 36 px <header class="pane-header"> of its own that says "Branch unavailable"
// when the branch is not known, and every running shell pane has the command-line footer (.terminal-cmd-input).
// Contract:
// - The pane's header is the src/ui PaneHeader, [data-ui=pane-header] (32, 36 comfortable, --bar-md; title 12/600,
//   measured on CI), and keeps the pane-header class (a2's frozen test and e2e read it). The pane's actions (the ⋯ "More
//   pane actions" button among them) sit in it, hidden until hover or focus by the primitive (CA-3, fidelity on CI).
// - The focused pane's header is the primitive with `focused` (the accent tint and border are the primitive's, both themes):
//   with the pane active in the terminal store, [data-ui=pane-header] carries data-focused="true"; another pane's does not.
// - The branch chip shows only when the pane's branch or worktree differs from the workspace's (coordination 15/11): the
//   workspace's branch is useGitBranch on the workspace root ("main" here), the pane's what main reports for it
//   (terminal.branch). Unknown: nothing, never "Branch unavailable" (code:paneMenu.noBranch); the same as the workspace's:
//   no chip ([data-testid=pane-branch-badge] gone, the name not in the header); different: the chip with the pane's branch.
// - A shell pane has no command-line footer: no .terminal-cmd-input, running or not; Ctrl+/ (terminal.slash) is the way in.
// - src/design/targets/brd-14.json (new, card OXE-82): the measures below, enforced and locked, scene code-workspace.
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { changeLanguage, i18n } from '../../../src/i18n'
import { useTerminalStore } from '../../../src/store/terminal.store'
import { useWorkspaceStore } from '../../../src/store/workspace.store'
import { useUIStore } from '../../../src/store/ui.store'
import type { Workspace, WorkspacePane } from '../../../shared/types/workspace'
import { preloadOxe } from '../../acceptance/f4/crf4-8-preload'

const mocks = vi.hoisted(() => ({ branch: 'feat/pix-webhook' as string | null }))
// The workspace's branch (and any folder's read through useGitBranch) is main; the pane's own comes from terminal.branch.
vi.mock('../../../src/hooks/useGitBranch', () => ({ useGitBranch: () => ({ branch: 'main', detached: false, shortSha: null, error: null }) }))
vi.mock('../../../src/components/Terminal/TerminalView', () => ({ TerminalView: () => <div data-testid="xterm-stub" /> }))

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
const PANE_MEASURES: readonly Pin[] = [
  { id: 'BRD-14.pane-header.height', scene: 'code-workspace', prop: 'height', expect: { token: '--bar-md' } },
  { id: 'BRD-14.pane-title.font-size', scene: 'code-workspace', prop: 'font-size', expect: { token: '--text-xs' } },
  { id: 'BRD-14.pane-title.font-weight', scene: 'code-workspace', prop: 'font-weight', expect: { token: '--weight-semibold' } }
]

const pane = (id: string) => ({ id, workspaceId: 'ws-1', type: 'terminal', rowIndex: 0, columnIndex: 0, status: 'running', agentProfileId: null, agentName: null, displayName: null, shellProfileId: null, rootPath: null, createdAt: null }) as unknown as WorkspacePane
const PANES = [pane('p1'), pane('p2')]
const workspace = { id: 'ws-1', name: 'demo', rootPath: '/repo', defaultShellProfileId: null, panes: PANES } as unknown as Workspace

async function mount(id = 'p1') {
  preloadOxe({ 'terminal.branch': () => ({ branch: mocks.branch, startedOn: mocks.branch, switched: false }) })
  useWorkspaceStore.setState({ workspaces: [workspace], shellProfiles: [] } as never)
  const { PaneContainer } = await import('../../../src/components/Grid/PaneContainer')
  const view = render(<PaneContainer pane={PANES.find(item => item.id === id)!} workspace={workspace} agentProfile={null} autoStart={false} isMaximized={false} onToggleMaximize={() => undefined} />)
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 50)) })
  return view.container
}
const headerOf = (container: HTMLElement): HTMLElement => {
  const found = container.querySelectorAll<HTMLElement>('[data-ui="pane-header"]')
  expect(found, 'one pane-header').toHaveLength(1)
  return found[0]
}

beforeEach(async () => {
  await changeLanguage('en')
  useTerminalStore.setState({ panes: { p1: { status: 'running', error: null }, p2: { status: 'running', error: null } }, activePaneId: null } as never)
  useUIStore.setState({ activePaneId: null } as never)
})
afterEach(() => { cleanup(); vi.restoreAllMocks(); mocks.branch = 'feat/pix-webhook' })

describe('OXE-82 BRD-14 the terminal pane (A30)', () => {
  it('the header is the PaneHeader primitive, keeps the pane-header hook and holds the pane actions', async () => {
    const container = await mount()
    const header = headerOf(container)
    expect(header).toHaveClass('pane-header')
    expect(header.contains(screen.getByRole('button', { name: 'More pane actions' }))).toBe(true)
  }, 30_000)

  it('the focused pane header carries focused; another pane does not', async () => {
    useTerminalStore.setState({ activePaneId: 'p1' } as never)
    useUIStore.setState({ activePaneId: 'p1' } as never)
    const focused = headerOf(await mount('p1'))
    await waitFor(() => expect(focused).toHaveAttribute('data-focused', 'true'))
    cleanup()
    const other = headerOf(await mount('p2'))
    expect(other.getAttribute('data-focused')).not.toBe('true')
  }, 30_000)

  it.each(['en', 'pt-BR'])('an unknown branch is not shown (%s); a known one is', async locale => {
    await changeLanguage(locale)
    mocks.branch = null
    const unknown = await mount()
    expect(headerOf(unknown).textContent ?? '').not.toContain(tc('paneMenu.noBranch'))
    expect(unknown.textContent ?? '').not.toMatch(/branch unavailable|branch indispon|ramo indispon/i)
    cleanup()
    mocks.branch = 'feat/pix-webhook'
    const known = await mount()
    expect(headerOf(known)).toHaveTextContent('feat/pix-webhook')
  }, 30_000)

  it('the branch chip shows only when the pane is on another branch than the workspace', async () => {
    mocks.branch = 'main'
    const same = await mount()
    expect(same.querySelectorAll('[data-testid="pane-branch-badge"]'), 'no chip on the branch of the workspace').toHaveLength(0)
    expect(headerOf(same).textContent ?? '').not.toMatch(/(^|\W)main(\W|$)/)
    cleanup()
    mocks.branch = 'feat/pix-webhook'
    const other = await mount()
    expect(headerOf(other)).toHaveTextContent('feat/pix-webhook')
  }, 30_000)

  it('a running shell pane has no command-line footer', async () => {
    const { TerminalPane } = await import('../../../src/components/Panes/TerminalPane')
    preloadOxe({})
    useWorkspaceStore.setState({ workspaces: [workspace], shellProfiles: [] } as never)
    const { container } = render(<TerminalPane pane={PANES[0]} workspaceId="ws-1" workspaceRootPath="/repo" autoStart={false} />)
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 50)) })
    expect(container.querySelectorAll('.terminal-cmd-input, input[aria-label="' + tc('terminalPane.commandPlaceholder') + '"]')).toHaveLength(0)
  }, 30_000)

  it('turns its own BRD-14 measures to enforced', () => {
    expect(measureProblems('BRD-14', 'OXE-82', PANE_MEASURES)).toEqual([])
  })
})
