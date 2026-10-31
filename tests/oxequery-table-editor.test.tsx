import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TableEditor } from '../src/components/OxeQuery/TableEditor'
import type { SqlResult } from '../shared/types/oxequery'
import { connection, installFakeOxeQuery, refusal, type FakeOxeQuery } from './helpers/oxequery-api'

const result: SqlResult = { columns: [{ name: 'id', type: 'int4' }, { name: 'email', type: 'text' }], rows: [[1, 'a@example.com'], [2, null]], rowCount: 2, truncated: false, durationMs: 2 }
const editable = { editable: true, columns: [
  { name: 'id', type: 'integer', nullable: false, hasDefault: true, generated: false, key: true },
  { name: 'email', type: 'text', nullable: true, hasDefault: false, generated: false, key: false }
] }

let api: FakeOxeQuery
beforeEach(() => { api = installFakeOxeQuery(); api.on('sql.editability', editable) })
afterEach(() => cleanup())

function mount(props: { selectedRow?: number | null; environment?: 'dev' | 'prod'; readOnly?: boolean } = {}) {
  const onApplied = vi.fn()
  const onClearSelection = vi.fn()
  const element = (selected: number | null) => <TableEditor connection={connection({ environment: props.environment ?? 'dev', readOnly: props.readOnly ?? false })} schema="public" table="users"
    result={result} selectedRow={selected} onClearSelection={onClearSelection} onApplied={onApplied} />
  const view = render(element(props.selectedRow ?? null))
  return { onApplied, onClearSelection, select: (row: number | null) => view.rerender(element(row)) }
}

async function startEditing() {
  fireEvent.click(await screen.findByRole('button', { name: 'Edit rows' }))
}

describe('TableEditor', () => {
  it('stages an update with the old value, shows the SQL, and applies it', async () => {
    const { select, onApplied } = mount()
    await startEditing()
    select(0)
    const form = await screen.findByRole('group', { name: 'Edit row' })
    fireEvent.change(within(form).getByLabelText(/^email/), { target: { value: 'changed@example.com' } })
    fireEvent.click(within(form).getByRole('button', { name: 'Stage update' }))
    expect(await screen.findByRole('list', { name: 'Pending changes' })).toHaveTextContent('Update email where id = 1')
    api.on('sql.previewChanges', { statements: ['UPDATE "public"."users" SET "email" = \'changed@example.com\' WHERE "id" = 1;'] })
    fireEvent.click(screen.getByRole('button', { name: 'View SQL' }))
    expect(await screen.findByLabelText('SQL that will run')).toHaveTextContent('UPDATE "public"."users"')
    api.on('sql.apply', { applied: 1, statements: [] })
    fireEvent.click(screen.getByRole('button', { name: 'Apply 1' }))
    await waitFor(() => expect(onApplied).toHaveBeenCalled())
    expect(api.callsOf('sql.apply')[0]).toMatchObject({ changes: [{ kind: 'update', key: { id: 1 }, set: { email: 'changed@example.com' }, old: { email: 'a@example.com' } }], confirmed: false })
  })

  it('says so when nothing changed, and never sends a statement', async () => {
    const { select } = mount()
    await startEditing()
    select(0)
    fireEvent.click(within(await screen.findByRole('group', { name: 'Edit row' })).getByRole('button', { name: 'Stage update' }))
    expect(await screen.findByText('Nothing changed in this row.')).toBeInTheDocument()
    expect(api.callsOf('sql.apply')).toHaveLength(0)
  })

  it('sets a value to NULL on purpose, and keeps the key column locked', async () => {
    const { select } = mount()
    await startEditing()
    select(0)
    const form = await screen.findByRole('group', { name: 'Edit row' })
    expect(within(form).getByLabelText(/^id/)).toBeDisabled()
    fireEvent.click(within(form).getByRole('button', { name: 'NULL' }))
    fireEvent.click(within(form).getByRole('button', { name: 'Stage update' }))
    await screen.findByRole('list', { name: 'Pending changes' })
    api.on('sql.apply', { applied: 1, statements: [] })
    fireEvent.click(screen.getByRole('button', { name: 'Apply 1' }))
    await waitFor(() => expect(api.callsOf('sql.apply')).toHaveLength(1))
    expect(api.callsOf('sql.apply')[0]).toMatchObject({ changes: [{ set: { email: null } }] })
  })

  it('asks for confirmation when the server asks, and applies only after it', async () => {
    const { select } = mount({ environment: 'prod' })
    await startEditing()
    select(1)
    fireEvent.click(within(await screen.findByRole('group', { name: 'Edit row' })).getByRole('button', { name: 'Stage delete' }))
    await screen.findByRole('list', { name: 'Pending changes' })
    api.on('sql.apply', (input: Record<string, unknown>) => {
      if (input.confirmed !== true) throw refusal('confirm', 'These changes need your confirmation.', ['This is a production connection.', '1 row will be deleted.'])
      return { applied: 1, statements: [] }
    })
    fireEvent.click(screen.getByRole('button', { name: 'Apply 1' }))
    const confirm = await screen.findByRole('dialog', { name: 'Confirm these changes' })
    expect(confirm).toHaveTextContent('1 row will be deleted.')
    fireEvent.click(within(confirm).getByRole('button', { name: 'Apply changes' }))
    await waitFor(() => expect(api.callsOf('sql.apply').at(-1)).toMatchObject({ confirmed: true }))
  })

  it('tells the person a row changed under them, and keeps their edit staged', async () => {
    const { select, onApplied } = mount()
    await startEditing()
    select(0)
    const form = await screen.findByRole('group', { name: 'Edit row' })
    fireEvent.change(within(form).getByLabelText(/^email/), { target: { value: 'x@example.com' } })
    fireEvent.click(within(form).getByRole('button', { name: 'Stage update' }))
    await screen.findByRole('list', { name: 'Pending changes' })
    api.on('sql.apply', () => { throw refusal('conflict', 'Change 1 matched 0 rows instead of 1.') })
    fireEvent.click(screen.getByRole('button', { name: 'Apply 1' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Reload the table to see the current values.')
    expect(onApplied).not.toHaveBeenCalled()
    expect(screen.getByRole('list', { name: 'Pending changes' })).toBeInTheDocument()
  })

  it('stages a new row without the columns left empty', async () => {
    mount()
    await startEditing()
    fireEvent.click(screen.getByRole('button', { name: 'Add row' }))
    const form = await screen.findByRole('group', { name: 'New row' })
    fireEvent.change(within(form).getByLabelText(/^email/), { target: { value: 'new@example.com' } })
    fireEvent.click(within(form).getByRole('button', { name: 'Stage insert' }))
    expect(await screen.findByRole('list', { name: 'Pending changes' })).toHaveTextContent('Insert a row (email)')
  })

  it('explains why a table cannot be edited instead of hiding the button', async () => {
    api.on('sql.editability', { editable: false, reason: 'This table has no primary key or unique index, so a row cannot be told apart.', columns: [] })
    mount()
    const button = await screen.findByRole('button', { name: 'Edit rows' })
    expect(button).toBeDisabled()
    expect(screen.getByText(/no primary key/)).toBeInTheDocument()
  })

  it('does not let a read-only connection edit', async () => {
    mount({ readOnly: true })
    expect(await screen.findByRole('button', { name: 'Edit rows' })).toBeDisabled()
    expect(screen.getByText(/read-only/)).toBeInTheDocument()
  })
})
