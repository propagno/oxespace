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

  it('asks before a destructive statement the server flags, and runs it only when confirmed', async () => {
    render(<SqlWorkbench connection={connection()} />)
    await waitFor(() => expect(api.callsOf('workspace.load')).toHaveLength(1))
    api.on('sql.run', (input: Record<string, unknown>) => {
      if (input.confirmed !== true) throw refusal('confirm', 'This statement is destructive and needs confirmation.', ['DELETE inside WITH has no WHERE clause.'])
      return { columns: [], rows: [], rowCount: 0, truncated: false, durationMs: 1, command: 'DELETE' }
    })
    type('WITH gone AS (SELECT 1) DELETE FROM users')
    run()
    const confirm = await screen.findByRole('dialog', { name: 'This statement is destructive' })
    expect(confirm).toHaveTextContent('DELETE inside WITH has no WHERE clause')
    fireEvent.click(within(confirm).getByRole('button', { name: 'Run anyway' }))
    await waitFor(() => expect(api.callsOf('sql.run').at(-1)).toMatchObject({ confirmed: true }))
  })

  it('asks about a statement the lint marks as destructive before it reaches the server', async () => {
    render(<SqlWorkbench connection={connection()} />)
    await waitFor(() => expect(api.callsOf('workspace.load')).toHaveLength(1))
    type('DROP TABLE users')
    run()
    const confirm = await screen.findByRole('dialog', { name: 'This statement is destructive' })
    expect(confirm).toHaveTextContent('DROP TABLE permanently removes the object')
    expect(api.callsOf('sql.run')).toHaveLength(0)
    expect(within(confirm).queryByLabelText(/^Type /)).toBeNull()
    fireEvent.click(within(confirm).getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(api.callsOf('sql.run')).toHaveLength(0)
    run()
    fireEvent.click(within(await screen.findByRole('dialog', { name: 'This statement is destructive' })).getByRole('button', { name: 'Run anyway' }))
    await waitFor(() => expect(api.callsOf('sql.run').at(-1)).toMatchObject({ sql: 'DROP TABLE users', confirmed: true }))
  })

  it('does not interrupt a read, a safe write or a statement with a WHERE', async () => {
    render(<SqlWorkbench connection={connection()} />)
    await waitFor(() => expect(api.callsOf('workspace.load')).toHaveLength(1))
    for (const [index, sql] of ['SELECT * FROM users', "UPDATE users SET name = 'x' WHERE id = 1", 'DELETE FROM users WHERE id = 2'].entries()) {
      type(sql)
      run()
      await waitFor(() => expect(api.callsOf('sql.run')).toHaveLength(index + 1))
      expect(screen.queryByRole('dialog')).toBeNull()
    }
  })

  describe('production', () => {
    const production = { id: 'p1', name: 'shop-prod', environment: 'prod' as const }
    beforeEach(() => {
      api.on('safety.get', { readOnly: false, readOnlyBy: null, typedConfirmation: true, maxRows: 500, maxRowsCeiling: 1000, statementTimeoutMs: 30_000 })
    })

    it('asks for the connection name before a write, and sends it with the run', async () => {
      render(<SqlWorkbench connection={connection(production)} />)
      await waitFor(() => expect(api.callsOf('workspace.load')).toHaveLength(1))
      api.on('sql.run', (input: Record<string, unknown>) => {
        if (input.confirmName !== 'shop-prod') throw refusal('confirm-name', 'This is a production connection. Type its name to run a statement that changes data.')
        return { columns: [], rows: [], rowCount: 0, truncated: false, durationMs: 1, command: 'UPDATE', affectedRows: 1 }
      })
      type("UPDATE users SET name = 'x' WHERE id = 1")
      run()
      const confirm = await screen.findByRole('dialog', { name: 'Change data on production?' })
      const go = within(confirm).getByRole('button', { name: 'Run on production' })
      expect(go).toBeDisabled()
      const field = within(confirm).getByLabelText('Type shop-prod to continue')
      fireEvent.change(field, { target: { value: 'shop-pro' } })
      expect(go).toBeDisabled()
      fireEvent.change(field, { target: { value: 'Shop-Prod' } })
      expect(go).toBeDisabled()
      fireEvent.change(field, { target: { value: ' shop-prod ' } })
      expect(go).toBeEnabled()
      fireEvent.click(go)
      await waitFor(() => expect(api.callsOf('sql.run').at(-1)).toMatchObject({ confirmed: true, confirmName: 'shop-prod' }))
      expect((await screen.findAllByText(/1 row affected/)).length).toBeGreaterThan(0)
      expect(screen.queryByRole('dialog')).toBeNull()
    })

    it('does not run when the dialog is cancelled, and does not carry a typed name into the next one', async () => {
      render(<SqlWorkbench connection={connection(production)} />)
      await waitFor(() => expect(api.callsOf('workspace.load')).toHaveLength(1))
      api.on('sql.run', () => { throw refusal('confirm-name', 'Type its name.') })
      type("UPDATE users SET name = 'x' WHERE id = 1")
      run()
      let confirm = await screen.findByRole('dialog', { name: 'Change data on production?' })
      fireEvent.change(within(confirm).getByLabelText('Type shop-prod to continue'), { target: { value: 'shop-prod' } })
      fireEvent.click(within(confirm).getByRole('button', { name: 'Cancel' }))
      expect(screen.queryByRole('dialog')).toBeNull()
      run()
      confirm = await screen.findByRole('dialog', { name: 'Change data on production?' })
      expect(within(confirm).getByLabelText('Type shop-prod to continue')).toHaveValue('')
      expect(within(confirm).getByRole('button', { name: 'Run on production' })).toBeDisabled()
    })

    it('puts the name in the same dialog as the destructive warning', async () => {
      render(<SqlWorkbench connection={connection(production)} />)
      await waitFor(() => expect(api.callsOf('workspace.load')).toHaveLength(1))
      type('DELETE FROM users')
      run()
      const confirm = await screen.findByRole('dialog', { name: 'This statement is destructive' })
      expect(confirm).toHaveTextContent('DELETE without WHERE')
      expect(within(confirm).getByRole('button', { name: 'Run on production' })).toBeDisabled()
      expect(api.callsOf('sql.run')).toHaveLength(0)
      fireEvent.change(within(confirm).getByLabelText('Type shop-prod to continue'), { target: { value: 'shop-prod' } })
      fireEvent.click(within(confirm).getByRole('button', { name: 'Run on production' }))
      await waitFor(() => expect(api.callsOf('sql.run').at(-1)).toMatchObject({ sql: 'DELETE FROM users', confirmed: true, confirmName: 'shop-prod' }))
      expect(api.callsOf('sql.run')).toHaveLength(1)
    })

    it('does not ask for the name to read', async () => {
      render(<SqlWorkbench connection={connection(production)} />)
      await waitFor(() => expect(api.callsOf('workspace.load')).toHaveLength(1))
      type('SELECT id FROM users LIMIT 10')
      run()
      expect(await screen.findByRole('gridcell', { name: 'alice' })).toBeInTheDocument()
      expect(screen.queryByRole('dialog')).toBeNull()
      expect(api.callsOf('sql.run')[0]).not.toHaveProperty('confirmName')
    })

    it('asks for the name before an ANALYZE of a write, and sends it', async () => {
      render(<SqlWorkbench connection={connection(production)} />)
      await waitFor(() => expect(api.callsOf('workspace.load')).toHaveLength(1))
      api.on('sql.explain', (input: Record<string, unknown>) => {
        if (input.confirmName !== 'shop-prod') throw refusal('confirm-name', 'Type its name.', ['ANALYZE runs the statement.'])
        return { analyze: true, plan: { nodeType: 'Update', startupCost: 0, totalCost: 1, planRows: 1, selfCostShare: 1, children: [] }, nodeCount: 1, hints: [] }
      })
      type("UPDATE users SET name = 'x' WHERE id = 1")
      fireEvent.click(screen.getByRole('button', { name: 'Analyze' }))
      const confirm = await screen.findByRole('dialog', { name: 'Analyze runs this statement' })
      fireEvent.change(within(confirm).getByLabelText('Type shop-prod to continue'), { target: { value: 'shop-prod' } })
      fireEvent.click(within(confirm).getByRole('button', { name: 'Analyze anyway' }))
      await waitFor(() => expect(api.callsOf('sql.explain').at(-1)).toMatchObject({ analyze: true, confirmed: true, confirmName: 'shop-prod' }))
    })

    it('shows the statement time and offers no more rows than the connection may read', async () => {
      render(<SqlWorkbench connection={connection({ ...production, maxRows: 5000 })} />)
      await waitFor(() => expect(api.callsOf('safety.get')).toHaveLength(1))
      expect(await screen.findByText('30 s')).toBeInTheDocument()
      const limit = screen.getByLabelText('Limit')
      const offered = within(limit).getAllByRole('option').map(option => option.textContent)
      expect(offered).toEqual(['100 rows', '500 rows', '1,000 rows'])
    })
  })

  it('shows a connection that policy keeps read-only, and does not offer a transaction', async () => {
    api.on('safety.get', { readOnly: true, readOnlyBy: 'policy', typedConfirmation: false, maxRows: 500, maxRowsCeiling: 100_000, statementTimeoutMs: 60_000 })
    render(<SqlWorkbench connection={connection()} />)
    const badge = await screen.findByText('read-only by policy')
    expect(badge).toHaveAttribute('title', expect.stringContaining('policy'))
    expect(screen.queryByRole('group', { name: 'Transaction' })).toBeNull()
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
