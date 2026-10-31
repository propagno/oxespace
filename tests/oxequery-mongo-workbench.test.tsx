import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { MongoWorkbench } from '../src/components/OxeQuery/MongoWorkbench'
import { connection, installFakeOxeQuery, refusal, type FakeOxeQuery } from './helpers/oxequery-api'

const documents = [
  JSON.stringify({ _id: { $oid: '507f1f77bcf86cd799439011' }, sku: 'sku-1', qty: 5, tags: ['a', 'b'], meta: { color: 'red' } }),
  JSON.stringify({ _id: { $oid: '507f1f77bcf86cd799439012' }, sku: 'sku-2', qty: { $numberLong: '9' } })
]

let api: FakeOxeQuery
beforeEach(() => {
  api = installFakeOxeQuery()
  api.on('mongo.databases', [{ name: 'shop' }])
  api.on('mongo.collections', [{ name: 'items', type: 'collection' }])
  api.on('mongo.find', { documents, truncated: true, durationMs: 3, total: 120 })
  api.on('mongo.aggregate', { documents: [JSON.stringify({ _id: 'x', n: 1 })], truncated: false, durationMs: 2 })
  api.on('mongo.indexes', [{ name: '_id_', keys: '{"_id":1}', unique: true }])
  api.on('mongo.stats', { documents: 120, sizeBytes: 48000, avgDocumentBytes: 400, storageBytes: 65536, indexes: 1, indexBytes: 4096, capped: false })
  api.on('mongo.validation', { validator: null, level: 'strict', action: 'error' })
})
afterEach(() => cleanup())

async function openItems(readOnly = false) {
  render(<MongoWorkbench connection={connection({ engine: 'mongodb', readOnly })} />)
  fireEvent.click(await screen.findByRole('button', { name: 'shop' }))
  fireEvent.click(await screen.findByRole('button', { name: 'items' }))
  await screen.findByText('_id: 507f1f77bcf86cd799439011')
}

