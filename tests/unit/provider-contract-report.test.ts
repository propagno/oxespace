import { describe, expect, it } from 'vitest'
// @ts-expect-error -- a plain ES module script without type declarations
import { issueBody, summarize, versionOf } from '../../scripts/provider-contract-report.mjs'

const run = (os: string, ok: boolean) => ({ os, checkedAt: `2026-11-0${ok ? 2 : 1}T06:20:00Z`, reports: [
  { provider: 'claude', version: '2.4.0', results: [{ name: 'initialize', ok: true, required: true }, { name: 'interrupt with cancel_queued', ok, required: true, detail: ok ? undefined : 'unknown subtype' }] },
  { provider: 'codex', version: '0.80.0', results: [{ name: 'mcpServerStatus/list', ok: false, required: false }] }
] })

describe('provider contract report', () => {
  it('passes when every required check passed on every expected OS; optional checks do not count', () => {
    const summary = summarize([run('ubuntu-latest', true), run('windows-latest', true)], ['ubuntu-latest', 'windows-latest'])
    expect(summary.ok).toBe(true)
    expect(summary.providers.claude).toEqual({ versions: { 'ubuntu-latest': '2.4.0', 'windows-latest': '2.4.0' }, ok: true })
    expect(summary.checkedAt).toBe('2026-11-02T06:20:00Z')
  })

  it('names each failed required check, and a missing report is a failure', () => {
    const summary = summarize([run('ubuntu-latest', false)], ['ubuntu-latest', 'windows-latest'])
    expect(summary.ok).toBe(false)
    expect(summary.failures).toEqual([
      expect.objectContaining({ os: 'windows-latest', check: 'no report was produced' }),
      { os: 'ubuntu-latest', provider: 'claude', version: '2.4.0', check: 'interrupt with cancel_queued', detail: 'unknown subtype' }
    ])
    expect(issueBody(summary, 'https://run')).toContain('**claude 2.4.0** on ubuntu-latest: interrupt with cancel_queued — unknown subtype')
    expect(summarize([], []).ok).toBe(false)
  })

  it('keeps the version alone when a CLI reports it inside a user agent', () => {
    expect(versionOf('oxespace-probe/0.163.0 (Ubuntu 24.4.0; x86_64) unknown (oxespace-probe; 0)')).toBe('0.163.0')
    expect(versionOf('2.1.306')).toBe('2.1.306')
    expect(versionOf('1.0.0-beta.2 (Windows)')).toBe('1.0.0-beta.2')
    expect(versionOf(null)).toBeNull()
  })
})
