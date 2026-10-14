import { describe, expect, it } from 'vitest'
import { connectionHint } from '../../electron/main/services/oxequery/connect-hint'

describe('connectionHint', () => {
  it('points at TLS when a managed server refuses a plain connection', () => {
    const message = 'no pg_hba.conf entry for host "10.0.0.5", user "app", database "db", no encryption'
    expect(connectionHint(message, { engine: 'postgres', sslMode: 'disable' })).toMatch(/Security \(TLS\)/)
    expect(connectionHint('SSL connection is required', { engine: 'postgres', sslMode: 'prefer' })).toMatch(/require/)
  })

  it('says nothing when TLS is already on or the failure is something else', () => {
    expect(connectionHint('no encryption', { engine: 'postgres', sslMode: 'verify-full' })).toBe('')
    expect(connectionHint('password authentication failed for user "app"', { engine: 'postgres', sslMode: 'disable' })).toBe('')
  })

  it('points at the CA when a verified connection meets an untrusted certificate', () => {
    expect(connectionHint('self-signed certificate in certificate chain', { engine: 'postgres', sslMode: 'verify-full' })).toMatch(/CA certificate/)
    expect(connectionHint('self-signed certificate', { engine: 'postgres', sslMode: 'require' })).toBe('')
  })
})
