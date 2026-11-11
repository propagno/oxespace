// Frozen acceptance test for the 1.5.0 F2 gap G5 (OXE program, phase F2, second batch, task FE-G5 with R15 and R11).
// Written by the planner; the executor must not edit it. Spec: .claude/roadmap-1.4/team/plans/f2-gaps-FRONTEND.json
// (FE-G5); copy and placement by DESIGN (08/11).
// When OxePod leaves the mode switch (R15), "Connect in OxeQuery" on a container card goes with it. OxeQuery's New
// connection dialog gets the same path: a two-way choice "Enter the details" / "From a running container". The picker
// reads window.oxe.oxePod (containers.list, then containers.suggestConnection per running container, which never
// returns a password) and fills the existing draft. requestOxeQueryConnect stays for F9's Containers panel.
// The e2e helper connectFromContainer() keeps its signature and reaches OxeQuery through this dialog, so the OxeQuery
// e2e and visual specs that use it keep working without a pods mode.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { ConnectionDialog } from '../../../src/components/OxeQuery/ConnectionDialog'
import { useOxeQueryStore } from '../../../src/components/OxeQuery/oxequery.store'
import { installFakeOxeQuery, type FakeOxeQuery } from '../../helpers/oxequery-api'

const ROOT = process.cwd()
const read = (rel: string): string => readFileSync(join(ROOT, rel), 'utf8')
const keys = (value: unknown, prefix = ''): Array<[string, string]> => value && typeof value === 'object'
  ? Object.entries(value as Record<string, unknown>).flatMap(([key, child]) => keys(child, `${prefix}${key}.`))
  : [[prefix.slice(0, -1), String(value)]]

const container = (id: string, image: string, state: string, hostPort?: number) => ({
  id, name: id, image, state, status: state, labels: {}, ports: hostPort ? [{ hostIp: '0.0.0.0', hostPort, containerPort: 5432, protocol: 'tcp' }] : []
})
const SUGGESTIONS: Record<string, unknown> = {
  'billing-db': { engine: 'postgres', name: 'billing-db', host: 'localhost', port: 5433, database: 'billing', username: 'app', hasPassword: true },
  'events-db': { engine: 'mongodb', name: 'events-db', host: 'localhost', port: 27018, database: 'events', username: 'root', hasPassword: true },
  cache: null
}

let api: FakeOxeQuery
beforeEach(() => {
  api = installFakeOxeQuery()
  api.on('connections.list', [])
  useOxeQueryStore.setState({ connections: [], tabs: [], activeTab: '', dialog: { open: false, editing: null } })
})
afterEach(() => { cleanup(); act(() => useOxeQueryStore.setState({ dialog: { open: false, editing: null } })) })

async function openNewConnection(): Promise<HTMLElement> {
  render(<ConnectionDialog />)
  act(() => useOxeQueryStore.getState().openDialog(null))
  return screen.findByRole('dialog', { name: 'New connection' })
}
function scriptContainers(): void {
  api.on('containers.list', { engine: 'docker', containers: [container('billing-db', 'postgres:16', 'running', 5433), container('events-db', 'mongo:7', 'running', 27018), container('cache', 'redis:7', 'running', 6379), container('old-db', 'postgres:15', 'exited', 5434)] })
  api.on('containers.suggestConnection', (input: Record<string, unknown>) => SUGGESTIONS[String(input.id)] ?? null)
}

