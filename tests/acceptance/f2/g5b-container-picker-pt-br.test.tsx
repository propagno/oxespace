// Frozen acceptance test for 1.5.0 A70, F2 gap G5b (OXE program, phase F2, task FE-G5b, after FE-G5). Written by the
// planner; the executor must not edit it. From DESIGN's M5 on #696: g5 froze the container picker in English only. This
// reads the same real dialog in pt-BR: the choice, the item format "{nome} · {engine} · porta {porta}", the password hint
// and both disabled reasons, verbatim (DESIGN 08/11).
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { ConnectionDialog } from '../../../src/components/OxeQuery/ConnectionDialog'
import { useOxeQueryStore } from '../../../src/components/OxeQuery/oxequery.store'
import { changeLanguage } from '../../../src/i18n'
import { installFakeOxeQuery, type FakeOxeQuery } from '../../helpers/oxequery-api'

const container = (id: string, image: string, state: string, hostPort?: number) => ({
  id, name: id, image, state, status: state, labels: {}, ports: hostPort ? [{ hostIp: '0.0.0.0', hostPort, containerPort: 5432, protocol: 'tcp' }] : []
})
const SUGGESTIONS: Record<string, unknown> = {
  'billing-db': { engine: 'postgres', name: 'billing-db', host: 'localhost', port: 5433, database: 'billing', username: 'app', hasPassword: true },
  'events-db': { engine: 'mongodb', name: 'events-db', host: 'localhost', port: 27018, database: 'events', username: 'root', hasPassword: true },
  cache: null
}

let api: FakeOxeQuery
beforeEach(async () => {
  await changeLanguage('pt-BR')
  api = installFakeOxeQuery()
  api.on('connections.list', [])
  useOxeQueryStore.setState({ connections: [], tabs: [], activeTab: '', dialog: { open: false, editing: null } })
})
afterEach(async () => { cleanup(); act(() => useOxeQueryStore.setState({ dialog: { open: false, editing: null } })); await changeLanguage('en') })

async function openNewConnection(): Promise<HTMLElement> {
  render(<ConnectionDialog />)
  act(() => useOxeQueryStore.getState().openDialog(null))
  return screen.findByRole('dialog')
}

describe('G5b · the container picker in pt-BR', () => {
  test('the choice and the container list read in pt-BR, as name, engine and porta', async () => {
    api.on('containers.list', { engine: 'docker', containers: [container('billing-db', 'postgres:16', 'running', 5433), container('events-db', 'mongo:7', 'running', 27018), container('cache', 'redis:7', 'running', 6379)] })
    api.on('containers.suggestConnection', (input: Record<string, unknown>) => SUGGESTIONS[String(input.id)] ?? null)
    const dialog = within(await openNewConnection())
    expect(dialog.getByRole('radio', { name: 'Digitar os dados' })).toHaveAttribute('aria-checked', 'true')
    fireEvent.click(dialog.getByRole('radio', { name: 'De um contêiner em execução' }))
    const select = await dialog.findByLabelText('Contêiner')
    await waitFor(() => expect([...select.querySelectorAll('option')].map(option => option.textContent?.trim()).filter(text => text && /·/.test(text)))
      .toEqual(['billing-db · PostgreSQL · porta 5433', 'events-db · MongoDB · porta 27018']))
    const billing = [...select.querySelectorAll('option')].find(option => option.textContent?.startsWith('billing-db')) as HTMLOptionElement
    fireEvent.change(select, { target: { value: billing.value } })
    expect(await dialog.findByText('Digite a senha. O OxeQuery nunca a lê do contêiner.')).toBeInTheDocument()
  })

  test('with no database container running, the reason reads in pt-BR', async () => {
    api.on('containers.list', { engine: 'docker', containers: [container('cache', 'redis:7', 'running', 6379)] })
    api.on('containers.suggestConnection', () => null)
    const dialog = within(await openNewConnection())
    await waitFor(() => expect(dialog.getByRole('radio', { name: 'De um contêiner em execução' })).toBeDisabled())
    expect(dialog.getByText('Nenhum contêiner de banco está em execução.')).toBeInTheDocument()
  })

  test('with Docker not running, the reason reads in pt-BR, not an error', async () => {
    api.on('containers.list', () => { throw Object.assign(new Error('Cannot connect to the Docker daemon'), { code: 'daemon' }) })
    const dialog = within(await openNewConnection())
    await waitFor(() => expect(dialog.getByRole('radio', { name: 'De um contêiner em execução' })).toBeDisabled())
    expect(dialog.getByText('O Docker não está em execução. Inicie-o para ver seus contêineres.')).toBeInTheDocument()
    expect(dialog.queryByRole('alert')).toBeNull()
  })
})
