import { describe, expect, it } from 'vitest'
import { storedSnapshot, trustedArgs, trustedSnapshot, trustedUrl } from '../../shared/mcp-trusted'
import { checkConfig, parseGuard, summarizeGuard, trustState } from '../../electron/main/services/mcp-pin'
import type { McpServerConfig } from '../../shared/types/mcp'

const ENV_SECRET = 'env-value-9f3c1a7e'
const HEADER_SECRET = 'header-value-4b8d2e6f'
const stdio = (args: string[], env: Record<string, string> = {}): McpServerConfig => ({ transport: 'stdio', command: 'npx', args, env })
const http = (url: string, headers: Record<string, string> = {}): McpServerConfig => ({ transport: 'http', url, headers })

describe('the trusted snapshot', () => {
  it('keeps environment and header keys, sorted, and never a value', () => {
    const local = trustedSnapshot(stdio(['-y', 'pkg@1.0.0'], { Z_TOKEN: ENV_SECRET, A_REGION: 'eu-west-1-region' }))
    expect(local).toEqual({ transport: 'stdio', command: 'npx', args: ['-y', 'pkg@1.0.0'], envKeys: ['A_REGION', 'Z_TOKEN'] })
    const remote = trustedSnapshot(http('https://mcp.example.com/sse', { Authorization: `Bearer ${HEADER_SECRET}`, 'X-Team': HEADER_SECRET }))
    expect(remote).toEqual({ transport: 'http', url: 'https://mcp.example.com/sse', headerKeys: ['Authorization', 'X-Team'] })
    expect(JSON.stringify([local, remote])).not.toMatch(/env-value|header-value|eu-west-1-region/)
  })

  it('keeps origin and path of a URL: user info, query and fragment are gone', () => {
    expect(trustedUrl('https://alice:hunter2pass@mcp.example.com:8443/v1/mcp?token=qtok123&team=qteam456#frag789')).toBe('https://mcp.example.com:8443/v1/mcp')
    const snapshot = JSON.stringify(trustedSnapshot(http('https://bob:pw-secret-1@host.example/mcp?api_key=qkey-secret-2&harmless=qval-secret-3')))
    for (const secret of ['bob', 'pw-secret-1', 'qkey-secret-2', 'qval-secret-3', 'api_key']) expect(snapshot).not.toContain(secret)
    expect(trustedUrl('not a url')).toBe('[redacted]')
  })

  it('redacts the values of secret-looking flags in both forms and keeps the flag names', () => {
    const args = ['-y', 'server', '--token=argtok1', '--api-key', 'argkey2', '--client-secret', 'argsec3', '--password=argpw4', '--auth', 'argauth5',
      '--bearer', 'argbear6', '--credentials=argcred7', '--apiKey', 'argkey8', '-t', 'keep-me', '--port', '8080']
    expect(trustedArgs(args)).toEqual(['-y', 'server', '--token=[redacted]', '--api-key', '[redacted]', '--client-secret', '[redacted]', '--password=[redacted]',
      '--auth', '[redacted]', '--bearer', '[redacted]', '--credentials=[redacted]', '--apiKey', '[redacted]', '-t', 'keep-me', '--port', '8080'])
    expect(JSON.stringify(trustedSnapshot(stdio(args)))).not.toMatch(/arg(tok|key|sec|pw|auth|bear|cred)\d/)
  })

  it('leaves the next flag alone after a secret flag with no value', () => {
    expect(trustedArgs(['--token', '--verbose', 'x'])).toEqual(['--token', '--verbose', 'x'])
  })

  it('redacts NAME=value arguments, URL arguments, secret shapes and env values repeated in arguments', () => {
    const snapshot = trustedSnapshot(stdio([
      'API_KEY=assignkey1', 'mcp-remote', 'https://u:urlpw2@remote.example/sse?token=urltok3', '--header', 'Authorization: Bearer hdrtok4567890',
      'ghp_abcdefghijklmnopqrstuvwx12', `--repeat=${ENV_SECRET}`
    ], { SOME_VAR: ENV_SECRET }))
    if (snapshot.transport !== 'stdio') throw new Error('expected stdio')
    expect(snapshot.args[0]).toBe('API_KEY=[redacted]')
    expect(snapshot.args[2]).toBe('https://remote.example/sse')
    expect(snapshot.args[3]).toBe('--header')
    const text = JSON.stringify(snapshot)
    for (const secret of ['assignkey1', 'urlpw2', 'urltok3', 'hdrtok4567890', 'ghp_abcdefghijklmnopqrstuvwx12', ENV_SECRET]) expect(text).not.toContain(secret)
  })

  it('reads back only the shape it writes', () => {
    const snapshot = trustedSnapshot(stdio(['x'], { K: ENV_SECRET }))
    expect(storedSnapshot(JSON.parse(JSON.stringify(snapshot)))).toEqual(snapshot)
    expect(storedSnapshot({ transport: 'stdio', command: 'x', args: 'nope', envKeys: [] })).toBeUndefined()
    expect(storedSnapshot({ transport: 'ftp', url: 'x', headerKeys: [] })).toBeUndefined()
    expect(storedSnapshot(null)).toBeUndefined()
  })
})

