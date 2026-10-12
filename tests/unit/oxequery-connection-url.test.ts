import { describe, expect, it } from 'vitest'
import { parseConnectionUrl } from '../../src/components/OxeQuery/connection-url'

describe('connection string parsing', () => {
  it('reads a PostgreSQL URL with encoded credentials and TLS', () => {
    expect(parseConnectionUrl('postgresql://app%40corp:p%2Fw%3A1@db.internal:6543/shop?sslmode=require')).toEqual({
      ok: true, value: { engine: 'postgres', host: 'db.internal', port: 6543, database: 'shop', username: 'app@corp', password: 'p/w:1', sslMode: 'require' }
    })
  })

  it('applies default ports and accepts an IPv6 host', () => {
    expect(parseConnectionUrl('postgres://localhost')).toMatchObject({ ok: true, value: { port: 5432, database: '', username: '' } })
    expect(parseConnectionUrl('mongodb://root:pw@[::1]/admin')).toMatchObject({ ok: true, value: { engine: 'mongodb', host: '::1', port: 27017, database: 'admin' } })
  })

  it('explains what it cannot handle instead of guessing', () => {
    expect(parseConnectionUrl('')).toMatchObject({ ok: false })
    expect(parseConnectionUrl('localhost:5432')).toMatchObject({ ok: false, error: expect.stringContaining('starts with') })
    expect(parseConnectionUrl('mysql://h/db')).toMatchObject({ ok: false, error: expect.stringContaining('Unsupported') })
    expect(parseConnectionUrl('mongodb+srv://cluster.example.net/db')).toMatchObject({ ok: false, error: expect.stringContaining('DNS') })
    expect(parseConnectionUrl('mongodb://a:1,b:2/db')).toMatchObject({ ok: false, error: expect.stringContaining('Several hosts') })
  })
})
