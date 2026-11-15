// Frozen acceptance test for 1.5.2 OxeCode/Shell F6 "marca" (OXE program oxespace-152-code, phase F6, Jira OXE-77, BRD-12).
// Written by the planner; the executor must not edit it. Source: the card OXE-77 spec-v1 (CA-1 to CA-5, RT-1, RT-2; the
// pt-BR copy is the card's), the approved interface artifact JpDiD9nKrPrMXdcnkED4US (section Primeiro uso),
// oxespace-152-brand/.brand-audit/BRD-lote-1.md (BRD-12) and M1-api-e-criterios.md; the coordination's binding (the card's
// task adds the data-ui its measures read and turns ITS OWN measures to enforced).
// Today (main 66e0080d5) FirstRun has no mark, steps titled "Abra uma pasta de projeto" / "Conecte um agente" / "Comece sua
// primeira conversa", a disabled primary "Nova conversa" in the future step, two mode tiles below the list, and OxeCode's
// empty state (NoWorkspaceStart) shows the first-run checklist as a second start.
// Contract:
// - FirstRun ([data-testid=first-run]) shows the Ramo mark, the OxeMark svg, which carries data-ui="brand-mark", and the
//   title firstRun.v2.heroTitle ("Agentes que trabalham no seu código e mostram cada passo") on [data-ui=first-run-title]
//   (--text-display 28, --font-display, measured on CI).
// - One list of exactly 3 [data-ui=first-run-step], in order, each with data-state "done" | "current" | "next":
//   1 "Pasta do projeto" (shows the chosen path and a "Trocar" button; "Escolher pasta" style action before one is chosen),
//   2 "Conectar um agente" (each agent's state; "Entrar no Codex" for a signed-out Codex),
//   3 "Primeira conversa", which says "Abre quando um agente estiver conectado" while no agent is ready.
//   The first step not done is "current", the ones after it "next", the finished ones "done" and show a check (an svg).
//   A "next" step holds no disabled button (it stays neutral, nothing coloured and dead).
// - No "Clonar" anywhere; below the list, the line "Ou abra o OxeCode ou o OxeQuery sozinhos", whose OxeCode and OxeQuery
//   open the mode alone (onOpenMode('code' | 'data')); the mode tiles and their descriptions are gone.
// - NoWorkspaceStart (OxeCode with no workspace) never shows the first-run checklist ([data-testid=first-run-checklist])
//   as a second start.
// - src/design/targets/brd-12.json (new, card OXE-77): the measures below, enforced and locked, scene first-run, which
//   e2e/brand/brand-conformance.spec.ts measures (a fresh profile, before a workspace exists).
// The English copy is the brand's of 15/11 ("Agents that work in your code and show every step", Project folder, Change,
// Connect an agent, Sign in to Codex, Use Claude Code, First conversation, "Opens once an agent is connected", "Or open
// OxeCode or OxeQuery on their own"). Step 1's action is what creates the workspace: it keeps data-testid
// btn-new-workspace (e2e/helpers/launch.ts openDemoWorkspace clicks it), and the first run has no other New workspace
// button (brand 15/11).
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FirstRun, type FirstRunProps } from '../../../src/components/Onboarding/FirstRun'
import { NoWorkspaceStart } from '../../../src/components/Onboarding/NoWorkspaceStart'
import { useNavigationPrefs } from '../../../src/store/navigation-prefs.store'
import { changeLanguage, i18n } from '../../../src/i18n'

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
const FIRST_RUN_MEASURES: readonly Pin[] = [
  { id: 'BRD-12.title.font-size', scene: 'first-run', prop: 'font-size', expect: { token: '--text-display' } },
  { id: 'BRD-12.title.font-family', scene: 'first-run', prop: 'font-family', expect: { token: '--font-display' } }
]

function props(overrides: Partial<FirstRunProps> = {}): FirstRunProps {
  return { folder: null, agents: [{ provider: 'claude', status: 'missing' }, { provider: 'codex', status: 'signed-out' }], onOpenFolder: vi.fn(), onSignIn: vi.fn(), onCancelSignIn: vi.fn(),
    onNewConversation: vi.fn(), onOpenMode: vi.fn(), onNewWorkspace: vi.fn(), ...overrides }
}
const screenRoot = (): HTMLElement => screen.getByTestId('first-run')
const steps = (): HTMLElement[] => [...screenRoot().querySelectorAll<HTMLElement>('[data-ui="first-run-step"]')]
const states = (): Array<string | null> => steps().map(step => step.getAttribute('data-state'))
const squash = (text: string | null | undefined): string => (text ?? '').replace(/\s+/g, ' ').trim()

beforeEach(async () => { await changeLanguage('pt-BR') })
afterEach(async () => { cleanup(); vi.restoreAllMocks(); await changeLanguage('en') })

