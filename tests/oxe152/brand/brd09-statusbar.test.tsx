// Frozen acceptance test for 1.5.2 OxeCode/Shell F6 "marca" (OXE program oxespace-152-code, phase F6, Jira OXE-72, BRD-09).
// Written by the planner; the executor must not edit it. Source: the card OXE-72 spec-v1 (CA-4, CA-5, RT-1, RT-3),
// oxespace-152-brand/.brand-audit/BRD-lote-1.md (BRD-09) and M1-api-e-criterios.md, the user's rule "tudo tem que sair como
// foi projetado na interface" and the coordination's binding (the card's task adds the data-ui its measures read and turns
// ITS OWN measures to enforced, enforced.lock.json).
// Today (main 66e0080d5) OxeCode's status bar shows the branch, "No agents working" / "N agents working" and the version
// ("OXESpace 1.5.x"), not the workspace's name, and the usage of the active pane's agent only.
// Contract:
// - AppStatusBar's footer is [data-ui=status-bar] (24 px, --bar-sm, both densities) and keeps its accessible name
//   (code:workspace.status.bar) and the app-statusbar hook class.
// - It shows the workspace's name and the branch (useGitBranch; a branch only when known), and the usage of Claude and of
//   Codex, both, whatever agent the active pane runs: the same live usage service the context indicator reads
//   (agentCredits store, UsageStatus; RT-1).
// - A provider with no reading has no item at all: never "0%" nor "—" for it.
// - No "agents working" text (statusBar.agentsWorking, any count) and no version text (OXESpace <version>), with or without
//   appVersion.
// - src/design/targets/brd-09.json: BRD-09.statusbar.height (scene code-workspace, height, --bar-sm) enforced and locked.
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AppStatusBar } from '../../../src/components/Workspace/AppStatusBar'
import { useAgentCreditsStore } from '../../../src/store/agentCredits.store'
import { useAgentStore } from '../../../src/store/agent.store'
import { useActivityStore } from '../../../src/store/activity.store'
import { changeLanguage, i18n } from '../../../src/i18n'
import type { Workspace } from '../../../shared/types/workspace'

vi.mock('../../../src/hooks/useGitBranch', () => ({ useGitBranch: () => ({ branch: 'feat/pix-webhook', detached: false, shortSha: null, error: null }) }))

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
const STATUSBAR_MEASURES: readonly Pin[] = [{ id: 'BRD-09.statusbar.height', scene: 'code-workspace', prop: 'height', expect: { token: '--bar-sm' } }]

const WORKSPACE = { id: 'ws', name: 'demo-repo', rootPath: '/repo/demo-repo', panes: [{ id: 'pane-1', agentProfileId: 'codex-profile' }] } as unknown as Workspace
function reading(provider: 'claude' | 'codex', usedPct: number) {
  return { provider, available: true, installed: true, planLabel: null, windows: [{ kind: 'session', usedPct, resetsAtMs: null }], observedAtMs: Date.now(), stale: false }
}
function setUsage(byProvider: Record<string, unknown>): void {
  useAgentCreditsStore.setState({ byProvider, loading: {} } as never)
}
const bar = (): HTMLElement => screen.getByRole('contentinfo', { name: tc('workspace.status.bar') })

beforeEach(() => {
  Object.defineProperty(window, 'oxe', { configurable: true, value: { terminal: { stop: vi.fn(async () => undefined) } } })
  useAgentStore.setState({ allProfiles: [{ agentProfileId: 'codex-profile', provider: 'codex', name: 'Codex' }] } as never)
  useActivityStore.setState({ live: { code: { 'pane-1': 'working' }, thread: {} } } as never)
})
afterEach(async () => { cleanup(); vi.restoreAllMocks(); await changeLanguage('en') })

describe('OXE-72 BRD-09 status bar (A25)', () => {
  // OXE-423: status bar unifies all connected providers into one Usage control (one trigger opening UsagePopover)
  // instead of multiplying per-provider chips along the bar; Claude and Codex readings are both summarized there.
  it.each(['en', 'pt-BR'])('the status bar (%s) is [data-ui=status-bar] with the workspace, the branch, and unified Claude and Codex usage', async locale => {
    await changeLanguage(locale)
    setUsage({ claude: reading('claude', 42), codex: reading('codex', 17) })
    render(<AppStatusBar workspace={WORKSPACE} activePaneId="pane-1" appVersion="1.5.2" />)
    expect(bar()).toHaveAttribute('data-ui', 'status-bar')
    expect(bar()).toHaveTextContent('demo-repo')
    expect(bar()).toHaveTextContent('feat/pix-webhook')
    const usage = await within(bar()).findByTestId('usage-status')
    expect(within(bar()).getAllByTestId('usage-status')).toHaveLength(1)
    expect(usage).toHaveTextContent(new RegExp(`${tc('workspace.usage.label')}\\s+42%`))
    expect(usage).toHaveAccessibleName(/Codex 17%.*Claude 42%/)
  })

  it.each(['en', 'pt-BR'])('it says nothing about agents working (%s) and never shows the version', async locale => {
    await changeLanguage(locale)
    setUsage({})
    render(<AppStatusBar workspace={WORKSPACE} activePaneId="pane-1" appVersion="1.5.2" />)
    const text = bar().textContent ?? ''
    for (const count of [0, 1, 3]) expect(text).not.toContain(i18n.t('statusBar.agentsWorking', { count }) as string)
    expect(text).not.toMatch(/OXESpace/)
    expect(text).not.toContain('1.5.2')
  })

  it('a provider with no reading has no item: never 0% nor a dash', async () => {
    setUsage({ claude: reading('claude', 42) })
    render(<AppStatusBar workspace={WORKSPACE} activePaneId="pane-1" />)
    const usage = await within(bar()).findByTestId('usage-status')
    expect(usage).toHaveTextContent(/Usage\s+42%/)
    expect(usage).toHaveAccessibleName(/Claude 42%/)
    expect(usage.getAttribute('aria-label') ?? '').not.toMatch(/Codex/)
    const text = bar().textContent ?? ''
    expect(text).not.toMatch(/Codex/)
    expect(text).not.toMatch(/(^|\D)0%/)
    expect(text).not.toMatch(/[—–]/)
  })

  it('turns its own BRD-09 status bar measure to enforced', () => {
    expect(measureProblems('BRD-09', 'OXE-72', STATUSBAR_MEASURES)).toEqual([])
  })
})