describe('the guard keeps what was trusted', () => {
  const trusted = stdio(['-y', 'pkg@1.0.0', '--token', 'argsecret-trusted'], { API_TOKEN: ENV_SECRET })
  const moved = stdio(['-y', 'pkg@2.0.0', '--token', 'argsecret-moved'], { API_TOKEN: 'env-value-moved-1', EXTRA: 'env-value-moved-2' })

  it('stores the snapshot when a server is trusted', () => {
    expect(trustState(trusted, 1).trusted).toEqual({ transport: 'stdio', command: 'npx', args: ['-y', 'pkg@1.0.0', '--token', '[redacted]'], envKeys: ['API_TOKEN'] })
  })

  it('puts the trusted snapshot on the quarantine of a moved config, and no secret anywhere in it', () => {
    const verdict = checkConfig(trustState(trusted, 1), moved, 2)
    if (verdict.ok) throw new Error('expected a quarantine')
    const shown = summarizeGuard(parseGuard(JSON.stringify(verdict.state)))
    expect(shown.quarantine?.trusted).toEqual(trustedSnapshot(trusted))
    expect(shown.quarantine?.trusted).not.toEqual(trustedSnapshot(moved))
    const stored = JSON.stringify(verdict.state)
    for (const secret of [ENV_SECRET, 'env-value-moved-1', 'env-value-moved-2', 'argsecret-trusted', 'argsecret-moved']) {
      expect(stored).not.toContain(secret)
      expect(JSON.stringify(shown)).not.toContain(secret)
    }
  })

  it('replaces the snapshot when the server is trusted again', () => {
    const verdict = checkConfig(trustState(trusted, 1), moved, 2)
    const again = trustState(moved, 3, verdict.ok ? null : verdict.quarantine.observed)
    expect(again.trusted).toEqual(trustedSnapshot(moved))
    expect(again.quarantine).toBeNull()
  })

  it('loads a record written before the snapshot existed, and learns it while the config still matches', () => {
    const old = trustState(trusted, 1)
    delete old.trusted
    const legacy = JSON.stringify({ ...old, quarantine: { at: 2, reasons: ['Its command changed.'], added: [], removed: [], changed: [], observed: null } })
    const shown = summarizeGuard(parseGuard(legacy))
    expect(shown.quarantine).toMatchObject({ at: 2, reasons: ['Its command changed.'] })
    expect(shown.quarantine).not.toHaveProperty('trusted')
    const verdict = checkConfig(parseGuard(JSON.stringify(old)), trusted, 3)
    expect(verdict.ok && verdict.state.trusted).toEqual(trustedSnapshot(trusted))
  })

  it('drops a damaged snapshot instead of showing it', () => {
    const verdict = checkConfig(trustState(trusted, 1), moved, 2)
    const damaged = JSON.stringify({ ...verdict.state, trusted: { transport: 'stdio', command: 1 } })
    expect(summarizeGuard(parseGuard(damaged)).quarantine).not.toHaveProperty('trusted')
  })
})
