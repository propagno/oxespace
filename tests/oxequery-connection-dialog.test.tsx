import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ConnectionDialog } from '../src/components/OxeQuery/ConnectionDialog'
import { useOxeQueryStore } from '../src/components/OxeQuery/oxequery.store'
import { connection, installFakeOxeQuery, type FakeOxeQuery } from './helpers/oxequery-api'

let api: FakeOxeQuery
beforeEach(() => {
  api = installFakeOxeQuery()
  api.on('connections.list', [])
  useOxeQueryStore.setState({ connections: [connection({ id: 'x', group: 'Client A' })], tabs: useOxeQueryStore.getState().tabs.slice(0, 2), activeTab: 'containers', dialog: { open: false, editing: null } })
})
afterEach(() => { cleanup(); act(() => useOxeQueryStore.setState({ dialog: { open: false, editing: null } })) })

const openDialog = (editing: ReturnType<typeof connection> | null = null): void => { act(() => useOxeQueryStore.getState().openDialog(editing)) }

describe('ConnectionDialog', () => {
  it('saves the group, color, favorite, masked names and keep-alive with the connection', async () => {
    api.on('connections.save', (input: Record<string, unknown>) => connection({ id: 'new', name: String(input.name) }))
    render(<ConnectionDialog />)
    openDialog()
    const dialog = await screen.findByRole('dialog', { name: 'New connection' })
    fireEvent.change(within(dialog).getByLabelText('Name'), { target: { value: 'Billing' } })
    fireEvent.change(within(dialog).getByLabelText('Group'), { target: { value: 'Client A' } })
    fireEvent.click(within(dialog).getByRole('radio', { name: 'violet' }))
    fireEvent.click(within(dialog).getByRole('checkbox', { name: 'Favorite' }))
    fireEvent.click(within(dialog).getByRole('button', { name: /^Limits and agents/ }))
    fireEvent.change(within(dialog).getByLabelText(/Names agents must not see/), { target: { value: 'ssn\n  card_number \n\n' } })
    fireEvent.change(within(dialog).getByLabelText(/Keep-alive/), { target: { value: '0' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save and open' }))
    await waitFor(() => expect(api.callsOf('connections.save')).toHaveLength(1))
    expect(api.callsOf('connections.save')[0]).toMatchObject({ name: 'Billing', group: 'Client A', color: 'violet', favorite: true, maskPatterns: ['ssn', 'card_number'], keepaliveSeconds: 0 })
  })

  it('suggests the groups that already exist', async () => {
    render(<ConnectionDialog />)
    openDialog()
    const dialog = await screen.findByRole('dialog', { name: 'New connection' })
    const options = [...dialog.querySelectorAll('datalist#oq-groups option')].map(option => option.getAttribute('value'))
    expect(options).toEqual(['Client A'])
  })

  it('connects without saving: one call that carries the form and never the save call', async () => {
    api.on('connections.connectEphemeral', (input: Record<string, unknown>) => connection({ id: 'tmp-1', name: String(input.name), ephemeral: true }))
    render(<ConnectionDialog />)
    openDialog()
    const dialog = await screen.findByRole('dialog', { name: 'New connection' })
    fireEvent.change(within(dialog).getByLabelText('Name'), { target: { value: 'scratch' } })
    fireEvent.change(within(dialog).getByLabelText('Password'), { target: { value: 'pw' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Connect without saving' }))
    await waitFor(() => expect(api.callsOf('connections.connectEphemeral')).toHaveLength(1))
    expect(api.callsOf('connections.connectEphemeral')[0]).toMatchObject({ name: 'scratch', password: 'pw', engine: 'postgres' })
    expect(api.callsOf('connections.save')).toHaveLength(0)
    await waitFor(() => expect(useOxeQueryStore.getState().dialog.open).toBe(false))
    expect(useOxeQueryStore.getState().tabs.some(tab => tab.kind === 'connection' && tab.connectionId === 'tmp-1')).toBe(true)
  })

  it('does not offer to connect without saving when editing a saved connection', async () => {
    render(<ConnectionDialog />)
    openDialog(connection({ id: 'x' }))
    const dialog = await screen.findByRole('dialog', { name: 'Edit connection' })
    expect(within(dialog).queryByRole('button', { name: 'Connect without saving' })).toBeNull()
  })

  it('uses the SSH agent without asking for a key or a password', async () => {
    api.on('connections.save', (input: Record<string, unknown>) => connection({ id: 'new', name: String(input.name) }))
    render(<ConnectionDialog />)
    openDialog()
    const dialog = await screen.findByRole('dialog', { name: 'New connection' })
    fireEvent.click(within(dialog).getByRole('button', { name: /^SSH tunnel/ }))
    fireEvent.click(within(dialog).getByRole('checkbox', { name: /Connect through an SSH server/ }))
    fireEvent.change(within(dialog).getByLabelText('Authentication'), { target: { value: 'agent' } })
    expect(within(dialog).getByText(/Uses the keys loaded in your running SSH agent/)).toBeInTheDocument()
    expect(within(dialog).queryByLabelText('SSH password')).toBeNull()
    expect(within(dialog).queryByRole('button', { name: /Choose file/ })).toBeNull()
    fireEvent.change(within(dialog).getByLabelText('SSH host'), { target: { value: 'bastion' } })
    fireEvent.change(within(dialog).getByLabelText('SSH user'), { target: { value: 'me' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save and open' }))
    await waitFor(() => expect(api.callsOf('connections.save')).toHaveLength(1))
    expect(api.callsOf('connections.save')[0]).toMatchObject({ ssh: { enabled: true, host: 'bastion', user: 'me', auth: 'agent' } })
    expect((api.callsOf('connections.save')[0]!.ssh as Record<string, unknown>).password).toBeUndefined()
  })

  it('fills the form from a pasted connection string', async () => {
    render(<ConnectionDialog />)
    openDialog()
    const dialog = await screen.findByRole('dialog', { name: 'New connection' })
    fireEvent.click(within(dialog).getByRole('radio', { name: 'URL' }))
    fireEvent.change(within(dialog).getByLabelText('Connection string'), { target: { value: 'postgres://app:s3cret@db.internal:6543/shop?sslmode=require' } })
    fireEvent.click(within(dialog).getByRole('radio', { name: 'Host' }))
    expect(within(dialog).getByLabelText('Host')).toHaveValue('db.internal')
    expect(within(dialog).getByLabelText('Port')).toHaveValue(6543)
    expect(within(dialog).getByLabelText('Database')).toHaveValue('shop')
  })
})
