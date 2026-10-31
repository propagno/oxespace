import { afterEach, describe, expect, it } from 'vitest'
import { openInMemoryDatabase, type AppDatabase } from '../../electron/main/db'
import { ConnectionStore, type SecretCipher } from '../../electron/main/services/oxequery/connection-store'
import { exportConnections, parseConnectionsFile } from '../../electron/main/services/oxequery/connection-transfer'

const databases: AppDatabase[] = []
afterEach(() => { for (const db of databases.splice(0)) db.close() })
const cipher: SecretCipher = { available: () => true, encrypt: value => Buffer.from(`enc:${value}`), decrypt: value => value.toString().replace(/^enc:/, '') }
function setup() {
  const db = openInMemoryDatabase(); databases.push(db)
  return { db, store: new ConnectionStore(db, cipher) }
}
const base = { name: 'app', engine: 'postgres' as const, host: 'db.internal', port: 5432 }

describe('organizing connections', () => {
  it('keeps group, favorite, color, masked names and keep-alive, and validates them', () => {
    const { store } = setup()
    const saved = store.save({ ...base, group: '  Client   A ', favorite: true, color: 'teal', maskPatterns: ['ssn', ' ssn ', 'iban'], keepaliveSeconds: 10 })
    expect(saved).toMatchObject({ group: 'Client A', favorite: true, color: 'teal', maskPatterns: ['ssn', 'iban'], keepaliveSeconds: 10 })
    expect(saved.ephemeral).toBeUndefined()
    expect(store.resolve(saved.id).keepaliveSeconds).toBe(10)
    expect(() => store.save({ ...base, color: 'neon' as never })).toThrow(/color/)
    expect(() => store.save({ ...base, group: 'x'.repeat(61) })).toThrow(/group/i)
    expect(() => store.save({ ...base, maskPatterns: Array.from({ length: 21 }, (_, index) => `n${index}`) })).toThrow(/At most/)
    expect(() => store.save({ ...base, keepaliveSeconds: -1 })).toThrow(/keep-alive/)
  })

  it('changes group, favorite and color alone, and notes use for the recent list once a minute', () => {
    const { store } = setup()
    const saved = store.save({ ...base })
    expect(store.update(saved.id, { favorite: true, group: 'Ops', color: 'pink' })).toMatchObject({ favorite: true, group: 'Ops', color: 'pink' })
    store.touch(saved.id, 1_000_000)
    store.touch(saved.id, 1_030_000)
    expect(store.get(saved.id).lastUsedAt).toBe(1_000_000)
    store.touch(saved.id, 1_070_000)
    expect(store.get(saved.id).lastUsedAt).toBe(1_070_000)
  })

  it('duplicates with its own secrets and not as a favorite', () => {
    const { store } = setup()
    const saved = store.save({ ...base, password: 'hunter2', favorite: true })
    const copy = store.duplicate(saved.id)
    expect(copy).toMatchObject({ name: 'app copy', favorite: false, hasPassword: true })
    expect(copy.id).not.toBe(saved.id)
    expect(store.resolve(copy.id).password).toBe('hunter2')
    store.delete(saved.id)
    expect(store.resolve(copy.id).password).toBe('hunter2')
  })

  it('signs a tunnel in with the SSH agent and stores no secret for it', () => {
    const { store, db } = setup()
    const saved = store.save({ ...base, ssh: { enabled: true, host: 'bastion', user: 'me', auth: 'agent' } })
    expect(saved.ssh).toMatchObject({ auth: 'agent', hasSecret: false })
    expect(store.resolve(saved.id).ssh).toMatchObject({ agent: true, host: 'bastion' })
    expect(db.prepare("SELECT count(*) AS n FROM secure_credentials WHERE provider LIKE 'oxequery:%:ssh'").get()).toEqual({ n: 0 })
  })
})

describe('connect without saving', () => {
  it('lives in memory only: listed, resolvable, never written, gone when deleted', () => {
    const { store, db } = setup()
    const temporary = store.saveEphemeral({ ...base, password: 'secret-pw' })
    expect(temporary).toMatchObject({ ephemeral: true, agentAccess: 'off', hasPassword: true })
    expect(temporary.id).toMatch(/^tmp-/)
    expect(store.list().map(item => item.id)).toContain(temporary.id)
    expect(store.resolve(temporary.id).password).toBe('secret-pw')
    expect(db.prepare('SELECT count(*) AS n FROM oxequery_connections').get()).toEqual({ n: 0 })
    expect(db.prepare("SELECT count(*) AS n FROM secure_credentials WHERE provider LIKE 'oxequery:%'").get()).toEqual({ n: 0 })
    expect(() => store.update(temporary.id, { favorite: true })).toThrow(/Save this connection/)
    expect(() => store.duplicate(temporary.id)).toThrow(/Save this connection/)
    store.delete(temporary.id)
    expect(store.list()).toEqual([])
  })

  it('validates like a saved connection and caps how many are open', () => {
    const { store } = setup()
    expect(() => store.saveEphemeral({ ...base, host: 'bad host' })).toThrow()
    for (let index = 0; index < 10; index++) store.saveEphemeral({ ...base, name: `t${index}` })
    expect(() => store.saveEphemeral({ ...base })).toThrow(/up to 10/)
  })
})

describe('exporting and importing connections', () => {
  it('writes no secret and brings connections back without agents', () => {
    const { store } = setup()
    store.save({ ...base, password: 'hunter2', group: 'Ops', favorite: true, agentAccess: 'read', maskPatterns: ['ssn'] })
    store.save({ ...base, name: 'jump', ssh: { enabled: true, host: 'bastion', user: 'me', auth: 'agent' } })
    store.save({ ...base, name: 'keyed', ssh: { enabled: true, host: 'bastion', user: 'me', auth: 'password', password: 'pw' } })
    const text = exportConnections(store.list())
    expect(text).not.toContain('hunter2')
    expect(text).not.toContain('"pw"')
    const parsed = parseConnectionsFile(text)
    expect(parsed.skipped).toBe(1)
    expect(parsed.inputs.map(input => input.name).sort()).toEqual(['app', 'jump'])
    expect(parsed.inputs.every(input => input.agentAccess === 'off')).toBe(true)
    const { store: other } = setup()
    for (const input of parsed.inputs) other.save(input)
    expect(other.list().find(item => item.name === 'app')).toMatchObject({ group: 'Ops', favorite: true, hasPassword: false, maskPatterns: ['ssn'] })
  })

  it('refuses a file that is not an export', () => {
    expect(() => parseConnectionsFile('not json')).toThrow(/not valid JSON/)
    expect(() => parseConnectionsFile('{"hello":1}')).toThrow(/not a connections export/)
  })
})
