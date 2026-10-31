import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ImportPreview, ImportResult, OxeQueryEvent } from '../shared/types/oxequery'
import { ImportButton } from '../src/components/OxeQuery/ImportDialog'
import { connection, installFakeOxeQuery, refusal, type FakeOxeQuery } from './helpers/oxequery-api'

const preview: ImportPreview = {
  importId: 'imp1', fileName: 'users.csv', format: 'csv', bytes: 2048, fields: ['id', 'Email', 'note'], sample: [['1', 'a@example.com', 'x'], ['2', 'b@example.com', '']],
  targetColumns: [
    { name: 'id', type: 'integer', nullable: false, hasDefault: true, generated: false },
    { name: 'email', type: 'text', nullable: false, hasDefault: false, generated: false },
    { name: 'created', type: 'timestamptz', nullable: true, hasDefault: true, generated: true }
  ],
  mapping: { id: 'id', Email: 'email', note: '' }, options: { delimiter: 'auto', hasHeader: true, encoding: 'auto' }, detected: { delimiter: ';', encoding: 'utf-8' }
}
const done = (change: Partial<ImportResult> = {}): ImportResult => ({ dryRun: false, inserted: 2, rejected: 0, rejects: [], durationMs: 5, ...change })
const table = { kind: 'table', schema: 'public', table: 'users' } as const

let api: FakeOxeQuery
let listeners: ((event: OxeQueryEvent) => void)[]
beforeEach(() => {
  api = installFakeOxeQuery()
  listeners = []
  const oxe = (window as unknown as { oxe: { oxeQuery: { onEvent: (listener: (event: OxeQueryEvent) => void) => () => void } } }).oxe
  oxe.oxeQuery.onEvent = listener => { listeners.push(listener); return () => { listeners = listeners.filter(item => item !== listener) } }
  api.on('import.preview', preview)
})
afterEach(() => cleanup())

async function openDialog(target: Parameters<typeof ImportButton>[0]['target'] = table, onImported = vi.fn()): Promise<{ dialog: HTMLElement; onImported: ReturnType<typeof vi.fn> }> {
  render(<ImportButton connection={connection()} target={target} onImported={onImported} />)
  fireEvent.click(screen.getByRole('button', { name: 'Import' }))
  return { dialog: await screen.findByRole('dialog', { name: /^Import into / }), onImported }
}

