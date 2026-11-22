// Frozen acceptance test for 1.5.2 HML fixes (Jira OXE-341, HML P1 · security, on 07d8df07c). Written by the planner;
// the executor must not edit it. The bugs: (1) Test in New connection saves the connection (with its secrets) and
// Cancel/Escape leaves it saved; (2) the MongoDB workbench reads only connection.readOnly and ignores what main says the
// connection allows (organization policy), so it shows read-write and its write buttons on a policy read-only connection.
// Contract:
// - src/components/OxeQuery/ConnectionDialog.tsx: a NEW connection saved only to be tested (savedId, not editing) is
//   deleted when the dialog closes without Save & open: oq('connections.delete', { id: savedId }), and the store
//   forgets it (refreshConnections or forgetConnection). Editing an existing connection never deletes it.
// - src/components/OxeQuery/MongoWorkbench.tsx: uses useConnectionSafety(connection) like SqlWorkbench: the badge reads
//   workbench.readOnlyPolicy when safety.readOnlyBy === 'policy', and with safety.readOnly no write action is offered
//   (mongo.newCollectionIn, mongo.renameNamed, mongo.dropNamed, mongo.changeMany).
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { ConnectionDialog } from '../../../src/components/OxeQuery/ConnectionDialog'
import { MongoWorkbench } from '../../../src/components/OxeQuery/MongoWorkbench'
import { useOxeQueryStore } from '../../../src/components/OxeQuery/oxequery.store'
import { connection, installFakeOxeQuery, type FakeOxeQuery } from '../../helpers/oxequery-api'

const oxequery = JSON.parse(readFileSync(join(process.cwd(), 'shared/locales/en/oxequery.json'), 'utf8')) as Record<string, Record<string, string>>
const cat = (key: string, vars: Record<string, string> = {}): string => {
  const [group, name] = key.split('.')
  const text = oxequery[group]?.[name]
  if (typeof text !== 'string') throw new Error(`the en oxequery catalog has no key ${key}`)
  return text.replace(/\{\{(\w+)\}\}/g, (_, v: string) => vars[v] ?? `{{${v}}}`)
}

let api: FakeOxeQuery
beforeEach(() => {
  api = installFakeOxeQuery()
  api.on('connections.list', [])
  api.on('containers.list', { engine: 'docker', containers: [] })
  useOxeQueryStore.setState({ connections: [], tabs: [], activeTab: '', dialog: { open: false, editing: null } } as never)
})
afterEach(() => {
  cleanup()
  act(() => useOxeQueryStore.setState({ dialog: { open: false, editing: null } } as never))
})

describe('OXE-341 · Testing a new connection leaves nothing behind', () => {
  test('Test then Cancel deletes the connection Test had to save', async () => {
    api.on('connections.save', (input: Record<string, unknown>) => connection({ id: 'c-test', host: String(input.host ?? '') }))
    api.on('connections.test', { ok: true, serverVersion: '16.1', latencyMs: 3 })
    api.on('connections.delete', null)
    act(() => useOxeQueryStore.setState({ dialog: { open: true, editing: null } } as never))
    render(<ConnectionDialog />)
    fireEvent.change(screen.getByLabelText(cat('form.host')), { target: { value: 'db.local' } })
    fireEvent.click(screen.getByRole('button', { name: cat('form.test') }))
    await waitFor(() => expect(api.callsOf('connections.test')).toHaveLength(1))
    await waitFor(() => expect(screen.getByRole('button', { name: cat('common.cancel') })).not.toBeDisabled())
    fireEvent.click(screen.getByRole('button', { name: cat('common.cancel') }))
    await waitFor(() => expect(api.callsOf('connections.delete')).toEqual([{ id: 'c-test' }]))
  })

  test('editing an existing connection and cancelling after Test deletes nothing', async () => {
    const existing = connection({ id: 'c-old' })
    api.on('connections.save', () => existing)
    api.on('connections.test', { ok: true })
    api.on('connections.delete', null)
    act(() => useOxeQueryStore.setState({ connections: [existing], dialog: { open: true, editing: existing } } as never))
    render(<ConnectionDialog />)
    fireEvent.click(screen.getByRole('button', { name: cat('form.test') }))
    await waitFor(() => expect(api.callsOf('connections.test')).toHaveLength(1))
    await waitFor(() => expect(screen.getByRole('button', { name: cat('common.cancel') })).not.toBeDisabled())
    fireEvent.click(screen.getByRole('button', { name: cat('common.cancel') }))
    expect(api.callsOf('connections.delete')).toEqual([])
  })
})

describe('OXE-341 · The MongoDB workbench follows what main says the connection allows', () => {
  test('a connection read-only by policy reads so and offers no write action', async () => {
    api.on('mongo.databases', [{ name: 'shop' }])
    api.on('mongo.collections', [{ name: 'items', type: 'collection' }])
    api.on('safety.get', { readOnly: true, readOnlyBy: 'policy', typedConfirmation: false, maxRows: 500, maxRowsCeiling: 500, statementTimeoutMs: 60_000 })
    render(<MongoWorkbench connection={connection({ engine: 'mongodb', readOnly: false })} />)
    await waitFor(() => expect(screen.getByText(cat('workbench.readOnlyPolicy'))).toBeInTheDocument())
    fireEvent.click(await screen.findByRole('button', { name: 'shop' }))
    await screen.findByRole('button', { name: 'items' })
    expect(screen.queryByRole('button', { name: cat('mongo.newCollectionIn', { database: 'shop' }) })).toBeNull()
    expect(screen.queryByRole('button', { name: cat('mongo.renameNamed', { name: 'items' }) })).toBeNull()
    expect(screen.queryByRole('button', { name: cat('mongo.dropNamed', { name: 'items' }) })).toBeNull()
    expect(screen.queryByRole('button', { name: cat('mongo.changeMany') })).toBeNull()
  })
})
