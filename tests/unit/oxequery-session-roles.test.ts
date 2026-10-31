// @vitest-environment node
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * B14: the person's and an agent's worker sessions are kept apart, and a busy session is never closed. Driven through
 * a fake `pg` and a fake `mongodb` that remember, per client, whether a transaction is open when `end()` is called.
 * The real servers are covered by tests/live/oxequery-writes-live.test.ts.
 */
type Fn = (...args: any[]) => any // eslint-disable-line @typescript-eslint/no-explicit-any

const server = vi.hoisted(() => {
  const gate = (): { wait: Promise<void>; open: () => void } => { let open = (): void => undefined; const wait = new Promise<void>(resolve => { open = resolve }); return { wait, open } }
  return {
    gate,
    pg: [] as { pid: number; log: string[]; inTx: boolean; ended: boolean; endedInTx: boolean }[],
    /** A statement matching /pg_sleep/ waits here. */
    sleep: null as null | { wait: Promise<void>; open: () => void },
    /** Every client's connect waits here while set. */
    connecting: null as null | { wait: Promise<void>; open: () => void },
    killed: [] as number[],
    mongo: [] as { closed: number; killOps: unknown[]; inserted: number }[],
    /** insertMany waits here: the person's import is under way. */
    insert: null as null | { wait: Promise<void>; open: () => void },
    /** A find waits here: a long read is running. */
    find: null as null | { wait: Promise<void>; open: () => void }
  }
})

vi.mock('pg-cursor', () => ({
  default: class Cursor {
    client?: { pid: number; log: string[]; inTx: boolean }
    private done = false
    constructor(readonly text: string, readonly values: unknown[]) {}
    read(_count: number, done: (error: Error | null, rows?: unknown[][], result?: unknown) => void): void {
      const state = this.client!
      const text = this.text.trim()
      void (async () => {
        if (!this.done) {
          state.log.push(text)
          if (/^BEGIN/i.test(text)) state.inTx = true
          if (/^(COMMIT|ROLLBACK)/i.test(text)) state.inTx = false
          if (/pg_sleep/.test(text) && server.sleep) await server.sleep.wait
        }
        this.done = true
        done(null, [], { fields: [], command: /^\s*(\w+)/.exec(text)?.[1]?.toUpperCase() ?? 'SELECT', rowCount: 0 })
      })()
    }
    close(done: () => void): void { done() }
  }
}))

vi.mock('pg', async () => {
  const { EventEmitter } = await import('node:events')
  class Client extends EventEmitter {
    readonly state = { pid: 5000 + server.pg.length, log: [] as string[], inTx: false, ended: false, endedInTx: false }
    readonly processID = this.state.pid
    constructor(readonly config: unknown) { super(); server.pg.push(this.state) }
    async connect(): Promise<void> { if (server.connecting) await server.connecting.wait }
    async end(): Promise<void> { this.state.endedInTx ||= this.state.inTx; this.state.ended = true }
    query(arg: unknown, params?: unknown[]): unknown {
      if (arg && typeof (arg as { read?: unknown }).read === 'function') { (arg as { client: unknown }).client = this.state; return arg }
      const text = (typeof arg === 'string' ? arg : (arg as { text: string }).text).trim()
      const values = typeof arg === 'string' ? (params ?? []) : ((arg as { values?: unknown[] }).values ?? [])
      if (/pg_cancel_backend/.test(text)) { server.killed.push(values[0] as number); server.sleep?.open(); return Promise.resolve({ rows: [] }) }
      this.state.log.push(text)
      if (/^BEGIN/i.test(text)) this.state.inTx = true
      if (/^(COMMIT|ROLLBACK)/i.test(text)) this.state.inTx = false
      return Promise.resolve({ rows: [], fields: [], command: /^\s*(\w+)/.exec(text)?.[1]?.toUpperCase() ?? 'SELECT', rowCount: 0 })
    }
  }
  return { Client }
})

vi.mock('mongodb', () => {
  class MongoClient {
    readonly state = { closed: 0, killOps: [] as unknown[], inserted: 0 }
    constructor(_uri: string) { server.mongo.push(this.state) }
    async connect(): Promise<void> { if (server.connecting) await server.connecting.wait }
    async close(): Promise<void> { this.state.closed++ }
    db(name: string): unknown {
      const state = this.state
      const collection = {
        find: (): unknown => ({ toArray: async (): Promise<unknown[]> => { if (server.find) await server.find.wait; return [] } }),
        countDocuments: async (): Promise<number> => 0,
        insertMany: async (documents: unknown[]): Promise<{ insertedCount: number }> => { if (server.insert) await server.insert.wait; state.inserted += documents.length; return { insertedCount: documents.length } }
      }
      const command: Fn = async (body: Record<string, unknown>) => {
        if (body.currentOp) return { inprog: [{ opid: 77 }] }
        if (body.killOp) state.killOps.push(body.op)
        return {}
      }
      return { collection: () => collection, command, admin: () => ({ listDatabases: async () => ({ databases: [{ name }] }) }) }
    }
  }
  return { MongoClient }
})

