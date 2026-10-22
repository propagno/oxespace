import { beforeEach, describe, expect, it, vi } from 'vitest'
import { compatibilityBadge, type ProviderCompatibility } from '../../shared/providerCompatibility'
import { COMPATIBILITY_URL, parseCompatibility, providerCompatibility, resetProviderCompatibilityCache } from '../../electron/main/services/provider-compatibility'

const summary = (ok = true): ProviderCompatibility => ({
  checkedAt: '2026-10-22T06:20:00Z', ok,
  providers: { claude: { ok, versions: { 'ubuntu-latest': '2.1.306', 'windows-latest': '2.1.306' } }, codex: { ok: true, versions: { 'ubuntu-latest': '0.163.0' } } }
})

describe('provider contract badge', () => {
  it('says whether the installed CLI is the checked one, newer, or failing', () => {
    expect(compatibilityBadge('claude', '2.1.306 (Claude Code)', summary())).toMatchObject({ state: 'verified', label: 'Checked' })
    expect(compatibilityBadge('claude', '2.1.200 (Claude Code)', summary())?.state).toBe('verified')
    expect(compatibilityBadge('claude', '2.2.0 (Claude Code)', summary())).toMatchObject({ state: 'newer', title: expect.stringContaining('newer than 2.1.306') })
    expect(compatibilityBadge('codex', 'codex-cli 0.163.0', summary())?.state).toBe('verified')
    expect(compatibilityBadge('claude', '2.1.306', summary(false))).toMatchObject({ state: 'failing', title: expect.stringContaining('2026-10-22') })
    expect(compatibilityBadge('claude', 'unknown', summary())?.state).toBe('unknown')
  })

  it('shows nothing for providers the check does not cover, or without a result', () => {
    expect(compatibilityBadge('cursor', '1.0.0', summary())).toBeNull()
    expect(compatibilityBadge('claude', '2.1.306', null)).toBeNull()
  })
})

describe('reading the published result', () => {
  beforeEach(() => resetProviderCompatibilityCache())

  it('keeps only well-formed entries', () => {
    expect(parseCompatibility({ ok: true, checkedAt: 'x', providers: { claude: { ok: true, versions: { linux: '1.0.0', windows: 7 } }, broken: { ok: 'yes' } } }))
      .toEqual({ ok: true, checkedAt: 'x', providers: { claude: { ok: true, versions: { linux: '1.0.0', windows: null } } } })
    expect(parseCompatibility('nonsense')).toBeNull()
  })

  it('reads it once every few hours and never throws when offline', async () => {
    const fetcher = vi.fn(async () => ({ ok: true, json: async () => summary() }) as unknown as Response)
    expect((await providerCompatibility(fetcher, 0))?.providers.claude.ok).toBe(true)
    await providerCompatibility(fetcher, 60_000)
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(fetcher).toHaveBeenCalledWith(COMPATIBILITY_URL, expect.anything())
    resetProviderCompatibilityCache()
    expect(await providerCompatibility(vi.fn(async () => { throw Error('offline') }), 0)).toBeNull()
  })
})
