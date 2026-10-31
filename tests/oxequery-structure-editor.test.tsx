import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { StructureEditor } from '../src/components/OxeQuery/StructureEditor'
import type { SqlTableDetails } from '../shared/types/oxequery'
import { connection, installFakeOxeQuery, refusal, type FakeOxeQuery } from './helpers/oxequery-api'

const details: SqlTableDetails = {
  columns: [
    { name: 'id', type: 'integer', nullable: false, primaryKey: true, position: 1, identity: 'always' },
    { name: 'email', type: 'text', nullable: false, primaryKey: false, position: 2 },
    { name: 'legacy', type: 'text', nullable: true, primaryKey: false, position: 3 }
  ],
  indexes: [{ name: 'users_pkey', definition: 'CREATE UNIQUE INDEX users_pkey ON users (id)', unique: true, primary: true }, { name: 'users_email', definition: 'CREATE INDEX users_email ON users (email)', unique: false, primary: false }],
  foreignKeys: [], constraints: [{ name: 'users_pkey', kind: 'primary', definition: 'PRIMARY KEY (id)' }], dependents: [{ kind: 'view', schema: 'public', name: 'active_users' }],
  privileges: [{ grantee: 'app', privilege: 'SELECT', grantable: false }], properties: { kind: 'table', owner: 'app', sizeBytes: 16384, estimatedRows: 12, comment: 'people' }
}

let api: FakeOxeQuery
beforeEach(() => {
  api = installFakeOxeQuery()
  api.on('sql.table', details)
  api.on('sql.structure.preview', (input: Record<string, unknown>) => ({
    statements: [`-- ${JSON.stringify((input.action as { kind: string }).kind)}`, 'ALTER TABLE "public"."users" DROP COLUMN "legacy"'],
    warnings: ['Dropping "legacy" deletes its data for good.'], destructive: (input.action as { kind: string }).kind !== 'create'
  }))
})
afterEach(() => cleanup())

function open(props: { table?: string | null; readOnly?: boolean; environment?: 'dev' | 'prod' } = {}) {
  const onClose = vi.fn()
  const onChanged = vi.fn()
  render(<StructureEditor connection={connection({ readOnly: props.readOnly ?? false, environment: props.environment ?? 'dev' })} schema="public" table={props.table === undefined ? 'users' : props.table} onClose={onClose} onChanged={onChanged} />)
  return { onClose, onChanged }
}