import { AGENT_IDLE_MS, MAX_CONNECTIONS_PER_SLOT, OxeQueryCore } from '../../electron/main/services/oxequery/oxequery-core'
import { OxeQueryError, type ResolvedConnection } from '../../electron/main/services/oxequery/oxequery-errors'

const person: ResolvedConnection = { id: 'c1', engine: 'postgres', host: 'db.local', port: 5432, database: 'app', username: 'me', password: 'hunter2', sslMode: 'disable', readOnly: false }
/** What the agent gateway sends: the same connection, forced read-only, as the agent. */
const agent: ResolvedConnection = { ...person, readOnly: true, role: 'agent' }
const mongoPerson: ResolvedConnection = { ...person, id: 'm1', engine: 'mongodb', port: 27017, database: 'shop' }
const mongoAgent: ResolvedConnection = { ...mongoPerson, readOnly: true, role: 'agent' }
const find = { connectionId: 'm1', database: 'shop', collection: 'items', limit: 5 }

let core: OxeQueryCore
const dir = mkdtempSync(join(tmpdir(), 'oxe-roles-'))
beforeEach(() => {
  server.pg.length = 0; server.mongo.length = 0; server.killed.length = 0
  server.sleep = null; server.connecting = null; server.insert = null; server.find = null
  core = new OxeQueryCore()
})
afterEach(async () => { server.sleep?.open(); server.insert?.open(); server.find?.open(); server.connecting?.open(); await core.closeAll() })
afterAll(() => rmSync(dir, { recursive: true, force: true }))

const failure = async (run: () => Promise<unknown>): Promise<OxeQueryError> => {
  try { await run() } catch (error) { return error as OxeQueryError }
  throw new Error('expected a failure')
}
/** As the worker runs a request: tracked, so the session counts as busy while it runs. */
const request = <T>(connection: ResolvedConnection, run: () => Promise<T>): Promise<T> => core.track(connection, run)
const endedInTx = (): boolean => server.pg.some(client => client.endedInTx)

