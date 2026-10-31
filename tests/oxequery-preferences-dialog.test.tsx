import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { PreferencesDialog } from '../src/components/OxeQuery/PreferencesDialog'
import { installFakeOxeQuery, type FakeOxeQuery } from './helpers/oxequery-api'
import type { OxeQueryPreferences } from '../shared/types/oxequery'

const preferences: OxeQueryPreferences = {
  historyLimit: 200, auditRetentionDays: 90, agentCeiling: { local: 'write', dev: 'write', prod: 'read' },
  environmentLimits: { local: { maxRows: null, statementTimeoutMs: null }, dev: { maxRows: null, statementTimeoutMs: null }, prod: { maxRows: 1000, statementTimeoutMs: 30_000 } }
}

let api: FakeOxeQuery
beforeEach(() => {
  api = installFakeOxeQuery()
  api.on('preferences.get', preferences)
})
afterEach(() => cleanup())

const group = async (name: string): Promise<HTMLElement> => within(await screen.findByRole('dialog', { name: 'OxeQuery settings' })).getByRole('group', { name })

describe('OxeQuery settings: limits by environment', () => {
  it('show production held to 1,000 rows and 30 seconds, and the others without a limit', async () => {
    render(<PreferencesDialog onClose={() => undefined} />)
    const prod = await group('Production')
    expect(within(prod).getByRole('combobox', { name: 'Rows' })).toHaveValue('1000')
    expect(within(prod).getByRole('combobox', { name: 'Statement time' })).toHaveValue('30000')
    const dev = await group('Development')
    expect(within(dev).getByRole('combobox', { name: 'Rows' })).toHaveValue('none')
    expect(within(dev).getByRole('combobox', { name: 'Statement time' })).toHaveValue('none')
  })

  it('save a ceiling for an environment, and remove one', async () => {
    render(<PreferencesDialog onClose={() => undefined} />)
    api.on('preferences.set', (input: Record<string, unknown>) => ({ ...preferences, ...input }))
    const dev = await group('Development')
    fireEvent.change(within(dev).getByRole('combobox', { name: 'Rows' }), { target: { value: '5000' } })
    fireEvent.change(within(dev).getByRole('combobox', { name: 'Statement time' }), { target: { value: '300000' } })
    const prod = await group('Production')
    fireEvent.change(within(prod).getByRole('combobox', { name: 'Rows' }), { target: { value: 'none' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(api.callsOf('preferences.set')).toHaveLength(1))
    expect(api.callsOf('preferences.set')[0].environmentLimits).toEqual({
      local: { maxRows: null, statementTimeoutMs: null },
      dev: { maxRows: 5000, statementTimeoutMs: 300_000 },
      prod: { maxRows: null, statementTimeoutMs: 30_000 }
    })
  })

  it('name the time in seconds below a minute and in minutes above it', async () => {
    render(<PreferencesDialog onClose={() => undefined} />)
    const prod = await group('Production')
    const labels = within(within(prod).getByRole('combobox', { name: 'Statement time' })).getAllByRole('option').map(option => option.textContent)
    expect(labels).toContain('30 seconds')
    expect(labels).toContain('5 minutes')
    expect(labels).toContain('No limit')
  })
})