describe('StructureEditor', () => {
  it('stages a column drop, shows the SQL, and waits for the confirmation before applying', async () => {
    const { onChanged } = open()
    await screen.findByRole('table', { name: 'Columns' })
    fireEvent.click(screen.getByRole('button', { name: 'Drop legacy' }))
    fireEvent.click(screen.getByRole('button', { name: 'Review SQL' }))
    const review = await screen.findByRole('region', { name: 'Review' })
    expect(review).toHaveTextContent('DROP COLUMN "legacy"')
    expect(review).toHaveTextContent('deletes its data for good')
    expect(api.callsOf('sql.structure.preview')[0]).toMatchObject({ schema: 'public', table: 'users', action: { kind: 'alter', changes: [{ op: 'dropColumn', name: 'legacy' }] } })
    const apply = screen.getByRole('button', { name: 'Apply changes' })
    expect(apply).toBeDisabled()
    api.on('sql.structure.apply', { applied: true, statements: [], warnings: [], destructive: true, durationMs: 4 })
    fireEvent.click(within(review).getByRole('checkbox', { name: /cannot be undone/ }))
    expect(apply).toBeEnabled()
    fireEvent.click(apply)
    await waitFor(() => expect(onChanged).toHaveBeenCalledWith({ kind: 'altered', table: 'users' }))
    expect(api.callsOf('sql.structure.apply')[0]).toMatchObject({ confirmed: true })
  })

  it('throws the review away when the draft changes, so what runs is what was shown', async () => {
    open()
    await screen.findByRole('table', { name: 'Columns' })
    fireEvent.click(screen.getByRole('button', { name: 'Drop legacy' }))
    fireEvent.click(screen.getByRole('button', { name: 'Review SQL' }))
    await screen.findByRole('region', { name: 'Review' })
    fireEvent.click(screen.getByRole('button', { name: 'Keep legacy' }))
    expect(screen.queryByRole('region', { name: 'Review' })).toBeNull()
  })

  it('needs no changes to be disabled, names problems in a new table, and creates it', async () => {
    const { onChanged, onClose } = open({ table: null })
    expect(await screen.findByText('Give the table a name.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Review SQL' })).toBeDisabled()
    fireEvent.change(screen.getByLabelText('Table name'), { target: { value: 'orders' } })
    expect(screen.queryByText('Give the table a name.')).toBeNull()
    api.on('sql.structure.preview', { statements: ['CREATE TABLE "public"."orders" (...)'], warnings: [], destructive: false })
    fireEvent.click(screen.getByRole('button', { name: 'Review SQL' }))
    await screen.findByRole('region', { name: 'Review' })
    api.on('sql.structure.apply', { applied: true, statements: [], warnings: [], destructive: false, durationMs: 1 })
    fireEvent.click(screen.getByRole('button', { name: 'Create table' }))
    await waitFor(() => expect(onChanged).toHaveBeenCalledWith({ kind: 'created', table: 'orders' }))
    expect(onClose).toHaveBeenCalled()
    expect(api.callsOf('sql.structure.apply')[0]).toMatchObject({ confirmed: false, action: { kind: 'create' } })
  })

  it('asks for the production confirmation even for a harmless change', async () => {
    open({ table: null, environment: 'prod' })
    await screen.findByText('Give the table a name.')
    fireEvent.change(screen.getByLabelText('Table name'), { target: { value: 'orders' } })
    api.on('sql.structure.preview', { statements: ['CREATE TABLE "public"."orders" (...)'], warnings: [], destructive: false })
    fireEvent.click(screen.getByRole('button', { name: 'Review SQL' }))
    await screen.findByRole('region', { name: 'Review' })
    expect(screen.getByRole('button', { name: 'Create table' })).toBeDisabled()
    fireEvent.click(screen.getByRole('checkbox', { name: /production connection/ }))
    expect(screen.getByRole('button', { name: 'Create table' })).toBeEnabled()
  })

  it('shows what the server refused', async () => {
    open()
    await screen.findByRole('table', { name: 'Columns' })
    fireEvent.click(screen.getByRole('button', { name: 'Drop legacy' }))
    fireEvent.click(screen.getByRole('button', { name: 'Review SQL' }))
    await screen.findByRole('region', { name: 'Review' })
    api.on('sql.structure.apply', () => { throw refusal('query', 'cannot drop column legacy because other objects depend on it') })
    fireEvent.click(within(screen.getByRole('region', { name: 'Review' })).getByRole('checkbox', { name: /cannot be undone/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Apply changes' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('other objects depend on it')
  })

  it('lets a read-only connection look but not change', async () => {
    open({ readOnly: true })
    await screen.findByRole('table', { name: 'Columns' })
    expect(screen.getByText(/read-only/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Drop legacy' }))
    expect(screen.getByRole('button', { name: 'Review SQL' })).toBeDisabled()
  })

  it('shows dependents and privileges on the Table tab', async () => {
    open()
    await screen.findByRole('table', { name: 'Columns' })
    fireEvent.mouseDown(screen.getByRole('tab', { name: 'Table' }), { button: 0 })
    fireEvent.click(screen.getByRole('tab', { name: 'Table' }))
    expect(await screen.findByRole('list', { name: 'Dependents' })).toHaveTextContent('public.active_users')
    expect(screen.getByRole('list', { name: 'Privileges' })).toHaveTextContent('SELECT')
  })
})
