import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

// Electron's `app.getVersion()` is used for the Claude User-Agent header.
vi.mock('electron', () => ({ app: { getVersion: () => '9.9.9' } }))

import { CodexCreditsService } from '../../electron/main/services/agentCredits/codexCredits.service'
import { ClaudeCreditsService } from '../../electron/main/services/agentCredits/claudeCredits.service'

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
    rmSync(root, { recursive: true, force: true })
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
    rmSync(root, { recursive: true, force: true })
    vi.unstubAllGlobals()
  })

  test('calls the usage endpoint with the required headers and shows the weekly window', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        five_hour: { utilization: 0.55, resets_at: '2026-05-28T20:00:00Z' },
        seven_day: { utilization: 0.48, resets_at: '2026-05-30T00:00:00Z' }
      })
    }))
    vi.stubGlobal('fetch', fetchMock)

    const snap = await new ClaudeCreditsService(credsPath).getCredits(true)
    expect(snap.available).toBe(true)
    expect(snap.planLabel).toBe('max')
    expect(snap.display).toEqual({ kind: 'weekly', usedPct: 48, resetsAtMs: Date.parse('2026-05-30T00:00:00Z') })

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toContain('/api/oauth/usage')
    const headers = init.headers as Record<string, string>
    expect(headers.Authorization).toBe('Bearer tok-123')
    expect(headers['anthropic-beta']).toBe('oauth-2025-04-20')
    expect(headers['User-Agent']).toBe('claude-code/9.9.9')
  })

  test('401 → unavailable but installed (token present, endpoint rejected)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 401, json: async () => ({}) })))
    const snap = await new ClaudeCreditsService(credsPath).getCredits(true)
    expect(snap.installed).toBe(true)
    expect(snap.available).toBe(false)
    expect(snap.error).toMatch(/401/)
  })

  test('missing credentials → unavailable, not installed, no fetch', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const snap = await new ClaudeCreditsService(join(root, 'absent.json')).getCredits(true)
    expect(snap.installed).toBe(false)
    expect(snap.available).toBe(false)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