describe('PostgreSQL: the person and an agent', () => {
  it("an agent's read on the connection the person is using leaves the person's transaction open", async () => {
    await request(person, () => core.sqlRun(person, 'BEGIN'))
    await request(person, () => core.sqlRun(person, "INSERT INTO t VALUES ('x')"))
    await request(agent, () => core.sqlRun(agent, 'SELECT * FROM t'))

    expect(server.pg).toHaveLength(2)
    const [mine, theirs] = server.pg
    expect(mine.ended).toBe(false)
    expect(core.txState(person)).toMatchObject({ state: 'open', statements: 1 })
    // The agent's read ran on its own backend, inside its own read-only transaction, never inside the person's.
    expect(mine.log).toEqual(['BEGIN', "INSERT INTO t VALUES ('x')"])
    expect(theirs.log).toEqual(['BEGIN READ ONLY', 'SELECT * FROM t', 'ROLLBACK'])

    await request(person, () => core.sqlRun(person, 'COMMIT'))
    expect(core.txState(person).state).toBe('none')
    expect(endedInTx()).toBe(false)
  })

  it('never calls end() on a session with a transaction open: a settings change is refused with conflict', async () => {
    await request(person, () => core.sqlRun(person, 'BEGIN'))
    const changed = { ...person, password: 'rotated' }
    const refused = await failure(() => request(changed, () => core.sqlRun(changed, 'SELECT 1')))
    expect(refused.code).toBe('conflict')
    expect(refused.messageCode).toEqual({ code: 'oxequery.session.busy', params: {} })
    expect(server.pg[0].ended).toBe(false)
    expect(core.txState(person).state).toBe('open')

    // Once the transaction ends, the change reopens the session.
    await request(person, () => core.sqlRun(person, 'ROLLBACK'))
    await request(changed, () => core.sqlRun(changed, 'SELECT 1'))
    expect(server.pg).toHaveLength(2)
    expect(server.pg[0].ended).toBe(true)
    expect(endedInTx()).toBe(false)
  })

  it('never closes a session whose statement is running', async () => {
    server.sleep = server.gate()
    const running = request(person, () => core.sqlRun(person, 'SELECT pg_sleep(60)'))
    await vi.waitFor(() => expect(server.pg[0]?.log).toContain('SELECT pg_sleep(60)'))
    const changed = { ...person, statementTimeoutMs: 5000 }
    expect((await failure(() => request(changed, () => core.sqlRun(changed, 'SELECT 1')))).code).toBe('conflict')
    expect(server.pg[0].ended).toBe(false)
    server.sleep.open()
    await running
  })

  it("an agent's timeout cancels the agent's backend, never the person's", async () => {
    await request(person, () => core.sqlRun(person, 'BEGIN'))
    server.sleep = server.gate()
    const read = request(agent, () => core.sqlRun(agent, 'SELECT pg_sleep(60)'))
    await vi.waitFor(() => expect(server.pg[1]?.log).toContain('SELECT pg_sleep(60)'))
    // What the gateway sends when its time limit passes.
    expect(await core.sqlCancel(agent)).toBe(true)
    await read
    expect(server.killed).toEqual([server.pg[1].pid])
    expect(server.pg[0].ended).toBe(false)
    expect(core.txState(person).state).toBe('open')
    // Nothing of the person's was running, so a cancel for the person finds nothing.
    expect(await core.sqlCancel(person)).toBe(false)
  })

  it('an agent cannot leave a transaction open on its session', async () => {
    const write = { ...agent, readOnly: false }
    const refused = await failure(() => request(write, () => core.sqlRun(write, 'BEGIN', { confirmed: true })))
    expect(refused.code).toBe('invalid')
    expect(core.txState(write).state).toBe('none')
    expect(server.pg[0].inTx).toBe(false)
  })

  it(`closes the agent's idle session after ${AGENT_IDLE_MS / 60_000} minutes, and leaves the person's`, async () => {
    await request(person, () => core.sqlRun(person, 'SELECT 1'))
    await request(agent, () => core.sqlRun(agent, 'SELECT 1'))
    expect(await core.reapIdle(Date.now() + AGENT_IDLE_MS - 1000)).toBe(0)
    expect(await core.reapIdle(Date.now() + AGENT_IDLE_MS + 1000)).toBe(1)
    expect(server.pg.map(client => client.ended)).toEqual([false, true])
    // The next agent call opens a fresh one.
    await request(agent, () => core.sqlRun(agent, 'SELECT 1'))
    expect(server.pg).toHaveLength(3)
  })

  it('does not reap an idle-looking session that has a transaction open', async () => {
    await request(agent, () => core.sqlRun(agent, 'SELECT 1'))
    await request(person, () => core.sqlRun(person, 'BEGIN'))
    expect(await core.reapIdle(Date.now() + 60 * 60_000)).toBe(1)
    expect(server.pg.map(client => client.ended)).toEqual([true, false])
  })

  it(`holds at most ${MAX_CONNECTIONS_PER_SLOT} driver connections per connection and role, and refuses one more with limit`, async () => {
    server.sleep = server.gate()
    const running = request(person, () => core.sqlRun(person, 'SELECT pg_sleep(60)'))
    await vi.waitFor(() => expect(server.pg[0]?.log).toContain('SELECT pg_sleep(60)'))
    // Two cancels whose connections hang fill the person's slot: the session plus two.
    server.connecting = server.gate()
    const cancels = [core.sqlCancel(person), core.sqlCancel(person)]
    const refused = await failure(() => core.sqlCancel(person))
    expect(refused.code).toBe('limit')
    expect(refused.messageCode).toEqual({ code: 'oxequery.session.limit', params: { limit: MAX_CONNECTIONS_PER_SLOT } })
    // The cap is per role: the agent still gets its session.
    const agentRead = request(agent, () => core.sqlRun(agent, 'SELECT 1'))
    server.connecting.open()
    await agentRead
    expect(await Promise.all(cancels)).toEqual([true, true])
    await running
    // The cancels gave their places back.
    server.sleep = server.gate()
    const again = request(person, () => core.sqlRun(person, 'SELECT pg_sleep(1)'))
    await vi.waitFor(() => expect(server.pg[0].log.filter(line => /pg_sleep/.test(line))).toHaveLength(2))
    expect(await core.sqlCancel(person)).toBe(true)
    await again
  })

  it('opens one session when two requests arrive together', async () => {
    server.connecting = server.gate()
    const both = Promise.all([request(person, () => core.sqlSchemas(person)), request(person, () => core.sqlSchemas(person))])
    server.connecting.open()
    await both
    expect(server.pg).toHaveLength(1)
  })

  it('closing one role leaves the other; closing the connection closes both', async () => {
    await request(person, () => core.sqlRun(person, 'SELECT 1'))
    await request(agent, () => core.sqlRun(agent, 'SELECT 1'))
    await core.closeConnection('c1', 'agent')
    expect(server.pg.map(client => client.ended)).toEqual([false, true])
    await core.closeConnection('c1')
    expect(server.pg.map(client => client.ended)).toEqual([true, true])
  })

  it('reports the person sessions at risk, for the worker restart rule', async () => {
    expect(core.personAtRisk()).toBe(0)
    await request(agent, () => core.sqlRun(agent, 'SELECT 1'))
    expect(core.personAtRisk()).toBe(0)
    await request(person, () => core.sqlRun(person, 'BEGIN'))
    expect(core.personAtRisk()).toBe(1)
    await request(person, () => core.sqlRun(person, 'COMMIT'))
    expect(core.personAtRisk()).toBe(0)
  })
})