describe('OXE-77 BRD-12 first use, one start in three steps (A28)', () => {
  it('shows the Ramo mark and the display title', () => {
    render(<FirstRun {...props()} />)
    expect(screenRoot().querySelectorAll('svg[data-ui="brand-mark"]').length, 'the Ramo mark').toBeGreaterThan(0)
    const title = screenRoot().querySelectorAll('[data-ui="first-run-title"]')
    expect(title).toHaveLength(1)
    expect(squash(title[0].textContent)).toBe('Agentes que trabalham no seu código e mostram cada passo')
    expect(squash(title[0].textContent)).toBe(i18n.t('firstRun.v2.heroTitle'))
  })

  it('lists three steps with state: folder current, the rest next, the conversation waiting on an agent', () => {
    render(<FirstRun {...props()} />)
    expect(steps()).toHaveLength(3)
    expect(states()).toEqual(['current', 'next', 'next'])
    expect(within(steps()[0]).getByRole('heading', { name: 'Pasta do projeto' })).toBeInTheDocument()
    expect(within(steps()[1]).getByRole('heading', { name: 'Conectar um agente' })).toBeInTheDocument()
    expect(within(steps()[1]).getByRole('button', { name: 'Entrar no Codex' })).toBeInTheDocument()
    expect(within(steps()[2]).getByRole('heading', { name: 'Primeira conversa' })).toBeInTheDocument()
    expect(steps()[2]).toHaveTextContent('Abre quando um agente estiver conectado')
    for (const step of steps().filter(item => item.getAttribute('data-state') === 'next')) expect(step.querySelectorAll('button:disabled, [aria-disabled="true"]'), 'a future step has no dead button').toHaveLength(0)
  })

  it('with the folder chosen and an agent ready, the first two are done with a check, the path and "Trocar", and the conversation is current', () => {
    const onOpenFolder = vi.fn()
    render(<FirstRun {...props({ folder: '/repo/demo', agents: [{ provider: 'claude', status: 'ready' }, { provider: 'codex', status: 'signed-out' }], onOpenFolder })} />)
    expect(states()).toEqual(['done', 'done', 'current'])
    for (const step of steps().slice(0, 2)) expect(step.querySelectorAll('svg').length, 'a done step shows a check').toBeGreaterThan(0)
    expect(steps()[0]).toHaveTextContent('/repo/demo')
    fireEvent.click(within(steps()[0]).getByRole('button', { name: 'Trocar' }))
    expect(onOpenFolder).toHaveBeenCalledTimes(1)
    expect(steps()[2]).not.toHaveTextContent('Abre quando um agente estiver conectado')
  })

  it('has no Clonar and, below the list, only "Ou abra o OxeCode ou o OxeQuery sozinhos"', () => {
    const onOpenMode = vi.fn()
    render(<FirstRun {...props({ onOpenMode })} />)
    expect(screenRoot().textContent ?? '').not.toMatch(/Clonar/i)
    const line = [...screenRoot().querySelectorAll<HTMLElement>('*')].filter(el => squash(el.textContent) === 'Ou abra o OxeCode ou o OxeQuery sozinhos')
    expect(line.length, 'the line is there').toBeGreaterThan(0)
    for (const text of [i18n.t('firstRun.v2.modeDescCode'), i18n.t('firstRun.v2.modeDescQuery')]) expect(screenRoot().textContent ?? '').not.toContain(text)
    fireEvent.click(within(line[line.length - 1]).getByText('OxeCode'))
    fireEvent.click(within(line[line.length - 1]).getByText('OxeQuery'))
    expect(onOpenMode.mock.calls).toEqual([['code'], ['data']])
  })

  it('OxeCode with no workspace does not show the first-run checklist as a second start', async () => {
    useNavigationPrefs.setState(state => ({ firstRun: { ...state.firstRun, dismissed: false } }) as never)
    // The checklist is a lazy chunk today: load it first so its absence is not a matter of timing.
    await import('../../../src/components/Onboarding/FirstRunChecklist')
    render(<NoWorkspaceStart onNewWorkspace={vi.fn()} onSelectMode={vi.fn()} onAddProject={vi.fn()} />)
    await waitFor(() => expect(screen.getByText(i18n.t('app.start.newWorkspace'))).toBeInTheDocument())
    await new Promise(resolve => setTimeout(resolve, 1_500))
    expect(screen.queryByTestId('first-run-checklist')).toBeNull()
    expect(document.body.textContent ?? '').not.toContain(i18n.t('firstRun.title'))
  })

  it('reads in English with the brand\'s copy, and step 1 holds the one btn-new-workspace', async () => {
    await changeLanguage('en')
    render(<FirstRun {...props()} />)
    expect(squash(screenRoot().querySelector('[data-ui="first-run-title"]')?.textContent)).toBe('Agents that work in your code and show every step')
    for (const [index, name] of ['Project folder', 'Connect an agent', 'First conversation'].entries()) expect(within(steps()[index]).getByRole('heading', { name })).toBeInTheDocument()
    expect(within(steps()[1]).getByRole('button', { name: 'Sign in to Codex' })).toBeInTheDocument()
    expect(steps()[2]).toHaveTextContent('Opens once an agent is connected')
    expect([...screenRoot().querySelectorAll('*')].some(el => squash(el.textContent) === 'Or open OxeCode or OxeQuery on their own')).toBe(true)
    const create = screenRoot().querySelectorAll('[data-testid="btn-new-workspace"]')
    expect(create, 'one btn-new-workspace, in step 1').toHaveLength(1)
    expect(steps()[0].contains(create[0])).toBe(true)
  })

  it('turns its own BRD-12 measures to enforced', () => {
    expect(measureProblems('BRD-12', 'OXE-77', FIRST_RUN_MEASURES)).toEqual([])
  })
})
