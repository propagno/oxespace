import { describe, expect, it } from 'vitest'
import { splitHostInput } from '../../shared/oxequeryHost'
import { normalizeConnectionInput } from '../../electron/main/services/oxequery/connection-store'

describe('a host as people paste it', () => {
  it('keeps the name and the port of a URL, an address with a user, or a trailing path', () => {
    expect(splitHostInput('https://sdz-platform-b2b-dev.cnc4.us-east-1.rds.amazonaws.com')).toEqual({ host: 'sdz-platform-b2b-dev.cnc4.us-east-1.rds.amazonaws.com' })
    expect(splitHostInput('postgres://me@db.example.com:6543/app?sslmode=require')).toEqual({ host: 'db.example.com', port: 6543 })
    expect(splitHostInput(' db.example.com/ ')).toEqual({ host: 'db.example.com' })
    expect(splitHostInput('[::1]:5433')).toEqual({ host: '::1', port: 5433 })
    expect(splitHostInput('10.0.0.5')).toEqual({ host: '10.0.0.5' })
    expect(splitHostInput('::1')).toEqual({ host: '::1' })
    // Typed as a host, a user name is not silently dropped: it is refused when saved.
    expect(splitHostInput('user@db.example.com')).toEqual({ host: 'user@db.example.com' })
  })

  it('is applied when a connection is saved', () => {
    const saved = normalizeConnectionInput({ name: 'rds', engine: 'postgres', host: 'https://db.example.com:6543/', port: 5432, database: 'app', username: 'me' })
    expect(saved).toMatchObject({ host: 'db.example.com', port: 6543 })
  })
})

describe('TLS from a pasted connection string', () => {
  it('uses TLS when offered for PostgreSQL without sslmode, as libpq does', async () => {
    const { parseConnectionUrl } = await import('../../src/components/OxeQuery/connection-url')
    const plain = parseConnectionUrl('postgres://me@db.example.com/app')
    expect(plain.ok && plain.value.sslMode).toBe('prefer')
    const off = parseConnectionUrl('postgres://me@db.example.com/app?sslmode=disable')
    expect(off.ok && off.value.sslMode).toBe('disable')
    const mongo = parseConnectionUrl('mongodb://db.example.com/app')
    expect(mongo.ok && mongo.value.sslMode).toBe('disable')
  })
})
