// Frozen acceptance test for 1.5.2 OxeCode/Shell F6 "marca" (OXE program oxespace-152-code, phase F6, Jira OXE-100, BRD-23).
// Written by the planner; the executor must not edit it. Source: the card OXE-100 spec-v1 (CA-1, CA-3, CA-4, CA-6, CA-7;
// CA-2's page contents are the target's table and marca/fidelidade's; CA-5, the 720 column, is OxeCode F5's BRD-06 measure),
// the approved interface artifact JpDiD9nKrPrMXdcnkED4US (section Settings, "Nova seção · Junta o que hoje é"),
// oxespace-152-brand/.brand-audit/BRD-lote-1.md (BRD-23), M1-api-e-criterios.md and the user's decision of 12/11 ("remover o
// excesso, amplificar o resto"); the coordination's binding (the card's task adds the data-ui its measures read and turns
// ITS OWN measures to enforced). Runs after OxeCode F5 (T26 owns SettingsCenter, SettingsModal and src/ui/Settings).
// Today (main 66e0080d5) Settings lists 14 application pages, has no App / workspace selector at the top, and
// SettingsSection is a card with a `plain` variant (data-variant="plain", OxeChat F2 CR-F2-2).
// Contract:
// - The "Settings categories" navigation (settings:center.categories) of the application holds exactly 9 sections, in
//   this order (English names from the card; pt-BR names are the brand's): General, Appearance, Agents & permissions,
//   Notifications, Keyboard, Terminal, Integrations, Data & diagnostics, About. A button's accessible name starts with
//   its section's name.
// - At the top, a [data-ui=settings-scope] selector with two choices, "App" and the workspace's name, and the search
//   (role searchbox, aria-keyshortcuts with Control+F). Choosing the workspace lists its sections, General, Projects and
//   Policy, in the same navigation.
// - Agents & permissions: "Custom agent" is a Button in a section header (the SettingsSection's actions), not a field
//   and not a row.
// - One mould (brand 15/11: CA-4 wins over CA-7): the card, SettingsSection with --radius-lg (12), a subtle border,
//   raised; no variant (no data-variant, `plain` is gone and its two uses become the card); measured on CI,
//   BRD-23.section.border-radius --radius-lg and the section title 14/600.
// - src/design/targets/brd-23.json (new, card OXE-100): the measures below, enforced and locked, scene settings-general.
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SettingsCenter } from '../../../src/components/Settings/SettingsCenter'
import { SettingRow, SettingsSection } from '../../../src/ui/Settings'
import { changeLanguage, i18n } from '../../../src/i18n'
import type { Workspace } from '../../../shared/types/workspace'

const ROOT = process.cwd()
const ts = (key: string): string => i18n.t(key, { ns: 'settings' }) as string

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
const SETTINGS_MEASURES: readonly Pin[] = [
  { id: 'BRD-23.section.border-radius', scene: 'settings-general', prop: 'border-radius', expect: { token: '--radius-lg' } },
  { id: 'BRD-23.section-title.font-size', scene: 'settings-general', prop: 'font-size', expect: { token: '--fs-md' } },
  { id: 'BRD-23.section-title.font-weight', scene: 'settings-general', prop: 'font-weight', expect: { token: '--weight-semibold' } }
]

const SECTIONS = ['General', 'Appearance', 'Agents & permissions', 'Notifications', 'Keyboard', 'Terminal', 'MCP and Skills', 'Phone and devices', 'Git', 'Data & diagnostics', 'About']
const workspace = { id: 'ws', name: 'demo', rootPath: '/repo', themeId: 'midnight', uiDensity: 'compact', layoutPreset: 4, defaultShellProfileId: 'sh', panes: [] } as unknown as Workspace
function open(initialWorkspaceId?: string): void {
  render(<SettingsCenter initialPage="general" workspaces={[workspace]} shellProfiles={[]} onSave={vi.fn()} onClose={vi.fn()} {...(initialWorkspaceId ? { initialWorkspaceId } : {})}
    agentProfiles={[]} agentReadiness={[]} isDiscoveringAgents={false} onDiscoverAgents={vi.fn()} onConfigureAgent={vi.fn()} onNewCustomAgent={vi.fn()} />)
}
const nav = (): HTMLElement => screen.getByRole('navigation', { name: ts('center.categories') })
const navNames = (): string[] => within(nav()).getAllByRole('button').map(button => (button.getAttribute('aria-label') ?? button.textContent ?? '').trim())