describe('MongoDB: the person and an agent', () => {
  const importFile = (): string => {
    const path = join(dir, `items-${Math.random().toString(36).slice(2)}.ndjson`)
    writeFileSync(path, ['{"_id": 1, "name": "a"}', '{"_id": 2, "name": "b"}'].join('\n'))
    return path
  }
  const runImport = () => request(mongoPerson, () => core.importRun(mongoPerson, {
    path: importFile(), format: 'ndjson', target: { kind: 'collection', database: 'shop', collection: 'items' }, mapping: { _id: '_id', name: 'name' }
  } as never, { cancelled: () => false, progress: () => undefined }))

  it("an agent's read during the person's import never closes the person's client", async () => {
    server.insert = server.gate()
    const importing = runImport()
    await vi.waitFor(() => expect(server.mongo).toHaveLength(1))
    await request(mongoAgent, () => core.mongoFind(mongoAgent, find))
    expect(server.mongo).toHaveLength(2)
    expect(server.mongo[0].closed).toBe(0)
    expect(core.personAtRisk()).toBe(1)
    server.insert.open()
    expect(await importing).toMatchObject({ inserted: 2 })
    expect(server.mongo[0]).toMatchObject({ closed: 0, inserted: 2 })
  })

  it('refuses a settings change with conflict while the import runs, and reopens after it', async () => {
    server.insert = server.gate()
    const importing = runImport()
    await vi.waitFor(() => expect(server.mongo).toHaveLength(1))
    const changed = { ...mongoPerson, password: 'rotated' }
    const refused = await failure(() => request(changed, () => core.mongoFind(changed, find)))
    expect(refused.code).toBe('conflict')
    expect(refused.messageCode?.code).toBe('oxequery.session.busy')
    expect(server.mongo[0].closed).toBe(0)
    server.insert.open()
    await importing
    await request(changed, () => core.mongoFind(changed, find))
    expect(server.mongo[0].closed).toBe(1)
    expect(server.mongo).toHaveLength(2)
  })

  it("an agent's timeout stops the agent's operation on the agent's client, while the person's import carries on", async () => {
    server.insert = server.gate()
    const importing = runImport()
    await vi.waitFor(() => expect(server.mongo).toHaveLength(1))
    server.find = server.gate()
    const read = request(mongoAgent, () => core.mongoFind(mongoAgent, find)).catch((error: unknown) => error)
    await vi.waitFor(() => expect(server.mongo).toHaveLength(2))
    await new Promise(resolve => setTimeout(resolve, 10))
    // What the gateway sends when its time limit passes.
    expect(await core.mongoCancel(mongoAgent)).toBe(true)
    expect(server.mongo.map(client => client.killOps)).toEqual([[], [77]])
    expect(await core.mongoCancel(mongoPerson)).toBe(false)
    server.find.open()
    await read
    server.insert.open()
    expect(await importing).toMatchObject({ inserted: 2 })
    expect(server.mongo.map(client => client.closed)).toEqual([0, 0])
  })

  it(`closes the agent's idle client after ${AGENT_IDLE_MS / 60_000} minutes, and leaves the person's`, async () => {
    await request(mongoPerson, () => core.mongoFind(mongoPerson, find))
    await request(mongoAgent, () => core.mongoFind(mongoAgent, find))
    expect(await core.reapIdle(Date.now() + AGENT_IDLE_MS + 1000)).toBe(1)
    expect(server.mongo.map(client => client.closed)).toEqual([0, 1])
  })
})
