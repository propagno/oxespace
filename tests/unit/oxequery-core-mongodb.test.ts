import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The MongoDB half of OxeQuery's driver layer, driven through a scripted `mongodb`. Each test sets what the
 * "server" returns for the collection calls it expects, and checks what the core sent and what it made of the
 * answer. The real server is covered by tests/live.
 */
type Fn = (...args: any[]) => any // eslint-disable-line @typescript-eslint/no-explicit-any

const server = vi.hoisted(() => ({
  collection: {} as Record<string, Fn>,
  database: {} as Record<string, Fn>,
  admin: {} as Record<string, Fn>,
  connectError: null as Error | null,
  clients: 0,
  uris: [] as string[],
  calls: [] as { db: string; name: string; args: unknown[] }[]
}))

vi.mock('mongodb', () => {
  const trace = (db: string, name: string, impl: Fn | undefined, fallback: unknown): Fn => (...args) => { server.calls.push({ db, name, args }); return impl ? impl(...args) : fallback }
  class MongoClient {
    constructor(uri: string) { server.clients++; server.uris.push(uri) }
    async connect(): Promise<void> { if (server.connectError) throw server.connectError }
    async close(): Promise<void> { /* closed */ }
    db(name: string): unknown {
      const collection = new Proxy({}, { get: (_target, property: string) => trace(name, property, server.collection[property], undefined) })
      return {
        collection: () => collection,
        listCollections: trace(name, 'listCollections', server.database.listCollections, { toArray: async () => [] }),
        command: trace(name, 'command', server.database.command, {}),
        createCollection: trace(name, 'createCollection', server.database.createCollection, {}),
        admin: () => ({ listDatabases: trace(name, 'listDatabases', server.admin.listDatabases, { databases: [] }) })
      }
    }
  }
  return { MongoClient }
})

import { OxeQueryCore, nameList } from '../../electron/main/services/oxequery/oxequery-core'
import { OxeQueryError, type ResolvedConnection } from '../../electron/main/services/oxequery/oxequery-errors'

const base: ResolvedConnection = { id: 'm1', engine: 'mongodb', host: 'mongo.local', port: 27017, database: 'shop', username: 'me', password: 'hunter2', sslMode: 'disable', readOnly: false }
const connection = (change: Partial<ResolvedConnection> = {}): ResolvedConnection => ({ ...base, ...change })
const cursor = (documents: unknown[], explain?: unknown): { toArray: Fn; explain: Fn } => ({ toArray: async () => documents, explain: async () => explain })
const called = (name: string): unknown[][] => server.calls.filter(call => call.name === name).map(call => call.args)

let core: OxeQueryCore
beforeEach(() => {
  server.collection = {}; server.database = {}; server.admin = {}; server.connectError = null; server.clients = 0; server.uris.length = 0; server.calls.length = 0
  core = new OxeQueryCore()
})
afterEach(async () => { await core.closeAll() })

const failure = async (run: () => Promise<unknown>): Promise<OxeQueryError> => {
  try { await run() } catch (error) { return error as OxeQueryError }
  throw new Error('expected a failure')
}

describe('nameList', () => {
  it('reads arrays, JSON text and the raw array form', () => {
    expect(nameList(['a', 'b'])).toEqual(['a', 'b'])
    expect(nameList('["a","b"]')).toEqual(['a', 'b'])
    expect(nameList('{a,"b c"}')).toEqual(['a', 'b c'])
    expect(nameList(null)).toEqual([])
    expect(nameList('')).toEqual([])
  })
})