afterEach(async () => { cleanup(); localStorage.clear(); vi.restoreAllMocks(); await changeLanguage('en') })

describe('OXE-100 BRD-23 + OXE-431 Settings sections and the App / workspace selector (A33)', () => {
  it('the application has the 11 sections in order (MCP and Skills, Phone and devices, Git)', async () => {
    open()
    await waitFor(() => expect(navNames()).toHaveLength(11), { timeout: 10_000 })
    navNames().forEach((name, index) => expect(name.startsWith(SECTIONS[index]), `section ${index + 1} is ${SECTIONS[index]}: "${name}"`).toBe(true))
  }, 30_000)

  it('pt-BR has the same 11 sections, with the brand\'s names', async () => {
    await changeLanguage('pt-BR')
    open()
    await waitFor(() => expect(navNames()).toHaveLength(11), { timeout: 10_000 })
    const PT = ['Geral', 'Aparência', 'Agentes e permissões', 'Notificações', 'Teclado', 'Terminal', 'MCP e Skills', 'Celular e dispositivos', 'Git', 'Dados e diagnóstico', 'Sobre']
    navNames().forEach((name, index) => expect(name.startsWith(PT[index]), `seção ${index + 1} é ${PT[index]}: "${name}"`).toBe(true))
  }, 30_000)

  it('the top holds the App / workspace selector and the Ctrl+F search; the workspace lists General, Projects and Policy', async () => {
    open()
    const scopes = await screen.findAllByRole('dialog').then(() => document.querySelectorAll<HTMLElement>('[data-ui="settings-scope"]'))
    expect(scopes, 'one settings-scope').toHaveLength(1)
    const choices = [...scopes[0].querySelectorAll<HTMLElement>('[role="radio"], [role="tab"], button')]
    expect(choices.map(choice => (choice.textContent ?? '').trim())).toEqual(['App', 'demo'])
    const search = screen.getByRole('searchbox', { name: ts('center.searchLabel') })
    expect(search.getAttribute('aria-keyshortcuts') ?? '').toMatch(/Control\+F/)
    fireEvent.click(choices[1])
    await waitFor(() => expect(navNames()).toHaveLength(3))
    navNames().forEach((name, index) => expect(name.startsWith(['General', 'Projects', 'Policy'][index]), `workspace section ${index + 1}: "${name}"`).toBe(true))
  }, 30_000)

  it('Agents & permissions: "Custom agent" is a Button in a section header, not a field', async () => {
    open()
    await waitFor(() => expect(navNames()).toHaveLength(11), { timeout: 10_000 })
    fireEvent.click(within(nav()).getAllByRole('button')[SECTIONS.indexOf('Agents & permissions')])
    const button = await screen.findByRole('button', { name: 'Custom agent' }, { timeout: 10_000 })
    expect(button).toHaveAttribute('data-ui', 'button')
    expect(button.closest('[data-ui="settings-section"] > header'), 'in a section header').not.toBeNull()
    expect(button.closest('[data-ui="setting-row"]'), 'not a row').toBeNull()
    expect(screen.queryByRole('textbox', { name: /custom agent/i })).toBeNull()
  }, 30_000)

  it('one mould: SettingsSection has no variant', () => {
    render(<SettingsSection title="Section" {...({ plain: true } as Record<string, unknown>)}><SettingRow label="Row" control={<input aria-label="Row" />} /></SettingsSection>)
    const section = document.querySelector('[data-ui="settings-section"]')
    expect(section).not.toBeNull()
    expect(section?.hasAttribute('data-variant'), 'no variant').toBe(false)
  })

  it('turns its own BRD-23 measures to enforced', () => {
    expect(measureProblems('BRD-23', 'OXE-100', SETTINGS_MEASURES)).toEqual([])
  })
})
