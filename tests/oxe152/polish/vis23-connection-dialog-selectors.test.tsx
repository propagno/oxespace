import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { ConnectionDialog } from '../../../src/components/OxeQuery/ConnectionDialog'
import { useOxeQueryStore } from '../../../src/components/OxeQuery/oxequery.store'
import { changeLanguage, i18n } from '../../../src/i18n'
import field from '../../../src/ui/Field.module.css'
import { installFakeOxeQuery, type FakeOxeQuery } from '../../helpers/oxequery-api'

let api: FakeOxeQuery

const tq = (key: string): string => i18n.t(key, { ns: 'oxequery' }) as string

async function openNewConnection(): Promise<HTMLElement> {
  render(<ConnectionDialog />)
  act(() => useOxeQueryStore.getState().openDialog(null))
  return screen.findByRole('dialog', { name: tq('connections.new') })
}

describe('OXE-46 VIS-23 ConnectionDialog selectors', () => {
  beforeEach(() => {
    api = installFakeOxeQuery()
    api.on('connections.list', [])
    api.on('containers.list', { engine: 'docker', containers: [] })
    useOxeQueryStore.setState({ connections: [], tabs: [], activeTab: '', dialog: { open: false, editing: null } })
  })

  afterEach(async () => {
    cleanup()
    act(() => useOxeQueryStore.setState({ dialog: { open: false, editing: null } }))
    delete document.documentElement.dataset.theme
    delete document.documentElement.dataset.density
    await changeLanguage('en')
  })

  test('uses consistent SegmentedControl primitive for engine, mode and environment with zero raw oq-engine buttons across themes and densities', async () => {
    for (const locale of ['pt-BR', 'en'] as const) {
      await changeLanguage(locale)
      for (const theme of ['light', 'dark'] as const) {
        for (const density of ['compact', 'comfortable'] as const) {
          document.documentElement.dataset.theme = theme
          document.documentElement.dataset.density = density

          const dialog = await openNewConnection()
          const scoped = within(dialog)

          // Zero raw oq-engine cards remain.
          expect(dialog.querySelectorAll('.oq-engine, .oq-engines')).toHaveLength(0)

          // Engine, mode and environment all share the single src/ui SegmentedControl primitive.
          const engineGroup = scoped.getByRole('radiogroup', { name: tq('newDatabase.engine') })
          const modeGroup = scoped.getByRole('radiogroup', { name: tq('form.connectBy') })
          const envGroup = scoped.getByRole('radiogroup', { name: tq('form.environment') })

          for (const group of [engineGroup, modeGroup, envGroup]) {
            expect(group).toHaveClass(field.segmented)
            const radios = within(group).getAllByRole('radio')
            expect(radios.length).toBeGreaterThanOrEqual(2)
            for (const radio of radios) {
              expect(radio).toHaveClass(field.segment)
            }
          }

          // Prod keeps semantic danger tone while Local and Dev stay neutral.
          const localRadio = within(envGroup).getByRole('radio', { name: tq('environment.local') })
          const devRadio = within(envGroup).getByRole('radio', { name: tq('environment.dev') })
          const prodRadio = within(envGroup).getByRole('radio', { name: tq('environment.prod') })
          expect(localRadio).not.toHaveAttribute('data-tone')
          expect(devRadio).not.toHaveAttribute('data-tone')
          expect(prodRadio).toHaveAttribute('data-tone', 'danger')

          cleanup()
          act(() => useOxeQueryStore.setState({ dialog: { open: false, editing: null } }))
        }
      }
    }

    const css = readFileSync(join(process.cwd(), 'src/components/OxeQuery/OxeQuery.css'), 'utf8')
    expect(css).not.toMatch(/\.oq-engines?(?![\w-])/)
    expect(css).not.toMatch(/\.oq-environment\s*\{[^}]*(background|height|padding|border-radius|font-size)\s*:/)
  })

  test('preserves engine default port switching, prod write guard and keyboard navigation', async () => {
    const dialog = await openNewConnection()
    const scoped = within(dialog)

    const engineGroup = scoped.getByRole('radiogroup', { name: tq('newDatabase.engine') })
    const pgRadio = within(engineGroup).getByRole('radio', { name: 'PostgreSQL' })
    const mongoRadio = within(engineGroup).getByRole('radio', { name: 'MongoDB' })

    expect(pgRadio).toHaveAttribute('aria-checked', 'true')
    expect(scoped.getByLabelText(tq('form.port'))).toHaveValue(5432)

    // Keyboard navigation (ArrowRight) switches engine to MongoDB (URL mode, default port 27017).
    fireEvent.keyDown(pgRadio, { key: 'ArrowRight' })
    expect(mongoRadio).toHaveAttribute('aria-checked', 'true')
    expect(scoped.getByLabelText(tq('form.connectionString'))).toBeInTheDocument()

    // Switch mode back to Host via ArrowLeft on the active URL radio to inspect default port 27017.
    const modeGroup = scoped.getByRole('radiogroup', { name: tq('form.connectBy') })
    const urlRadio = within(modeGroup).getByRole('radio', { name: tq('form.url') })
    expect(urlRadio).toHaveAttribute('aria-checked', 'true')
    fireEvent.keyDown(urlRadio, { key: 'ArrowLeft' })
    expect(within(modeGroup).getByRole('radio', { name: tq('form.host') })).toHaveAttribute('aria-checked', 'true')
    expect(scoped.getByLabelText(tq('form.port'))).toHaveValue(27017)

    // Switch back to PostgreSQL via click: default port returns to 5432.
    fireEvent.click(pgRadio)
    expect(pgRadio).toHaveAttribute('aria-checked', 'true')
    expect(scoped.getByLabelText(tq('form.port'))).toHaveValue(5432)

    // Expand "Limits and agents", enable agent write access, then move environment to Prod: write drops to read.
    fireEvent.click(scoped.getByRole('button', { name: new RegExp(`^${tq('form.limits')}`) }))
    const accessSelect = scoped.getByLabelText(tq('form.agents'))
    fireEvent.change(accessSelect, { target: { value: 'write' } })
    expect(accessSelect).toHaveValue('write')

    const envGroup = scoped.getByRole('radiogroup', { name: tq('form.environment') })
    const localRadio = within(envGroup).getByRole('radio', { name: tq('environment.local') })
    fireEvent.keyDown(localRadio, { key: 'ArrowLeft' })
    expect(within(envGroup).getByRole('radio', { name: tq('environment.prod') })).toHaveAttribute('aria-checked', 'true')
    expect(accessSelect).toHaveValue('read')

    // Turning Read-only off on a Prod connection surfaces the production writes warning.
    fireEvent.click(scoped.getByRole('switch', { name: tq('form.readOnly') }))
    expect(scoped.getByText(tq('form.prodWrites'))).toBeInTheDocument()
  })
})
