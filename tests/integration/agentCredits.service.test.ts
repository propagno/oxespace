import { mkdtempSync, mkdirSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

// Electron's `app.getVersion()` is used as fallback for the Claude User-Agent header.
vi.mock('electron', () => ({ app: { getVersion: () => '9.9.9' } }))

import { AgentCreditsService } from '../../electron/main/services/agentCredits'
import { CodexCreditsService, isWindowExpiredSinceObservation } from '../../electron/main/services/agentCredits/codexCredits.service'
import { ClaudeCreditsService } from '../../electron/main/services/agentCredits/claudeCredits.service'
import { removeTempDir } from '../helpers/removeTempDir'

// ── Codex ────────────────────────────────────────────────────────────────────

/** Build a one-line rollout JSONL with a token_count event carrying rate_limits. */
function rolloutLine(rateLimits: unknown): string {
  return JSON.stringify({
    timestamp: '2026-05-28T18:55:49.537Z',
    type: 'event_msg',
    payload: { type: 'token_count', info: { model_context_window: 258400 }, rate_limits: rateLimits }
  })
}

describe('CodexCreditsService', () => {
  let root: string
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'codex-credits-'))
  })
  afterEach(() => {
    removeTempDir(root)
  })

  function writeRollout(name: string, lines: string[]): void {
    const dir = join(root, '2026', '05', '28')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, name), lines.join('\n'))
  }

  test('parses the weekly window (secondary) as the displayed value, with absolute resets_at', async () => {
    writeRollout('rollout-a.jsonl', [
      rolloutLine({
        plan_type: 'plus',
        primary: { used_percent: 55, window_minutes: 300, resets_at: 1780001724 },
        secondary: { used_percent: 48, window_minutes: 10080, resets_at: 1780180553 }
      })
    ])
    const snap = await new CodexCreditsService(root).getCredits(true)
    expect(snap.available).toBe(true)
    expect(snap.installed).toBe(true)
    expect(snap.planLabel).toBe('plus')
    expect(snap.display).toEqual({ kind: 'weekly', usedPct: 48, resetsAtMs: 1780001724_000 + (1780180553 - 1780001724) * 1000 })
    expect(snap.windows.map((w) => w.kind)).toEqual(['session', 'weekly'])
  })

  test('handles the relative resets_in_seconds form', async () => {
    const before = Date.now()
    writeRollout('rollout-b.jsonl', [
      rolloutLine({
        primary: { used_percent: 10, window_minutes: 300, resets_in_seconds: 3600 },
        secondary: { used_percent: 20, window_minutes: 10080, resets_in_seconds: 7200 }
      })
    ])
    const snap = await new CodexCreditsService(root).getCredits(true)
    expect(snap.display?.usedPct).toBe(20)
    expect(snap.display?.resetsAtMs).toBeGreaterThanOrEqual(before + 7200 * 1000)
  })

  test('uses the last rate_limits event in a file (most recent wins)', async () => {
    writeRollout('rollout-c.jsonl', [
      rolloutLine({ primary: { used_percent: 5, window_minutes: 300, resets_at: 1 }, secondary: { used_percent: 5, window_minutes: 10080, resets_at: 2 } }),
      rolloutLine({ primary: { used_percent: 90, window_minutes: 300, resets_at: 1 }, secondary: { used_percent: 80, window_minutes: 10080, resets_at: 2 } })
    ])
    const snap = await new CodexCreditsService(root).getCredits(true)
    expect(snap.display?.usedPct).toBe(80)
  })

  test('missing sessions dir → unavailable, not installed', async () => {
    const snap = await new CodexCreditsService(join(root, 'nope')).getCredits(true)
    expect(snap.available).toBe(false)
    expect(snap.installed).toBe(false)
  })

  test('isWindowExpiredSinceObservation distinguishes real expired windows from historical fixtures', () => {
    const observed = Date.parse('2026-11-12T18:00:00Z')
    const now = Date.parse('2026-11-25T18:00:00Z')
    // Real past session: reset was in the future when observed, and has passed by now.
    expect(isWindowExpiredSinceObservation({ kind: 'session', usedPct: 5, resetsAtMs: observed + 5 * 3_600_000 }, observed, now)).toBe(true)
    // Still active: reset is in the future relative to now.
    expect(isWindowExpiredSinceObservation({ kind: 'weekly', usedPct: 12, resetsAtMs: now + 3_600_000 }, observed, now)).toBe(false)
    // Static historical fixture: observedAtMs >= resetsAtMs.
    expect(isWindowExpiredSinceObservation({ kind: 'weekly', usedPct: 48, resetsAtMs: 1_780_001_724_000 }, now, now)).toBe(false)
    // Unknown reset time: not provably expired.
    expect(isWindowExpiredSinceObservation({ kind: 'session', usedPct: 5, resetsAtMs: null }, observed, now)).toBe(false)
  })

  test('all expired windows in an old rollout → unavailable with windowsExpired flag and planLabel intact', async () => {
    const observed = Date.parse('2026-11-12T18:00:00Z')
    const now = Date.parse('2026-11-25T18:00:00Z')
    const dir = join(root, '2026', '11', '12')
    mkdirSync(dir, { recursive: true })
    const filePath = join(dir, 'rollout-old.jsonl')
    writeFileSync(filePath, rolloutLine({
      plan_type: 'free',
      primary: { used_percent: 5, window_minutes: 300, resets_at: Math.floor((observed + 5 * 3_600_000) / 1000) },
      secondary: { used_percent: 5, window_minutes: 10080, resets_at: Math.floor((observed + 7 * 86_400_000) / 1000) }
    }))
    const observedDate = new Date(observed)
    utimesSync(filePath, observedDate, observedDate)

    const snap = await new CodexCreditsService(root, () => now).getCredits(true)
    expect(snap).toMatchObject({
      provider: 'codex',
      available: false,
      installed: true,
      planLabel: 'free',
      display: null,
      windows: [],
      source: 'local-session',
      stale: false,
      error: null,
      windowsExpired: true
    })
    expect(snap.observedAtMs).toBeCloseTo(observed, -3)
  })

  test('partially expired rollout drops only the expired 5h window and keeps the active weekly window', async () => {
    const observed = Date.parse('2026-11-24T12:00:00Z')
    const now = Date.parse('2026-11-25T12:00:00Z')
    const sessionResetSec = Math.floor((observed + 5 * 3_600_000) / 1000)
    const weeklyResetSec = Math.floor((now + 4 * 86_400_000) / 1000)
    const dir = join(root, '2026', '11', '24')
    mkdirSync(dir, { recursive: true })
    const filePath = join(dir, 'rollout-partial.jsonl')
    writeFileSync(filePath, rolloutLine({
      plan_type: 'plus',
      primary: { used_percent: 30, window_minutes: 300, resets_at: sessionResetSec },
      secondary: { used_percent: 18, window_minutes: 10080, resets_at: weeklyResetSec }
    }))
    const observedDate = new Date(observed)
    utimesSync(filePath, observedDate, observedDate)

    const snap = await new CodexCreditsService(root, () => now).getCredits(true)
    expect(snap.available).toBe(true)
    expect(snap.windowsExpired).toBeUndefined()
    expect(snap.windows).toEqual([{ kind: 'weekly', usedPct: 18, resetsAtMs: weeklyResetSec * 1000 }])
    expect(snap.display).toEqual({ kind: 'weekly', usedPct: 18, resetsAtMs: weeklyResetSec * 1000 })
  })
})