describe('sessions and connection tests', () => {
  it('connects with a URI that carries the credentials, once per connection', async () => {
    server.admin.listDatabases = async () => ({ databases: [{ name: 'shop', sizeOnDisk: 4096, empty: false }, { name: 'tmp', empty: true }] })
    expect(await core.mongoDatabases(connection())).toEqual([{ name: 'shop', sizeOnDisk: 4096, empty: false }, { name: 'tmp', empty: true }])
    await core.mongoDatabases(connection())
    expect(server.clients).toBe(1)
    expect(server.uris[0]).toMatch(/^mongodb:\/\/me:hunter2@mongo\.local:27017\//)
  })

  it('falls back to the database on the connection when the user cannot list databases', async () => {
    server.admin.listDatabases = async () => { throw new Error('not authorized') }
    expect(await core.mongoDatabases(connection())).toEqual([{ name: 'shop' }])
    await expect(core.mongoDatabases(connection({ id: 'm2', database: '' }))).rejects.toMatchObject({ code: 'query' })
  })

  it('tests a connection and reports the version, or a failure without the password', async () => {
    server.database.command = async () => ({ version: '7.0.5' })
    expect(await core.test(connection())).toMatchObject({ ok: true, serverVersion: 'MongoDB 7.0.5' })
    await core.closeConnection('m1')
    server.connectError = new Error('Authentication failed for hunter2')
    const failed = await core.test(connection())
    expect(failed.ok).toBe(false)
    expect(failed.message).not.toContain('hunter2')
    expect(failed).toMatchObject({ code: 'connect' })
  })

  it('lists collections sorted, with their type', async () => {
    server.database.listCollections = () => ({ toArray: async () => [{ name: 'b', type: 'view' }, { name: 'a' }] })
    expect(await core.mongoCollections(connection(), 'shop')).toEqual([{ name: 'a', type: 'collection' }, { name: 'b', type: 'view' }])
  })
})

describe('reading documents', () => {
  const docs = [{ _id: 1, sku: 'a' }, { _id: 2, sku: 'b' }, { _id: 3, sku: 'c' }]

  it('finds with limit, skip, sort and projection, and counts the match', async () => {
    server.collection.find = () => cursor(docs)
    server.collection.countDocuments = async () => 41
    const result = await core.mongoFind(connection(), { connectionId: 'm1', database: 'shop', collection: 'items', filter: '{"sku":"a"}', projection: '{"sku":1}', sort: '{"sku":-1}', limit: 2, skip: 5 })
    expect(result.documents).toHaveLength(2)
    expect(result).toMatchObject({ truncated: true, total: 41 })
    const [filter, options] = called('find')[0] as [unknown, Record<string, unknown>]
    expect(filter).toEqual({ sku: 'a' })
    expect(options).toMatchObject({ projection: { sku: 1 }, sort: { sku: -1 }, limit: 3, skip: 5, promoteValues: false })
    expect(String(options.comment)).toMatch(/^oxequery:/)
  })

  it('still answers when the count is slow', async () => {
    server.collection.find = () => cursor(docs.slice(0, 1))
    server.collection.countDocuments = async () => { throw new Error('exceeded time limit') }
    const result = await core.mongoFind(connection(), { connectionId: 'm1', database: 'shop', collection: 'items', filter: '{}' })
    expect(result.total).toBeUndefined()
    expect(result.truncated).toBe(false)
  })

  it('names a cancelled operation, a time limit and any other failure', async () => {
    const find = (message: string): void => { server.collection.find = () => ({ toArray: async () => { throw new Error(message) } }) }
    const run = (): Promise<unknown> => core.mongoFind(connection(), { connectionId: 'm1', database: 'shop', collection: 'items', filter: '{}' })
    find('operation was interrupted'); expect((await failure(run)).code).toBe('cancelled')
    find('Executor error: MaxTimeMSExpired'); expect((await failure(run)).code).toBe('timeout')
    find('boom hunter2'); const other = await failure(run)
    expect(other.code).toBe('query'); expect(other.message).not.toContain('hunter2')
  })

  it('aggregates with skip and limit and refuses write stages on a read-only connection', async () => {
    server.collection.aggregate = () => cursor([{ _id: 'a', n: 2 }])
    const result = await core.mongoAggregate(connection(), { connectionId: 'm1', database: 'shop', collection: 'items', pipeline: '[{"$group":{"_id":"$sku","n":{"$sum":1}}}]', limit: 10, skip: 3 })
    expect(result.documents).toHaveLength(1)
    expect((called('aggregate')[0]![0] as unknown[]).slice(-2)).toEqual([{ $skip: 3 }, { $limit: 11 }])
    await expect(core.mongoAggregate(connection({ readOnly: true }), { connectionId: 'm1', database: 'shop', collection: 'items', pipeline: '[{"$out":"copy"}]' })).rejects.toThrow()
  })

  it('returns one whole document by id, and says when it is gone', async () => {
    server.collection.findOne = async () => ({ _id: 7, name: 'x' })
    expect(JSON.parse((await core.mongoDocument(connection(), { database: 'shop', collection: 'items', id: '7' })).text)).toMatchObject({ _id: 7, name: 'x' })
    server.collection.findOne = async () => null
    expect((await failure(() => core.mongoDocument(connection(), { database: 'shop', collection: 'items', id: '7' }))).message).toMatch(/no longer exists/)
  })

  it('reports statistics, indexes and an inferred schema', async () => {
    server.collection.aggregate = () => cursor([{ storageStats: { count: 10, size: 100, avgObjSize: 10, storageSize: 4096, nindexes: 2, totalIndexSize: 512, capped: true } }])
    expect(await core.mongoStats(connection(), 'shop', 'items')).toEqual({ documents: 10, sizeBytes: 100, avgDocumentBytes: 10, storageBytes: 4096, indexes: 2, indexBytes: 512, capped: true })
    server.collection.indexes = async () => [{ name: '_id_', key: { _id: 1 } }, { name: 'sku_1', key: { sku: 1 }, unique: true }]
    expect(await core.mongoIndexes(connection(), 'shop', 'items')).toEqual([{ name: '_id_', keys: '{"_id":1}', unique: false }, { name: 'sku_1', keys: '{"sku":1}', unique: true }])
    server.collection.aggregate = () => cursor([{ _id: 1, sku: 'a', qty: 2 }, { _id: 2, sku: 'b' }])
    const schema = await core.mongoSchema(connection(), 'shop', 'items')
    expect(schema.sampled).toBe(2)
    expect(schema.fields.map(field => field.path)).toEqual(expect.arrayContaining(['sku', 'qty']))
  })

  it('explains a find and an aggregate', async () => {
    const plan = { queryPlanner: { winningPlan: { stage: 'IXSCAN', indexName: 'sku_1' } }, executionStats: { totalDocsExamined: 1, nReturned: 1 } }
    server.collection.find = () => cursor([], plan)
    server.collection.aggregate = () => cursor([], plan)
    const find = await core.mongoExplain(connection(), { connectionId: 'm1', database: 'shop', collection: 'items', kind: 'find', filter: '{"sku":"a"}', sort: '{"sku":1}', projection: '{"sku":1}' })
    expect(find).toMatchObject({ stage: 'IXSCAN', index: 'sku_1' })
    const aggregate = await core.mongoExplain(connection(), { connectionId: 'm1', database: 'shop', collection: 'items', kind: 'aggregate', filter: '{}', pipeline: '[{"$match":{"sku":"a"}}]', verbosity: 'queryPlanner' })
    expect(aggregate.stage).toBe('IXSCAN')
  })
})

describe('writing documents', () => {
  const write = (change: Record<string, unknown>) => core.mongoWrite(connection(), { connectionId: 'm1', database: 'shop', collection: 'items', op: 'replace', ...change } as never)

  it('inserts and returns the new id', async () => {
    server.collection.insertOne = async () => ({ insertedId: 'abc' })
    expect(await write({ op: 'insert', document: '{"sku":"z"}' })).toMatchObject({ insertedId: '"abc"' })
  })

  it('replaces only a document that still equals the one that was opened', async () => {
    server.collection.replaceOne = async () => ({ matchedCount: 1, modifiedCount: 1 })
    const result = await write({ document: '{"_id":1,"sku":"b"}', expected: '{"_id":1,"sku":"a"}' })
    expect(result).toEqual({ matched: 1, modified: 1, deleted: 0 })
    const [filter] = called('replaceOne')[0] as [Record<string, unknown>]
    expect(Number(filter._id)).toBe(1)
    expect(filter.$expr).toBeDefined()
  })

  it('explains a miss: changed by someone else, or gone', async () => {
    server.collection.replaceOne = async () => ({ matchedCount: 0, modifiedCount: 0 })
    server.collection.countDocuments = async () => 1
    expect((await failure(() => write({ document: '{"_id":1,"sku":"b"}', expected: '{"_id":1,"sku":"a"}' }))).message).toMatch(/changed since you opened it/)
    server.collection.countDocuments = async () => 0
    expect((await failure(() => write({ document: '{"_id":1}', expected: '{"_id":1}' }))).message).toMatch(/no longer exists/)
  })

  it('deletes with the same guard', async () => {
    server.collection.deleteOne = async () => ({ deletedCount: 1 })
    expect(await write({ op: 'delete', expected: '{"_id":1,"sku":"a"}' })).toEqual({ matched: 1, modified: 0, deleted: 1 })
    server.collection.deleteOne = async () => ({ deletedCount: 0 })
    server.collection.countDocuments = async () => 0
    expect((await failure(() => write({ op: 'delete', expected: '{"_id":1}' }))).code).toBe('conflict')
  })

  it('refuses edits on a read-only connection, without the original, and with a changed _id', async () => {
    expect((await failure(() => core.mongoWrite(connection({ readOnly: true }), { connectionId: 'm1', database: 'shop', collection: 'items', op: 'insert', document: '{}' } as never))).code).toBe('read-only')
    expect((await failure(() => write({ document: '{"_id":1}' }))).message).toMatch(/needs the original/)
    expect((await failure(() => write({ document: '{"_id":2}', expected: '{"_id":1}' }))).message).toMatch(/_id of a document cannot be changed/)
  })
})

describe('bulk changes', () => {
  const bulk = (change: Record<string, unknown>) => core.mongoBulk(connection(), { connectionId: 'm1', database: 'shop', collection: 'items', op: 'updateMany', filter: '{"sku":"a"}', update: '{"$set":{"x":1}}', ...change } as never)

  it('counts first, and only counts on a dry run', async () => {
    server.collection.countDocuments = async () => 3
    expect(await bulk({ dryRun: true })).toEqual({ matched: 3, modified: 0, deleted: 0, dryRun: true })
    expect(called('updateMany')).toHaveLength(0)
  })

  it('needs confirmation, warns about an empty filter, and stops if the count moved', async () => {
    server.collection.countDocuments = async () => 3
    const confirm = await failure(() => bulk({ filter: '{}' }))
    expect(confirm.code).toBe('confirm')
    expect(confirm.reasons.join(' ')).toMatch(/every document/)
    expect((await failure(() => bulk({ confirmed: true, expectedCount: 2 }))).code).toBe('conflict')
  })

  it('updates and deletes the counted documents', async () => {
    server.collection.countDocuments = async () => 3
    server.collection.updateMany = async () => ({ matchedCount: 3, modifiedCount: 2 })
    server.collection.deleteMany = async () => ({ deletedCount: 3 })
    expect(await bulk({ confirmed: true, expectedCount: 3 })).toEqual({ matched: 3, modified: 2, deleted: 0, dryRun: false })
    expect(await bulk({ op: 'deleteMany', update: undefined, confirmed: true, expectedCount: 3 })).toEqual({ matched: 3, modified: 0, deleted: 3, dryRun: false })
  })

  it('refuses a real run on a read-only connection but allows counting', async () => {
    server.collection.countDocuments = async () => 1
    expect((await failure(() => core.mongoBulk(connection({ readOnly: true }), { connectionId: 'm1', database: 'shop', collection: 'items', op: 'deleteMany', filter: '{}' } as never))).code).toBe('read-only')
    expect(await core.mongoBulk(connection({ readOnly: true }), { connectionId: 'm1', database: 'shop', collection: 'items', op: 'deleteMany', filter: '{}', dryRun: true } as never)).toMatchObject({ dryRun: true })
  })
})

describe('collections, indexes and validation', () => {
  const action = (change: Record<string, unknown>) => core.mongoCollectionAction(connection(), { database: 'shop', collection: 'items', action: { kind: 'create' }, ...change } as never)

  it('creates (plain and capped), renames and drops, with the guards', async () => {
    await action({})
    await action({ action: { kind: 'create', capped: true, sizeBytes: 2048, maxDocuments: 10 } })
    expect(called('createCollection')[1]).toEqual(['items', { capped: true, size: 2048, max: 10 }])
    server.collection.rename = async () => ({})
    await action({ action: { kind: 'rename', to: 'things' } })
    expect(called('rename')[0]).toEqual(['things', { dropTarget: false }])
    expect((await failure(() => action({ action: { kind: 'drop' } }))).code).toBe('confirm')
    server.collection.drop = async () => true
    await action({ action: { kind: 'drop' }, confirmed: true })
    expect(called('drop')).toHaveLength(1)
    expect((await failure(() => action({ collection: 'system.users' }))).code).toBe('invalid')
    expect((await failure(() => action({ action: { kind: 'rename', to: 'a$b' } }))).code).toBe('invalid')
    expect((await failure(() => core.mongoCollectionAction(connection({ readOnly: true }), { database: 'shop', collection: 'items', action: { kind: 'create' } } as never))).code).toBe('read-only')
  })

  it('creates and drops indexes, validating keys and protecting _id', async () => {
    server.collection.createIndex = async () => 'sku_1'
    server.collection.dropIndex = async () => ({})
    expect(await core.mongoCreateIndex(connection(), { database: 'shop', collection: 'items', keys: '{"sku":1}', unique: true })).toEqual({ name: 'sku_1' })
    expect(called('createIndex')[0]).toEqual([{ sku: 1 }, { unique: true, background: true }])
    expect((await failure(() => core.mongoCreateIndex(connection(), { database: 'shop', collection: 'items', keys: '{}' }))).code).toBe('invalid')
    expect((await failure(() => core.mongoCreateIndex(connection(), { database: 'shop', collection: 'items', keys: '{"$bad":1}' }))).code).toBe('invalid')
    expect((await failure(() => core.mongoCreateIndex(connection(), { database: 'shop', collection: 'items', keys: '{"sku":2}' }))).code).toBe('invalid')
    expect((await failure(() => core.mongoCreateIndex(connection({ readOnly: true }), { database: 'shop', collection: 'items', keys: '{"sku":1}' }))).code).toBe('read-only')
    expect(await core.mongoDropIndex(connection(), { database: 'shop', collection: 'items', name: 'sku_1' })).toEqual({ dropped: true })
    expect((await failure(() => core.mongoDropIndex(connection(), { database: 'shop', collection: 'items', name: '_id_' }))).code).toBe('invalid')
    expect((await failure(() => core.mongoDropIndex(connection({ readOnly: true }), { database: 'shop', collection: 'items', name: 'sku_1' }))).code).toBe('read-only')
  })

  it('reads and sets the validator', async () => {
    server.database.listCollections = () => ({ toArray: async () => [{ options: { validator: { $jsonSchema: { required: ['sku'] } }, validationLevel: 'moderate', validationAction: 'warn' } }] })
    const validation = await core.mongoValidation(connection(), 'shop', 'items')
    expect(validation).toMatchObject({ level: 'moderate', action: 'warn' })
    expect(validation.validator).toContain('required')
    server.database.listCollections = () => ({ toArray: async () => [{ options: {} }] })
    expect(await core.mongoValidation(connection(), 'shop', 'items')).toEqual({ validator: null, level: 'strict', action: 'error' })
    await core.mongoSetValidation(connection(), { database: 'shop', collection: 'items', validator: '{"$jsonSchema":{}}', level: 'strict', action: 'error' })
    expect(called('command')[0]).toEqual([{ collMod: 'items', validator: { $jsonSchema: {} }, validationLevel: 'strict', validationAction: 'error' }])
    expect((await failure(() => core.mongoSetValidation(connection({ readOnly: true }), { database: 'shop', collection: 'items', validator: null, level: 'strict', action: 'error' }))).code).toBe('read-only')
  })
})

describe('cancelling', () => {
  it('finds the running operation by its comment and kills it', async () => {
    let release: () => void = () => undefined
    server.collection.find = () => ({ toArray: () => new Promise(resolve => { release = () => resolve([]) }) })
    server.collection.countDocuments = async () => 0
    server.database.command = async (command: Record<string, unknown>) => command.currentOp ? { inprog: [{ opid: 5 }, {}] } : {}
    const running = core.mongoFind(connection(), { connectionId: 'm1', database: 'shop', collection: 'items', filter: '{}' })
    await vi.waitFor(() => expect(called('find')).toHaveLength(1))
    expect(await core.mongoCancel(connection())).toBe(true)
    expect(called('command').some(args => (args[0] as Record<string, unknown>).killOp === 1 && (args[0] as Record<string, unknown>).op === 5)).toBe(true)
    release()
    await running
    expect(await core.mongoCancel(connection())).toBe(false)
  })

  it('without the killOp privilege, still stops the operation here', async () => {
    let signal: AbortSignal | undefined
    server.collection.find = (_filter: unknown, options: { signal?: AbortSignal }) => {
      signal = options.signal
      return { toArray: () => new Promise((resolve, reject) => { options.signal?.addEventListener('abort', () => reject(options.signal?.reason)); setTimeout(() => resolve([]), 5000) }) }
    }
    server.collection.countDocuments = async () => 0
    server.database.command = async () => { throw new Error('not authorized') }
    const running = core.mongoFind(connection(), { connectionId: 'm1', database: 'shop', collection: 'items', filter: '{}' })
    await vi.waitFor(() => expect(called('find')).toHaveLength(1))
    expect(await core.mongoCancel(connection())).toBe(true)
    expect(signal?.aborted).toBe(true)
    await expect(running).rejects.toMatchObject({ code: 'cancelled' })
    // Nothing is running any more.
    expect(await core.mongoCancel(connection())).toBe(false)
  })
})
