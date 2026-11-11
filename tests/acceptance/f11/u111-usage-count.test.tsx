// Frozen acceptance test for 1.5.0 A65 / N7 on screen (DESIGN U11.1, OXE program, phase F11, task FE-A65). Written by
// the planner; the executor must not edit it. Spec: .claude/roadmap-1.4/team/plans/1.5.0-f11-design.md (U11.1 and the
// 08/11 update).
// Contract (BACKEND #724 @ 2560473b): window.oxe.featureUsage { state() → { enabled, since, rows: [{ feature, uses, lastUsed }] },
// setEnabled({ enabled, clear? }), export() → { path } | null, clear(), record(feature), onChanged(cb) }; FEATURE_USAGE_KEYS in
// shared/feature-usage.ts. The renderer part: UsageSettings() in src/components/Settings/UsageSettings.tsx, the "Usage on
// this computer" section of Settings › Data and privacy. U11.1c (themes, 900 × 620, axe) is the e2e run.
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { changeLanguage } from '../../../src/i18n'

type Row = Record<string, unknown>
async function load<T>(rel: string): Promise<T> {
  const file = ['.tsx', '.ts'].map(ext => join(process.cwd(), `${rel}${ext}`)).find(candidate => existsSync(candidate))
  if (!file) throw new Error(`${rel} does not exist yet`)
  return import(/* @vite-ignore */ pathToFileURL(file).href) as Promise<T>
}
const NOW = Date.now()
const ROWS = [
  { feature: 'commandBar', uses: 3, lastUsed: NOW - 60_000 },
  { feature: 'timeTravel', uses: 9, lastUsed: NOW - 3_600_000 },
  { feature: 'agentBrowser', uses: 5, lastUsed: NOW - 86_400_000 }
]
function mockMain(state: Row = { enabled: true, since: NOW - 10 * 86_400_000, rows: ROWS }) {
  const listeners: Array<() => void> = []
  let current = state
  const featureUsage = {
    state: vi.fn(async () => current),
    setEnabled: vi.fn(async ({ enabled }: { enabled: boolean }) => { current = { ...current, enabled, rows: enabled ? current.rows : [] }; for (const listener of listeners) listener() }),
    export: vi.fn(async () => ({ path: 'C:/exports/usage.json' })),
    clear: vi.fn(async () => { current = { ...current, rows: [] }; for (const listener of listeners) listener() }),
    record: vi.fn(),
    onChanged: vi.fn((listener: () => void) => { listeners.push(listener); return () => undefined })
  }
  Object.assign(window, { oxe: { ...(window as unknown as { oxe?: object }).oxe, featureUsage } })
  return featureUsage
}
async function renderSection() {
  const { UsageSettings } = await load<{ UsageSettings: () => JSX.Element }>('src/components/Settings/UsageSettings')
  render(<UsageSettings />)
  return screen.findByRole('switch', { name: 'Count which features I use' })
}

afterEach(async () => { cleanup(); await changeLanguage('en') })