describe('ImportButton', () => {
  it('is not offered on a read-only connection', () => {
    render(<ImportButton connection={connection({ readOnly: true })} target={table} onImported={() => undefined} />)
    expect(screen.queryByRole('button', { name: 'Import' })).toBeNull()
  })

  it('stays quiet when the file chooser is dismissed, and shows a failure otherwise', async () => {
    api.on('import.preview', { dismissed: true })
    render(<ImportButton connection={connection()} target={table} onImported={() => undefined} />)
    fireEvent.click(screen.getByRole('button', { name: 'Import' }))
    await waitFor(() => expect(api.callsOf('import.preview')).toHaveLength(1))
    expect(screen.queryByRole('dialog')).toBeNull()
    api.on('import.preview', () => { throw refusal('failed', 'The file is empty.') })
    fireEvent.click(screen.getByRole('button', { name: 'Import' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('The file is empty.')
  })

  it('shows the file, the suggested mapping, and skips generated columns', async () => {
    const { dialog } = await openDialog()
    expect(dialog).toHaveTextContent('users.csv · CSV · 2.0 KB')
    expect(within(dialog).getByLabelText('Column for Email')).toHaveValue('email')
    expect(within(dialog).getByLabelText('Column for note')).toHaveValue('')
    expect(within(within(dialog).getByLabelText('Column for id')).queryByRole('option', { name: /created/ })).toBeNull()
    expect(within(dialog).getByRole('option', { name: 'Detect (;)' })).toBeInTheDocument()
  })

  it('reads the file another way when the delimiter, encoding or header changes', async () => {
    api.on('import.reparse', { fields: ['id', 'Email'], sample: [['1', 'a']], detected: { delimiter: ',', encoding: 'windows-1252' }, mapping: { id: 'id', Email: 'email' } })
    const { dialog } = await openDialog()
    fireEvent.change(within(dialog).getByLabelText('Delimiter'), { target: { value: ',' } })
    await waitFor(() => expect(api.callsOf('import.reparse')).toHaveLength(1))
    fireEvent.change(within(dialog).getByLabelText('Encoding'), { target: { value: 'windows-1252' } })
    fireEvent.click(within(dialog).getByLabelText('First row is a header'))
    await waitFor(() => expect(api.callsOf('import.reparse')).toHaveLength(3))
    expect(api.callsOf('import.reparse')[2]).toMatchObject({ importId: 'imp1', options: { delimiter: ',', encoding: 'windows-1252', hasHeader: false } })
  })

  it('runs a dry run first and says nothing was written', async () => {
    api.on('import.run', done({ dryRun: true, inserted: 2, rejected: 1, rejects: [{ row: 3, reason: 'null value in column "email"' }], rejectsPath: 'C:\\data\\users.rejects.csv' }))
    const { dialog, onImported } = await openDialog()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Dry run' }))
    const status = await within(dialog).findByText(/Dry run: 2 rows would be imported, 1 rejected/)
    expect(status).toHaveTextContent('Nothing was written.')
    expect(dialog).toHaveTextContent('Row 3: null value in column "email"')
    expect(dialog).toHaveTextContent('Rejected rows saved to users.rejects.csv.')
    expect(api.callsOf('import.run')[0]).toMatchObject({ dryRun: true, mapping: { id: 'id', Email: 'email' }, emptyAsNull: true })
    expect(onImported).not.toHaveBeenCalled()
  })

  it('imports for real, reports counts and tells the caller to reload', async () => {
    api.on('import.run', done({ inserted: 1, updated: 2, skipped: 3, rejected: 0 }))
    const { dialog, onImported } = await openDialog()
    fireEvent.change(within(dialog).getByLabelText('When a key exists'), { target: { value: 'update' } })
    const keys = within(dialog).getByRole('group', { name: 'Key columns' })
    fireEvent.click(within(keys).getByLabelText('id'))
    fireEvent.click(within(dialog).getByLabelText(/Empty values become NULL/))
    fireEvent.click(within(dialog).getByRole('button', { name: 'Import' }))
    expect(await within(dialog).findByText(/Imported 1 row, updated 2, skipped 3 that already existed; 0 rejected/)).toBeInTheDocument()
    await waitFor(() => expect(onImported).toHaveBeenCalled())
    expect(api.callsOf('import.run')[0]).toMatchObject({ dryRun: false, emptyAsNull: false, conflict: { mode: 'update', columns: ['id'] } })
  })

  it('does not tell the caller to reload when the import was cancelled', async () => {
    api.on('import.run', done({ cancelled: true, inserted: 0 }))
    const { dialog, onImported } = await openDialog()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Import' }))
    expect(await within(dialog).findByText('Cancelled. Nothing was imported.')).toBeInTheDocument()
    expect(onImported).not.toHaveBeenCalled()
  })

  it('asks for confirmation when the server wants one, then repeats with confirmed', async () => {
    api.on('import.run', (input: Record<string, unknown>) => {
      if (!input.confirmed) throw refusal('confirm', 'Confirm.', ['The table is in a production database.'])
      return done()
    })
    const { dialog } = await openDialog()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Import' }))
    const confirm = await screen.findByRole('dialog', { name: 'Confirm this import' })
    expect(confirm).toHaveTextContent('The table is in a production database.')
    fireEvent.click(within(confirm).getByRole('button', { name: 'Import anyway' }))
    await waitFor(() => expect(api.callsOf('import.run').map(call => call.confirmed)).toEqual([false, true]))
  })

  it('shows progress and can cancel while it runs', async () => {
    let finish: (value: ImportResult) => void = () => undefined
    api.on('import.run', () => new Promise<ImportResult>(resolve => { finish = resolve }))
    api.on('import.cancel', {})
    const { dialog } = await openDialog()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Dry run' }))
    await waitFor(() => expect(api.callsOf('import.run')).toHaveLength(1))
    act(() => { for (const listener of listeners) listener({ type: 'import-progress', importId: 'imp1', rows: 1500 } as OxeQueryEvent) })
    expect(await within(dialog).findByRole('status')).toHaveTextContent(/1[.,]500 rows/)
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(api.callsOf('import.cancel')).toEqual([{ importId: 'imp1' }]))
    void finish
  })

  it('shows a run failure inside the dialog', async () => {
    api.on('import.run', () => { throw refusal('failed', 'duplicate key value violates unique constraint') })
    const { dialog } = await openDialog()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Import' }))
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('duplicate key value')
  })

  it('maps fields by name for a collection and hides the table-only options', async () => {
    api.on('import.preview', { ...preview, format: 'ndjson', targetColumns: [], mapping: { id: 'id', Email: 'email', note: '' } })
    const { dialog } = await openDialog({ kind: 'collection', database: 'shop', collection: 'users' })
    expect(dialog.getAttribute('aria-label') ?? dialog.textContent).toContain('shop.users')
    expect(within(dialog).getByLabelText('Field name for Email')).toHaveValue('email')
    fireEvent.change(within(dialog).getByLabelText('Field name for note'), { target: { value: 'memo' } })
    expect(within(dialog).queryByLabelText('When a key exists')).toBeNull()
    expect(within(dialog).queryByLabelText('Delimiter')).toBeNull()
    api.on('import.run', done())
    fireEvent.click(within(dialog).getByRole('button', { name: 'Import' }))
    await waitFor(() => expect(api.callsOf('import.run')).toHaveLength(1))
    expect(api.callsOf('import.run')[0]).toMatchObject({ mapping: { id: 'id', Email: 'email', note: 'memo' } })
    expect(api.callsOf('import.run')[0]).not.toHaveProperty('conflict')
  })

  it('closes with the Close button', async () => {
    const { dialog } = await openDialog()
    fireEvent.click(within(dialog).getAllByRole('button', { name: 'Close' }).at(-1)!)
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })
})
