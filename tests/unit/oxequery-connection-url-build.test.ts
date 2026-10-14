import { describe, expect, it } from 'vitest'
import { buildConnectionUrl, parseConnectionUrl } from '../../src/components/OxeQuery/connection-url'

const mongo = { authSource: '', replicaSet: '', directConnection: true, srv: false, extraHosts: [] as string[] }

describe('buildConnectionUrl', () => {
  it('writes PostgreSQL and MongoDB strings without a password', () => {
    expect(buildConnectionUrl({ engine: 'postgres', host: 'db.internal', port: 5432, database: 'app', username: 'me@corp', sslMode: 'disable', mongo })).toBe('postgres://me%40corp@db.internal:5432/app')
    expect(buildConnectionUrl({ engine: 'mongodb', host: '127.0.0.1', port: 27017, database: 'seedz', username: '', sslMode: 'disable', mongo })).toBe('mongodb://127.0.0.1:27017/seedz')
  })

  it('round-trips through the parser', () => {
    const cases = [
      { engine: 'postgres' as const, host: 'h', port: 6543, database: 'd', username: 'u', sslMode: 'verify-full' as const, mongo },
      { engine: 'mongodb' as const, host: 'cluster0.abc.mongodb.net', port: 27017, database: 'seedz', username: 'u', sslMode: 'require' as const, mongo: { ...mongo, srv: true, directConnection: false, authSource: 'admin' } },
      { engine: 'mongodb' as const, host: 'a', port: 27017, database: '', username: '', sslMode: 'disable' as const, mongo: { ...mongo, directConnection: false, replicaSet: 'rs0', extraHosts: ['b:27018'] } }
    ]
    for (const parts of cases) {
      const parsed = parseConnectionUrl(buildConnectionUrl(parts))
      expect(parsed.ok).toBe(true)
      if (parsed.ok) expect(parsed.value).toMatchObject({ engine: parts.engine, host: parts.host, port: parts.port, database: parts.database, username: parts.username, sslMode: parts.sslMode, mongo: parts.mongo })
    }
  })
})
