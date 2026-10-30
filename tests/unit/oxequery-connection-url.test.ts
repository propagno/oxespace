import { describe, expect, it } from 'vitest'
import { parseConnectionUrl } from '../../src/components/OxeQuery/connection-url'

const mongoDefaults = { authSource: '', replicaSet: '', directConnection: true, srv: false, extraHosts: [] as string[] }

describe('connection string parsing', () => {
  it('reads a PostgreSQL URL with encoded credentials and TLS', () => {
    expect(parseConnectionUrl('postgresql://app%40corp:p%2Fw%3A1@db.internal:6543/shop?sslmode=require')).toEqual({
      ok: true, value: { engine: 'postgres', host: 'db.internal', port: 6543, database: 'shop', username: 'app@corp', password: 'p/w:1', sslMode: 'require', mongo: { ...mongoDefaults, directConnection: true } }
    })
  })

  it('maps the PostgreSQL verification modes', () => {
    expect(parseConnectionUrl('postgres://h/db?sslmode=verify-full')).toMatchObject({ ok: true, value: { sslMode: 'verify-full' } })
    expect(parseConnectionUrl('postgres://h/db?sslmode=verify-ca')).toMatchObject({ ok: true, value: { sslMode: 'verify-ca' } })
    expect(parseConnectionUrl('postgres://h/db?sslmode=disable')).toMatchObject({ ok: true, value: { sslMode: 'disable' } })
  })

  it('applies default ports and accepts an IPv6 host', () => {
    expect(parseConnectionUrl('postgres://localhost')).toMatchObject({ ok: true, value: { port: 5432, database: '', username: '' } })
    expect(parseConnectionUrl('mongodb://root:pw@[::1]/admin')).toMatchObject({ ok: true, value: { engine: 'mongodb', host: '::1', port: 27017, database: 'admin' } })
  })

  it('reads MongoDB options: auth source, replica set and several hosts', () => {
    const parsed = parseConnectionUrl('mongodb://u:p@a.example.com:27017,b.example.com:27018,[::1]:27019/app?authSource=admin&replicaSet=rs0')
    expect(parsed).toMatchObject({ ok: true, value: { host: 'a.example.com', port: 27017, database: 'app', mongo: { authSource: 'admin', replicaSet: 'rs0', directConnection: false, srv: false, extraHosts: ['b.example.com:27018', '[::1]:27019'] } } })
  })

  it('accepts mongodb+srv as a seed list with TLS on by default', () => {
    expect(parseConnectionUrl('mongodb+srv://u:p@cluster0.abc.mongodb.net/shop')).toMatchObject({
      ok: true, value: { engine: 'mongodb', host: 'cluster0.abc.mongodb.net', sslMode: 'require', mongo: { srv: true, directConnection: false, extraHosts: [] } }
    })
    expect(parseConnectionUrl('mongodb+srv://u:p@c.example.net/shop?tls=false')).toMatchObject({ ok: true, value: { sslMode: 'disable' } })
  })

  it('explains what it cannot handle instead of guessing', () => {
    expect(parseConnectionUrl('')).toMatchObject({ ok: false, error: 'empty' })
    expect(parseConnectionUrl('localhost:5432')).toMatchObject({ ok: false, error: 'noScheme' })
    expect(parseConnectionUrl('mysql://h/db')).toMatchObject({ ok: false, error: 'unsupported', scheme: 'mysql' })
    expect(parseConnectionUrl('postgres://a:1,b:2/db')).toMatchObject({ ok: false, error: 'severalPostgres' })
    expect(parseConnectionUrl('mongodb+srv://a.example.net,b.example.net/db')).toMatchObject({ ok: false, error: 'srvOneHost' })
    expect(parseConnectionUrl('postgres://h:99999/db')).toMatchObject({ ok: false, error: 'badHost' })
  })
})