describe('U11.1 · Local usage count', () => {
  test('off by default: the switch is off, the help says nothing is sent, and there is no table', async () => {
    mockMain({ enabled: false, since: null, rows: [] })
    const toggle = await renderSection()
    expect(toggle).toHaveAttribute('aria-checked', 'false')
    expect(screen.getByText('Counted on this computer only. Nothing is sent.')).toBeInTheDocument()
    expect(screen.queryByRole('table')).toBeNull()
  })

  test('on, the table lists names a person knows, the largest count first, never the keys', async () => {
    mockMain()
    await renderSection()
    const table = await screen.findByRole('table')
    const rows = within(table).getAllByRole('row').slice(1)
    expect(rows.map(row => within(row).getAllByRole('cell')[0].textContent)).toEqual(['Time travel', 'Agent browser', 'Command bar'])
    expect(within(rows[0]).getByText('9')).toBeInTheDocument()
    expect(table.textContent).not.toMatch(/timeTravel|agentBrowser|commandBar/)
  })

  test('more than 12 features show the top 12, then Show all', async () => {
    const { FEATURE_USAGE_KEYS } = await load<{ FEATURE_USAGE_KEYS: readonly string[] }>('shared/feature-usage')
    mockMain({ enabled: true, since: NOW - 86_400_000, rows: FEATURE_USAGE_KEYS.slice(0, 15).map((feature, index) => ({ feature, uses: 100 - index, lastUsed: NOW })) })
    await renderSection()
    const table = await screen.findByRole('table')
    expect(within(table).getAllByRole('row').slice(1)).toHaveLength(12)
    await userEvent.click(screen.getByRole('button', { name: 'Show all' }))
    expect(within(table).getAllByRole('row').slice(1)).toHaveLength(15)
  })

  test('Export as JSON goes through main, and Clear the count confirms with Cancel focused before it empties', async () => {
    const main = mockMain()
    await renderSection()
    await screen.findByRole('table')
    await userEvent.click(screen.getByRole('button', { name: 'Export as JSON…' }))
    expect(main.export).toHaveBeenCalledTimes(1)
    await userEvent.click(screen.getByRole('button', { name: 'Clear the count…' }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText("Clear the usage count? This can't be undone.")).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: 'Cancel' })).toHaveFocus()
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    expect(main.clear).not.toHaveBeenCalled()
    await userEvent.click(screen.getByRole('button', { name: 'Clear the count…' }))
    await userEvent.click(within(await screen.findByRole('dialog')).getAllByRole('button').find(button => button.textContent?.trim() !== 'Cancel')!)
    expect(main.clear).toHaveBeenCalledTimes(1)
    expect(await screen.findByText('Nothing counted yet.')).toBeInTheDocument()
  })

  test('turning it off asks whether to clear, with Keep focused; Keep turns it off and keeps the rows', async () => {
    const main = mockMain()
    const toggle = await renderSection()
    await screen.findByRole('table')
    await userEvent.click(toggle)
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText('Also clear what was counted?')).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: 'Keep' })).toHaveFocus()
    await userEvent.click(within(dialog).getByRole('button', { name: 'Keep' }))
    await waitFor(() => expect(main.setEnabled).toHaveBeenCalledWith(expect.objectContaining({ enabled: false })))
    expect(main.setEnabled.mock.calls.at(-1)?.[0]).not.toMatchObject({ clear: true })
    expect(screen.queryByRole('table')).toBeNull()
  })

  test('turning it off with Clear passes clear: true', async () => {
    const main = mockMain()
    const toggle = await renderSection()
    await screen.findByRole('table')
    await userEvent.click(toggle)
    await userEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Clear' }))
    await waitFor(() => expect(main.setEnabled).toHaveBeenCalledWith({ enabled: false, clear: true }))
  })

  test('on with nothing yet says so, and nothing in the section asks to turn it on or records itself', async () => {
    const main = mockMain({ enabled: true, since: NOW, rows: [] })
    await renderSection()
    expect(await screen.findByText('Nothing counted yet.')).toBeInTheDocument()
    act(() => undefined)
    expect(main.record).not.toHaveBeenCalled()
  })

  test('every catalog key has a name in both languages, and the section reads in pt-BR', async () => {
    const { FEATURE_USAGE_KEYS } = await load<{ FEATURE_USAGE_KEYS: readonly string[] }>('shared/feature-usage')
    const { featureUsageName } = await load<{ featureUsageName: (key: string) => string }>('src/components/Settings/UsageSettings')
    for (const key of FEATURE_USAGE_KEYS) expect(featureUsageName(key), key).not.toBe(key)
    expect(featureUsageName('timeTravel')).toBe('Time travel')
    await changeLanguage('pt-BR')
    expect(featureUsageName('timeTravel')).toBe('Viagem no tempo')
    mockMain({ enabled: false, since: null, rows: [] })
    const { UsageSettings } = await load<{ UsageSettings: () => JSX.Element }>('src/components/Settings/UsageSettings')
    render(<UsageSettings />)
    expect(await screen.findByRole('switch', { name: 'Contar quais recursos eu uso' })).toBeInTheDocument()
    expect(screen.getByText('Contado só neste computador. Nada é enviado.')).toBeInTheDocument()
  })
})