describe('G5 · OxeQuery connects from a running container without OxePod', () => {
  test('New connection offers Enter the details or From a running container, details first', async () => {
    scriptContainers()
    const dialog = within(await openNewConnection())
    expect(dialog.getByRole('radio', { name: 'Enter the details' })).toHaveAttribute('aria-checked', 'true')
    expect(dialog.getByRole('radio', { name: 'From a running container' })).toHaveAttribute('aria-checked', 'false')
  })

  test('the container list shows only running database containers OxeQuery supports, as name, engine and port', async () => {
    scriptContainers()
    const dialog = within(await openNewConnection())
    fireEvent.click(dialog.getByRole('radio', { name: 'From a running container' }))
    const select = await dialog.findByLabelText('Container')
    await waitFor(() => expect([...select.querySelectorAll('option')].map(option => option.textContent?.trim()).filter(text => text && /·/.test(text)))
      .toEqual(['billing-db · PostgreSQL · port 5433', 'events-db · MongoDB · port 27018']))
  })

  test('picking a container fills engine, host, port, user and database, and focuses the empty password with its hint', async () => {
    scriptContainers()
    const dialog = within(await openNewConnection())
    fireEvent.click(dialog.getByRole('radio', { name: 'From a running container' }))
    const select = await dialog.findByLabelText('Container')
    await waitFor(() => expect(select.querySelectorAll('option').length).toBeGreaterThan(1))
    const billing = [...select.querySelectorAll('option')].find(option => option.textContent?.startsWith('billing-db')) as HTMLOptionElement
    fireEvent.change(select, { target: { value: billing.value } })
    await waitFor(() => expect(dialog.getByLabelText('Port')).toHaveValue(5433))
    expect(dialog.getByLabelText('Host')).toHaveValue('localhost')
    expect(dialog.getByLabelText('User')).toHaveValue('app')
    expect(dialog.getByLabelText('Database')).toHaveValue('billing')
    expect(dialog.getByRole('radio', { name: 'PostgreSQL' })).toHaveAttribute('aria-checked', 'true')
    const password = dialog.getByLabelText('Password')
    expect(password).toHaveValue('')
    await waitFor(() => expect(password).toHaveFocus())
    expect(dialog.getByText('Type the password. OxeQuery never reads it from the container.')).toBeInTheDocument()
    expect(dialog.getByLabelText('Port')).not.toHaveAttribute('readonly')
    // Only the two read operations reach OxePod: nothing asks the container for its password.
    expect([...new Set(api.calls.filter(call => call.channel === 'oxePod').map(call => call.op))].sort()).toEqual(['containers.list', 'containers.suggestConnection'])
  })

  test('with no database container running, the option is off and says why', async () => {
    api.on('containers.list', { engine: 'docker', containers: [container('cache', 'redis:7', 'running', 6379)] })
    api.on('containers.suggestConnection', () => null)
    const dialog = within(await openNewConnection())
    await waitFor(() => expect(dialog.getByRole('radio', { name: 'From a running container' })).toBeDisabled())
    expect(dialog.getByText('No database container is running.')).toBeInTheDocument()
    expect(dialog.queryByRole('alert')).toBeNull()
  })

  test('with Docker not running, the option is off and says why, not an error', async () => {
    api.on('containers.list', () => { throw Object.assign(new Error('Cannot connect to the Docker daemon'), { code: 'daemon' }) })
    const dialog = within(await openNewConnection())
    await waitFor(() => expect(dialog.getByRole('radio', { name: 'From a running container' })).toBeDisabled())
    expect(dialog.getByText("Docker isn't running. Start it to see your containers.")).toBeInTheDocument()
    expect(dialog.queryByRole('alert')).toBeNull()
    expect(dialog.queryByText(/Cannot connect to the Docker daemon/)).toBeNull()
  })

  test("OxeQuery's own words no longer send people to OxePod, in en and pt-BR", () => {
    const en = Object.fromEntries(keys(JSON.parse(read('shared/locales/en/oxequery.json'))))
    const pt = Object.fromEntries(keys(JSON.parse(read('shared/locales/pt-BR/oxequery.json'))))
    expect(Object.entries(en).filter(([, text]) => /OxePod/.test(text)).map(([key]) => key)).toEqual([])
    expect(Object.entries(pt).filter(([, text]) => /OxePod/.test(text)).map(([key]) => key)).toEqual([])
    expect(Object.values(en)).toContain('Add one, or connect from a running database container.')
    expect(Object.values(en)).toContain('Choose a connection on the left, or add one.')
    expect(Object.values(pt)).toContain('Adicione uma, ou conecte a partir de um contêiner de banco em execução.')
    expect(Object.values(pt)).toContain('Escolha uma conexão à esquerda, ou adicione uma.')
  })

  test('the e2e helper connectFromContainer reaches OxeQuery through New connection, with no pods mode', () => {
    const helper = read('e2e/helpers/oxepod.ts')
    const start = helper.indexOf('export async function connectFromContainer(')
    expect(start).toBeGreaterThanOrEqual(0)
    // Same signature, so the OxeQuery specs that call it stay unchanged.
    expect(helper.slice(start, helper.indexOf('Promise<void>', start) + 'Promise<void>'.length)).toMatch(/connectFromContainer\(page: Page, name: string, labels = \{[^)]*\}\): Promise<void>/)
    const body = helper.slice(start, helper.indexOf('\n}\n', start))
    expect(body).not.toMatch(/'pods'|OxePod|in OxeQuery\$/)
    expect(body).toMatch(/From a running container/)
    expect(body).toMatch(/Container/)
    // The bridge stays for F9's Containers panel.
    expect(read('src/components/OxeQuery/oxequery-bridge.ts')).toMatch(/export function requestOxeQueryConnect\(/)
  })
})
