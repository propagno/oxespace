import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SqlWorkbench } from '../src/components/OxeQuery/SqlWorkbench'
import { connection, installFakeOxeQuery, refusal, type FakeOxeQuery } from './helpers/oxequery-api'

// Monaco needs a real browser; the workbench only needs a place to type.
vi.mock('@monaco-editor/react', () => ({
  default: ({ defaultValue, onChange }: { defaultValue?: string; onChange?: (value: string | undefined) => void }) =>
    <textarea aria-label="SQL editor" defaultValue={defaultValue} onChange={event => onChange?.(event.target.value)} />,
  loader: { config: () => undefined }
}))

vi.mock('../src/lib/monacoSetup', () => ({}))

const users = {
  columns: [{ name: 'id', type: 'int4' }, { name: 'name', type: 'text' }],
  rows: [[1, 'alice'], [2, 'bob']], rowCount: 2, truncated: false, durationMs: 3
}

let api: FakeOxeQuery
beforeEach(() => {
  api = installFakeOxeQuery()
  api.on('workspace.load', { state: null })
  api.on('workspace.save', { ok: true })
  api.on('sql.tx', { state: 'none', statements: 0 })
  api.on('sql.schemas', ['public'])
  api.on('sql.tables', { tables: [{ schema: 'public', name: 'users', kind: 'table' }], total: 1 })
  api.on('sql.functions', [])
  api.on('sql.objects', { sequences: [], types: [], triggers: [], truncated: false })
  api.on('sql.extensions', [])
  api.on('sql.run', users)
  api.on('library.list', { saved: [], history: [] })
  api.on('sql.table', { columns: [{ name: 'id', type: 'integer', nullable: false, primaryKey: true, position: 1 }, { name: 'name', type: 'text', nullable: true, primaryKey: false, position: 2 }], indexes: [], foreignKeys: [], constraints: [], dependents: [], privileges: [], properties: null })
  api.on('sql.editability', { editable: false, reason: 'test', columns: [] })
})
afterEach(() => cleanup())

const type = (text: string): void => { fireEvent.change(screen.getByLabelText('SQL editor'), { target: { value: text } }) }
const run = (): void => { fireEvent.click(screen.getAllByRole('button', { name: /^Run/ })[0]!) }

describe('SqlWorkbench', () => {
  it('runs the statement in the editor and shows its rows', async () => {
    render(<SqlWorkbench connection={connection()} />)
    await waitFor(() => expect(api.callsOf('workspace.load')).toHaveLength(1))
    type('SELECT id, name FROM users')
    run()
    expect(await screen.findByRole('gridcell', { name: 'alice' })).toBeInTheDocument()
    expect(api.callsOf('sql.run')[0]).toMatchObject({ sql: 'SELECT id, name FROM users', connectionId: 'c1' })
  })

  it('asks for the value of :name before running, and sends it as a parameter', async () => {
    render(<SqlWorkbench connection={connection()} />)
    await waitFor(() => expect(api.callsOf('workspace.load')).toHaveLength(1))
    type('SELECT * FROM users WHERE id = :id')
    run()
    const form = await screen.findByRole('form', { name: 'Query parameters' })
    expect(api.callsOf('sql.run')).toHaveLength(0)
    fireEvent.change(within(form).getByRole('textbox'), { target: { value: '2' } })
    fireEvent.click(within(form).getByRole('button', { name: 'Run', exact: true }))
    await waitFor(() => expect(api.callsOf('sql.run')).toHaveLength(1))
    expect(api.callsOf('sql.run')[0]).toMatchObject({ sql: 'SELECT * FROM users WHERE id = $1', params: ['2'] })
  })

  it('keeps a transaction the person opened visible until it is ended', async () => {
    render(<SqlWorkbench connection={connection()} />)
    api.on('sql.tx', (input: Record<string, unknown>) => input.action === 'begin' ? { state: 'open', statements: 0, since: Date.now() } : { state: 'none', statements: 0 })
    fireEvent.click(await screen.findByRole('button', { name: 'Begin transaction' }))
    expect(await screen.findByText(/Transaction open/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Commit' }))
    expect(await screen.findByRole('button', { name: 'Begin transaction' })).toBeInTheDocument()
    expect(api.callsOf('sql.tx').map(call => call.action)).toEqual(expect.arrayContaining(['begin', 'commit']))
  })

  it('has nothing to commit on a read-only connection', async () => {
    render(<SqlWorkbench connection={connection({ readOnly: true })} />)
    await waitFor(() => expect(api.callsOf('workspace.load')).toHaveLength(1))
    expect(screen.queryByRole('button', { name: 'Begin transaction' })).toBeNull()
  })

  it('opens a table from the tree, and asks the server to order it by a clicked column', async () => {
    api.on('sql.browse', users)
    render(<SqlWorkbench connection={connection()} />)
    const row = await screen.findByRole('treeitem', { name: 'users' })
    fireEvent.click(row)
    await screen.findByRole('gridcell', { name: 'alice' })
    expect(api.callsOf('sql.browse')[0]).toMatchObject({ schema: 'public', table: 'users', offset: 0 })
    fireEvent.click(screen.getByText('name', { selector: '[role="columnheader"] *, [role="columnheader"]' }))
    await waitFor(() => expect(api.callsOf('sql.browse').at(-1)).toMatchObject({ orderBy: { column: 'name', direction: 'asc' }, offset: 0 }))
  })

  it('shows the error with its code, and a reconnect bar when the connection dropped', async () => {
    render(<SqlWorkbench connection={connection()} />)
    await waitFor(() => expect(api.callsOf('workspace.load')).toHaveLength(1))
    api.on('sql.run', () => { throw Object.assign(new Error('x'), refusal('query', 'Connection terminated unexpectedly')) })
    type('SELECT 1')
    run()
    expect(await screen.findByText(/Connection terminated unexpectedly/)).toBeInTheDocument()
    expect(screen.getByRole('group', { name: 'Connection lost' })).toBeInTheDocument()
  })

  it('asks before a destructive statement and runs it only when confirmed', async () => {
    render(<SqlWorkbench connection={connection()} />)
    await waitFor(() => expect(api.callsOf('workspace.load')).toHaveLength(1))
    api.on('sql.run', (input: Record<string, unknown>) => {
      if (input.confirmed !== true) throw refusal('confirm', 'This statement is destructive and needs confirmation.', ['DROP TABLE removes the table and its data.'])
      return { columns: [], rows: [], rowCount: 0, truncated: false, durationMs: 1, command: 'DROP TABLE' }
    })
    type('DROP TABLE users')
    run()
    const confirm = await screen.findByRole('alertdialog', { name: 'Confirm statement' })
    expect(confirm).toHaveTextContent('DROP TABLE removes the table')
    fireEvent.click(within(confirm).getByRole('button', { name: 'Run anyway' }))
    await waitFor(() => expect(api.callsOf('sql.run').at(-1)).toMatchObject({ confirmed: true }))
  })

  it('saves its tabs when it goes away, so they come back', async () => {
    const { unmount } = render(<SqlWorkbench connection={connection()} />)
    await waitFor(() => expect(api.callsOf('workspace.load')).toHaveLength(1))
    type('SELECT remembered')
    await waitFor(() => expect(screen.getByLabelText('SQL editor')).toHaveValue('SELECT remembered'))
    unmount()
    await waitFor(() => expect(api.callsOf('workspace.save').length).toBeGreaterThan(0))
    expect(JSON.stringify(api.callsOf('workspace.save').at(-1))).toContain('SELECT remembered')
  })
})
