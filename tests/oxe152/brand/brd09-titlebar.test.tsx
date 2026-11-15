// Frozen acceptance test for 1.5.2 OxeCode/Shell F6 "marca" (OXE program oxespace-152-code, phase F6, Jira OXE-72, BRD-09).
// Written by the planner; the executor must not edit it. Source: the card OXE-72 spec-v1 (CA-1, CA-2, CA-3, RT-2, RT-3),
// oxespace-152-brand/.brand-audit/BRD-lote-1.md (BRD-09) and M1-api-e-criterios.md (tokens and primitives), the user's rule
// "tudo tem que sair como foi projetado na interface" and the coordination's binding: the card's task adds the data-ui its
// measures read and turns ITS OWN measures to enforced (enforced.lock.json).
// Today (main 66e0080d5) the mode selector is three aria-pressed <button>s in a grey box with a badge beside each, the
// needs-you pill always shows ("Nothing waiting" at zero) and the command field is a Button of size sm (24).
// Contract (pixels are the conformance scene's job, marca/conformidade; this file pins structure, words, behaviour and the
// measures as data):
// - ModeSwitch is the src/ui Tabs list: one [data-ui=tabs] role=tablist named t('nav.applicationView'), with exactly three
//   role=tab, OxeCode, OxeChat and OxeQuery in that order (product names, never translated), each keeping its
//   data-app-mode hook (code, thread, data); the shown mode is aria-selected="true", the others "false"; clicking another
//   tab calls onSelect with its mode. No role=tablist other than that one, and no aria-pressed on the tabs.
// - Each tab carries the "precisa de você" count of its own mode (activity store, live needs-you entries), as text inside
//   the tab: OxeCode the code count, OxeChat the thread count; no number at all when its count is 0, and never on OxeQuery.
// - NeedsYouPill renders nothing while nothing waits: no [data-testid=needs-you-pill] and no t('attention.nothingWaiting')
//   text; with something waiting it is there and its text says t('attention.needsYou', { count }) (one waiting OxeCode
//   terminal here, which counts the same before and after BRD-10's OXE-176 rule: the pill's number is the queue's rows).
// - The title bar's command field (CommandBarTrigger) is the md control: a Button with data-size="md" (28, 32 comfortable,
//   --control-md), still named from t('commandBar.trigger').
// - src/design/targets/brd-09.json (new, card OXE-72, platform desktop) holds the measures below, state "enforced", ids in
//   enforced.lock.json, scene code-workspace (e2e/brand/brand-conformance.spec.ts measures it), both densities and themes.
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ModeSwitch } from '../../../src/components/Navigation/ModeSwitch'
import { NeedsYouPill } from '../../../src/components/Navigation/NeedsYouPill'
import { CommandBarTrigger } from '../../../src/components/CommandBar/CommandBarTrigger'
import { useActivityStore } from '../../../src/store/activity.store'
import { useApprovalsStore } from '../../../src/components/Approvals/approvals.store'
import { useTerminalStore } from '../../../src/store/terminal.store'
import { useWorkspaceStore } from '../../../src/store/workspace.store'
import { changeLanguage, i18n } from '../../../src/i18n'

const ROOT = process.cwd()
const t = (key: string, options: Record<string, unknown> = {}): string => i18n.t(key, options) as string
const escape = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

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
const TITLEBAR_MEASURES: readonly Pin[] = [
  { id: 'BRD-09.mode-tab.height', scene: 'code-workspace', prop: 'height', expect: { token: '--bar-md' } },
  { id: 'BRD-09.mode-tab.font-size', scene: 'code-workspace', prop: 'font-size', expect: { token: '--text-xs' } },
  { id: 'BRD-09.mode-tab.font-weight', scene: 'code-workspace', prop: 'font-weight', expect: { token: '--weight-medium' } },
  { id: 'BRD-09.command-field.height', scene: 'code-workspace', prop: 'height', expect: { token: '--control-md' } }
]

function waiting(code: number, thread: number): void {
  const entries = (count: number, prefix: string) => Object.fromEntries(Array.from({ length: count }, (_, index) => [`${prefix}-${index}`, 'needs-you' as const]))
  useActivityStore.setState({ live: { code: { ...entries(code, 'pane'), 'pane-busy': 'working' }, thread: { ...entries(thread, 'thread'), 'thread-busy': 'working' } } } as never)
}
const tablist = (): HTMLElement => {
  const lists = screen.getAllByRole('tablist')
  expect(lists, 'one tablist in the mode selector').toHaveLength(1)
  return lists[0]
}
const tabs = (): HTMLElement[] => within(tablist()).getAllByRole('tab')
const digits = (el: Element): string => (el.textContent ?? '').replace(/[^0-9]/g, '')