// ── Claude ───────────────────────────────────────────────────────────────────

describe('ClaudeCreditsService', () => {
  let root: string
  let credsPath: string
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'claude-credits-'))
    credsPath = join(root, '.credentials.json')
    writeFileSync(credsPath, JSON.stringify({ claudeAiOauth: { accessToken: 'tok-123', subscriptionType: 'max' } }))
  })
  afterEach(() => {
    removeTempDir(root)
    vi.unstubAllGlobals()
  })

  test('calls the usage endpoint with the real Claude CLI User-Agent (cached once) and shows the weekly window', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        five_hour: { utilization: 0.55, resets_at: '2026-05-28T20:00:00Z' },
        seven_day: { utilization: 0.48, resets_at: '2026-05-30T00:00:00Z' }
      })
    }))
    const cliVersion = vi.fn(async () => '2.1.331 (Claude Code)\n')
    vi.stubGlobal('fetch', fetchMock)

    const service = new ClaudeCreditsService(credsPath, { cliVersion })
    const snap = await service.getCredits(true)
    expect(snap.available).toBe(true)
    expect(snap.planLabel).toBe('max')
    expect(snap.display).toEqual({ kind: 'weekly', usedPct: 48, resetsAtMs: Date.parse('2026-05-30T00:00:00Z') })

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toContain('/api/oauth/usage')
    const headers = init.headers as Record<string, string>
    expect(headers.Authorization).toBe('Bearer tok-123')
    expect(headers['anthropic-beta']).toBe('oauth-2025-04-20')
    expect(headers['User-Agent']).toBe('claude-code/2.1.331')

    await service.getCredits(true)
    expect(cliVersion).toHaveBeenCalledTimes(1)
  })

  test('falls back to app.getVersion() in User-Agent when claude --version fails', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ five_hour: { utilization: 0.1 } })
    }))
    vi.stubGlobal('fetch', fetchMock)

    await new ClaudeCreditsService(credsPath, { cliVersion: async () => { throw new Error('ENOENT') } }).getCredits(true)
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect((init.headers as Record<string, string>)['User-Agent']).toBe('claude-code/9.9.9')
  })

  test('expired OAuth credentials → oauth_expired without calling fetch', async () => {
    const now = Date.parse('2026-11-25T12:00:00Z')
    writeFileSync(credsPath, JSON.stringify({
      claudeAiOauth: { accessToken: 'tok-expired', subscriptionType: 'pro', expiresAt: now - 60_000 }
    }))
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const snap = await new ClaudeCreditsService(credsPath, { cliVersion: async () => '2.1.331', now: () => now }).getCredits(true)
    expect(snap).toMatchObject({ installed: true, available: false, planLabel: 'pro', error: 'oauth_expired' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  test('401 → unavailable but installed (token present, endpoint rejected)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 401, json: async () => ({}) })))
    const snap = await new ClaudeCreditsService(credsPath, { cliVersion: async () => '2.1.331' }).getCredits(true)
    expect(snap.installed).toBe(true)
    expect(snap.available).toBe(false)
    expect(snap.error).toMatch(/401/)
  })

  test('429 → exposes retryAtMs and makes no further request, even forced, until Retry-After passes', async () => {
    const startNow = Date.parse('2026-10-19T12:00:00Z')
    vi.useFakeTimers({ now: startNow })
    try {
      const fetchMock = vi.fn(async () => ({ ok: false, status: 429, headers: { get: (name: string) => name === 'retry-after' ? '300' : null }, json: async () => ({}) }))
      vi.stubGlobal('fetch', fetchMock)
      const service = new ClaudeCreditsService(credsPath, { cliVersion: async () => '2.1.331' })
      const first = await service.getCredits(true)
      expect(first.error).toMatch(/429/)
      expect(first.retryAtMs).toBe(startNow + 300_000)
      vi.advanceTimersByTime(120_000)
      const duringBackoff = await service.getCredits(true)
      expect(duringBackoff.retryAtMs).toBe(startNow + 300_000)
      expect(fetchMock).toHaveBeenCalledTimes(1)
      vi.advanceTimersByTime(181_000)
      await service.getCredits(true)
      expect(fetchMock).toHaveBeenCalledTimes(2)
    } finally { vi.useRealTimers() }
  })

  test('missing credentials → unavailable, not installed, no fetch', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const snap = await new ClaudeCreditsService(join(root, 'absent.json'), { cliVersion: async () => '2.1.331' }).getCredits(true)
    expect(snap.installed).toBe(false)
    expect(snap.available).toBe(false)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  test('AgentCreditsService clears lastGood on oauth_expired and forwards retryAtMs on 429 stale fallback', async () => {
    const now = Date.now()
    const good = {
      provider: 'claude' as const,
      available: true,
      installed: true,
      planLabel: 'max',
      display: { kind: 'weekly' as const, usedPct: 20, resetsAtMs: now + 3_600_000 },
      windows: [{ kind: 'weekly' as const, usedPct: 20, resetsAtMs: now + 3_600_000 }],
      source: 'oauth' as const,
      observedAtMs: now,
      error: null
    }
    let next = good as Awaited<ReturnType<ClaudeCreditsService['getCredits']>>
    const dispatcher = new AgentCreditsService([{ provider: 'claude', getCredits: async () => next }])

    expect((await dispatcher.getCredits('claude', true)).available).toBe(true)

    next = { ...good, available: false, display: null, windows: [], error: 'usage endpoint 429', retryAtMs: now + 180_000 }
    const stale429 = await dispatcher.getCredits('claude', true)
    expect(stale429.available).toBe(true)
    expect(stale429.stale).toBe(true)
    expect(stale429.retryAtMs).toBe(now + 180_000)

    next = { ...good, available: false, display: null, windows: [], error: 'oauth_expired' }
    const expired = await dispatcher.getCredits('claude', true)
    expect(expired.available).toBe(false)
    expect(expired.error).toBe('oauth_expired')
  })
})
