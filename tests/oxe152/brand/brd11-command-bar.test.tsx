// Frozen acceptance test for 1.5.2 OxeCode/Shell F6 "marca" (OXE program oxespace-152-code, phase F6, Jira OXE-75, BRD-11).
// Written by the planner; the executor must not edit it. Source: the card OXE-75 spec-v1 (CA-1 to CA-4, RT-1, RT-2),
// oxespace-152-brand/.brand-audit/BRD-lote-1.md (BRD-11: "uma linha de dicas (exemplos no '?'), linhas de 32 em uma linha,
// uma paleta só com o prefixo '>'") and M1-api-e-criterios.md; the coordination's binding (the card's task adds the data-ui
// its measures read and turns ITS OWN measures to enforced).
// Today (main 66e0080d5) the empty bar shows four example cards, results are two-line rows (57 px), and Ctrl+Shift+P opens a
// second palette, CommandMenu (src/ui CommandPalette).
// Contract:
// - CommandBar's dialog is [data-ui=command-bar]. Empty, it shows one line of hints, [data-ui=command-hints], whose text
//   explains ">" and "?" (it contains both characters), and none of the example texts (commandBar.examples.*); typing "?"
//   shows the examples (the four commandBar.examples.* texts).
// - Every result (role=option) is a [data-ui=command-row]: one line, 32 px (36 comfortable, --bar-md, measured on CI).
// - With no prefix the text searches conversations (thread store titles), files and workspaces (workspace store names):
//   "billing" lists the workspace billing and the conversation "Billing webhook". With ">" first it lists commands only:
//   every option sits in the group named commandBar.groups.commands, and no workspace or conversation is offered.
// - One palette (CA-4, CommandMenu renders the same component) is T30b's, with the e2e migration (coordination 15/11).
// - src/design/targets/brd-11.json (new, card OXE-75): BRD-11.row.height (scene command-bar, height, --bar-md) enforced
//   and locked; e2e/brand/brand-conformance.spec.ts measures the command-bar scene (Ctrl+K in OxeCode, a query with rows).
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CommandBar } from '../../../src/components/CommandBar/CommandBar'
import { useWorkspaceStore } from '../../../src/store/workspace.store'
import { useThreadStore } from '../../../src/store/thread.store'
import { useSkillStore } from '../../../src/store/skill.store'
import { changeLanguage, i18n } from '../../../src/i18n'

const ROOT = process.cwd()
const t = (key: string): string => i18n.t(key) as string

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
const BAR_MEASURES: readonly Pin[] = [{ id: 'BRD-11.row.height', scene: 'command-bar', prop: 'height', expect: { token: '--bar-md' } }]

const WORKSPACES = ['billing', 'shop'].map(name => ({ id: `ws-${name}`, name, rootPath: `/repo/${name}`, panes: [] }))
const THREADS = [{ id: 't-1', workspaceId: 'ws-billing', projectId: 'p', rootPath: '/repo/billing', provider: 'claude', title: 'Billing webhook', pinned: false, status: 'idle', createdAt: 1, updatedAt: 1 }]
const CONTEXT = { workspaceId: 'ws-billing', enabledSkills: [], requests: [] }
const EXAMPLES = ['agent', 'skill', 'open'] as const

async function renderBar() {
  Object.assign(window, { oxe: { ...(window as unknown as { oxe?: object }).oxe, skill: { invoke: vi.fn(async () => undefined), list: vi.fn(async () => []) }, thread: { respond: vi.fn(async () => undefined) } } })
  act(() => {
    useSkillStore.setState({ skills: [] } as never)
    useWorkspaceStore.setState({ workspaces: WORKSPACES as never })
    useThreadStore.setState({ threads: THREADS as never })
  })
  render(<CommandBar open onOpenChange={vi.fn()} context={CONTEXT as never} onRun={vi.fn()} />)
  return screen.findByRole('combobox')
}
const bar = (): HTMLElement => {
  const found = document.querySelectorAll<HTMLElement>('[data-ui="command-bar"]')
  expect(found, 'one command-bar').toHaveLength(1)
  return found[0]
}
const options = (): HTMLElement[] => screen.queryAllByRole('option')

afterEach(async () => { cleanup(); vi.restoreAllMocks(); await changeLanguage('en') })

describe('OXE-75 BRD-11 one command bar (A27)', () => {
  it.each(['en', 'pt-BR'])('empty (%s), the bar shows one line of hints for ">" and "?", no examples; "?" shows them', async locale => {
    await changeLanguage(locale)
    const input = await renderBar()
    const hints = bar().querySelectorAll('[data-ui="command-hints"]')
    expect(hints, 'one hints line').toHaveLength(1)
    expect(hints[0].textContent ?? '').toContain('>')
    expect(hints[0].textContent ?? '').toContain('?')
    for (const kind of EXAMPLES) expect(screen.queryByText(t(`commandBar.examples.${kind}`)), `no ${kind} example when empty`).toBeNull()
    await userEvent.type(input, '?')
    for (const kind of EXAMPLES) await waitFor(() => expect(screen.getAllByText(t(`commandBar.examples.${kind}`)).length).toBeGreaterThan(0))
  })

  it('every result is a one-line command-row', async () => {
    const input = await renderBar()
    await userEvent.type(input, '> ')
    await waitFor(() => expect(options().length).toBeGreaterThan(0))
    for (const option of options()) expect(option, option.textContent ?? '').toHaveAttribute('data-ui', 'command-row')
  })

  it('with no prefix it finds workspaces and conversations; with ">" only commands', async () => {
    const input = await renderBar()
    await userEvent.type(input, 'billing')
    await waitFor(() => expect(options().some(option => /Billing webhook/.test(option.textContent ?? ''))).toBe(true))
    expect(options().some(option => /(^|\W)billing(\W|$)/.test(option.textContent ?? '') && !/webhook/i.test(option.textContent ?? ''))).toBe(true)
    await userEvent.clear(input)
    await userEvent.type(input, '>')
    await waitFor(() => expect(options().length).toBeGreaterThan(0))
    const commands = screen.getByRole('group', { name: t('commandBar.groups.commands') })
    for (const option of options()) expect(commands.contains(option), `${option.textContent} is a command`).toBe(true)
    expect(options().filter(option => /billing|shop|Billing webhook/.test(option.textContent ?? ''))).toEqual([])
  })

  it('turns its own BRD-11 measure to enforced', () => {
    expect(measureProblems('BRD-11', 'OXE-75', BAR_MEASURES)).toEqual([])
  })
})