beforeEach(() => {
  useWorkspaceStore.setState({ workspaces: [] } as never)
  useTerminalStore.setState({ panes: {} } as never)
  useActivityStore.setState({ live: { code: {}, thread: {} } } as never)
  useApprovalsStore.setState({ queue: [] } as never)
})
afterEach(async () => { cleanup(); vi.restoreAllMocks(); await changeLanguage('en') })

describe('OXE-72 BRD-09 title bar (A24)', () => {
  it.each(['en', 'pt-BR'])('the mode selector (%s) is the Tabs list: three tabs in order, the shown one selected', async locale => {
    await changeLanguage(locale)
    const onSelect = vi.fn()
    render(<ModeSwitch mode="thread" onSelect={onSelect} />)
    const list = tablist()
    expect(list).toHaveAttribute('data-ui', 'tabs')
    expect(list).toHaveAccessibleName(t('nav.applicationView'))
    const all = tabs()
    expect(all.map(tab => tab.getAttribute('data-app-mode'))).toEqual(['code', 'thread', 'data'])
    expect(all.map(tab => (tab.textContent ?? '').trim())).toEqual(['OxeCode', 'OxeChat', 'OxeQuery'])
    expect(all.map(tab => tab.getAttribute('aria-selected'))).toEqual(['false', 'true', 'false'])
    for (const tab of all) expect(tab.hasAttribute('aria-pressed'), 'a tab is selected, never pressed').toBe(false)
    fireEvent.click(all[2])
    expect(onSelect).toHaveBeenCalledWith('data')
  })

  it('each tab carries its own mode\'s "precisa de você" count, and no number at zero or on OxeQuery', () => {
    waiting(2, 3)
    const view = render(<ModeSwitch mode="code" onSelect={() => {}} />)
    expect(tabs().map(digits)).toEqual(['2', '3', ''])
    view.unmount()
    waiting(0, 0)
    render(<ModeSwitch mode="code" onSelect={() => {}} />)
    expect(tabs().map(digits)).toEqual(['', '', ''])
  })

  it.each(['en', 'pt-BR'])('the needs-you pill (%s) does not exist while nothing waits, and shows the count when something does', async locale => {
    await changeLanguage(locale)
    const first = render(<NeedsYouPill />)
    expect(screen.queryByTestId('needs-you-pill')).toBeNull()
    expect(screen.queryByText(t('attention.nothingWaiting'))).toBeNull()
    expect(document.body.textContent ?? '').not.toContain(t('attention.nothingWaiting'))
    first.unmount()
    // One OxeCode terminal waits (a real pane of a workspace, blocked): the pill's count today and the queue's pending
    // rows after BRD-10 / OXE-176 agree on it.
    const running = { status: 'running', error: null, lastActivityAt: null, lastOutput: null, lastIntent: null, lastIntentAt: null, isWorking: false, hasUnread: false, hookState: null, hookAt: null, agentSource: null, location: null, detached: false }
    useWorkspaceStore.setState({ workspaces: [{ id: 'ws-1', name: 'demo', rootPath: '/repo', defaultShellProfileId: 'builtin-claude', panes: [{ id: 'pane-0', workspaceId: 'ws-1', type: 'terminal', rowIndex: 0, columnIndex: 0, status: 'running', agentProfileId: null, agentName: 'Claude', displayName: null, shellProfileId: 'builtin-claude', rootPath: null, createdAt: null }] }] } as never)
    useTerminalStore.setState({ panes: { 'pane-0': { ...running, agentState: 'blocked' } } } as never)
    useActivityStore.setState({ live: { code: { 'pane-0': 'needs-you' }, thread: {} } } as never)
    render(<NeedsYouPill />)
    expect(screen.getByTestId('needs-you-pill')).toHaveTextContent(t('attention.needsYou', { count: 1 }))
  })

  it('the command field is the md control (28, 32 comfortable), named from the catalog', () => {
    render(<CommandBarTrigger onOpen={() => {}} />)
    const field = screen.getByRole('button', { name: new RegExp(`^${escape(t('commandBar.trigger'))}`) })
    expect(field).toHaveAttribute('data-ui', 'button')
    expect(field).toHaveAttribute('data-size', 'md')
  })

  it('turns its own BRD-09 title bar measures to enforced', () => {
    expect(measureProblems('BRD-09', 'OXE-72', TITLEBAR_MEASURES)).toEqual([])
  })
})