describe('MongoWorkbench', () => {
  it('lists documents, pages with skip and keeps the page size the person chose', async () => {
    await openItems()
    expect(screen.getByText(/2 documents of 120 \(more available\)/)).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Documents per page'), { target: { value: '25' } })
    fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    await waitFor(() => expect(api.callsOf('mongo.find').at(-1)).toMatchObject({ limit: 25, skip: 25 }))
    expect(screen.getByRole('button', { name: 'Previous' })).toBeEnabled()
  })

  it('stops a field that is not JSON before it reaches the server, and says which one', async () => {
    await openItems()
    const calls = api.callsOf('mongo.find').length
    fireEvent.change(screen.getByLabelText('Filter'), { target: { value: '{"qty":' } })
    expect(screen.getAllByRole('alert').some(node => /Not valid JSON/.test(node.textContent ?? ''))).toBe(true)
    const run = screen.getAllByRole('button', { name: /^Run/ })[0]!
    expect(run).toBeDisabled()
    fireEvent.change(screen.getByLabelText('Sort'), { target: { value: '[1]' } })
    expect(screen.getByText('Expected a JSON object.')).toBeInTheDocument()
    expect(api.callsOf('mongo.find')).toHaveLength(calls)
  })

  it('shows the plan in words and a warning for a collection scan', async () => {
    await openItems()
    api.on('mongo.explain', { stage: 'COLLSCAN', docsExamined: 120, returned: 2, stages: ['COLLSCAN'], warnings: ['The whole collection is read: no index serves this query.'], raw: '{}' })
    fireEvent.click(screen.getByRole('button', { name: 'Explain' }))
    const plan = await screen.findByRole('region', { name: 'Query plan' })
    expect(plan).toHaveTextContent('COLLSCAN')
    expect(plan).toHaveTextContent('no index serves this query')
    expect(api.callsOf('mongo.explain')[0]).toMatchObject({ kind: 'find', database: 'shop', collection: 'items', verbosity: 'executionStats' })
  })

  it('shows a tree with typed values, and clones a document without its _id', async () => {
    await openItems()
    fireEvent.click(screen.getByRole('radio', { name: 'Tree' }))
    const trees = screen.getAllByRole('tree', { name: 'Document' })
    expect(trees[0]).toHaveTextContent('sku-1')
    expect(trees[0]).toHaveTextContent('{5}')
    expect(trees[1]).toHaveTextContent('Long(9)')
    fireEvent.click(screen.getAllByRole('button', { name: 'Clone document' })[0]!)
    const form = screen.getByRole('dialog', { name: 'New document' })
    const text = (within(form).getByRole('textbox') as HTMLTextAreaElement).value
    expect(JSON.parse(text)).toMatchObject({ sku: 'sku-1', qty: 5 })
    expect(JSON.parse(text)._id).toBeUndefined()
  })

  it('counts before it changes many, then applies for exactly that count', async () => {
    await openItems()
    fireEvent.click(screen.getByRole('button', { name: 'Change many…' }))
    const dialog = await screen.findByRole('dialog', { name: /Change many/ })
    api.on('mongo.bulk', (input: Record<string, unknown>) => ({ matched: 7, modified: input.dryRun ? 0 : 7, deleted: 0, dryRun: input.dryRun === true }))
    expect(within(dialog).getByRole('button', { name: 'Update documents' })).toBeDisabled()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Count matches' }))
    expect(await within(dialog).findByText('7 documents match')).toBeInTheDocument()
    fireEvent.click(within(dialog).getByRole('checkbox', { name: /7 documents will be changed/ }))
    fireEvent.click(within(dialog).getByRole('button', { name: 'Update documents' }))
    await waitFor(() => expect(api.callsOf('mongo.bulk')).toHaveLength(2))
    expect(api.callsOf('mongo.bulk')[1]).toMatchObject({ op: 'updateMany', confirmed: true, expectedCount: 7 })
    expect(await within(dialog).findByText(/7 matched, 7 changed/)).toBeInTheDocument()
  })

  it('goes back to counting when the server says the number moved', async () => {
    await openItems()
    fireEvent.click(screen.getByRole('button', { name: 'Change many…' }))
    const dialog = await screen.findByRole('dialog', { name: /Change many/ })
    api.on('mongo.bulk', (input: Record<string, unknown>) => {
      if (input.dryRun) return { matched: 7, modified: 0, deleted: 0, dryRun: true }
      throw refusal('conflict', '9 documents match now, not the 7 you confirmed. Count again and confirm.')
    })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Count matches' }))
    fireEvent.click(await within(dialog).findByRole('checkbox', { name: /7 documents will be changed/ }))
    fireEvent.click(within(dialog).getByRole('button', { name: 'Update documents' }))
    expect(await within(dialog).findByText(/9 documents match now/)).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: 'Update documents' })).toBeDisabled()
  })

  it('shows the operation, its filter and the document in the write confirmation', async () => {
    await openItems()
    api.on('mongo.write', (input: Record<string, unknown>) => { if (input.confirmed !== true) throw refusal('confirm', 'This is a production connection.', ['Deletes a document on production.']); return { ok: true } })
    fireEvent.click(screen.getAllByRole('button', { name: 'Delete document' })[0]!)
    const form = await screen.findByRole('dialog', { name: 'Delete this document?' })
    fireEvent.click(within(form).getByRole('button', { name: 'Delete' }))
    const confirm = await screen.findByRole('dialog', { name: 'Confirm this change' })
    expect(confirm).toHaveTextContent('Deletes a document on production.')
    expect(within(confirm).getByTestId('oxequery-confirm-mongo-operation')).toHaveTextContent('db.items.deleteOne() · shop')
    expect(within(confirm).getByTestId('oxequery-confirm-mongo-filter')).toHaveTextContent('507f1f77bcf86cd799439011')
    expect(within(confirm).getByTestId('oxequery-confirm-mongo-filter')).not.toHaveTextContent('sku-1')
    expect(within(confirm).queryByTestId('oxequery-confirm-mongo-document')).toBeNull()
    fireEvent.click(within(confirm).getByRole('button', { name: 'Confirm' }))
    await waitFor(() => expect(api.callsOf('mongo.write').at(-1)).toMatchObject({ op: 'delete', confirmed: true }))
  })

  it('asks for the connection name on production, shows the reasons from their codes, and sends the name to main (B15)', async () => {
    render(<MongoWorkbench connection={connection({ engine: 'mongodb', environment: 'prod', name: 'Shop prod' })} />)
    fireEvent.click(await screen.findByRole('button', { name: 'shop' }))
    fireEvent.click(await screen.findByRole('button', { name: 'items' }))
    await screen.findByText('_id: 507f1f77bcf86cd799439011')
    api.on('mongo.write', (input: Record<string, unknown>) => {
      if (input.confirmName !== 'Shop prod') throw { ...refusal('confirm-name', 'Type its name.', ['English for logs']), codes: [{ code: 'oxequery.mongo.production', params: {} }] }
      return { matched: 1, modified: 1, deleted: 0 }
    })
    fireEvent.click(screen.getAllByRole('button', { name: 'Edit document' })[0]!)
    fireEvent.click(within(await screen.findByRole('dialog', { name: 'Edit document' })).getByRole('button', { name: 'Save' }))
    const confirm = await screen.findByRole('dialog', { name: 'Confirm this change' })
    expect(within(confirm).getAllByRole('listitem').map(item => item.textContent)).toEqual(['This is a production connection.'])
    const go = within(confirm).getByRole('button', { name: 'Confirm' })
    expect(go).toBeDisabled()
    fireEvent.change(within(confirm).getByLabelText('Type Shop prod to continue'), { target: { value: 'shop prod' } })
    expect(go).toBeDisabled()
    fireEvent.change(within(confirm).getByLabelText('Type Shop prod to continue'), { target: { value: 'Shop prod' } })
    fireEvent.click(go)
    await waitFor(() => expect(api.callsOf('mongo.write')).toHaveLength(2))
    expect(api.callsOf('mongo.write')[1]).toMatchObject({ op: 'replace', confirmed: true, confirmName: 'Shop prod' })
    expect(api.callsOf('mongo.write')[0]).not.toHaveProperty('confirmName')
  })

  it('offers no write controls on a read-only connection', async () => {
    await openItems(true)
    expect(screen.queryByRole('button', { name: 'New document' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Change many…' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Edit document' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'New collection in shop' })).toBeNull()
  })

  it('offers to reconnect under an error that looks like a dropped connection', async () => {
    await openItems()
    api.on('mongo.find', () => { throw refusal('query', 'MongoNetworkError: connection 3 to db:27017 closed') })
    fireEvent.click(screen.getAllByRole('button', { name: /^Run/ })[0]!)
    expect(await screen.findByRole('group', { name: 'Connection lost' })).toBeInTheDocument()
    api.on('connections.reconnect', { ok: true, message: 'Connected', serverVersion: 'MongoDB 7' })
    api.on('mongo.find', { documents, truncated: false, durationMs: 1 })
    fireEvent.click(screen.getByRole('button', { name: 'Reconnect' }))
    await waitFor(() => expect(api.callsOf('connections.reconnect')).toHaveLength(1))
  })
})
