// Frozen acceptance test for the Claude plan label — PART 2, the live profile. NOT for any plan until the user OKs
// reading /api/oauth/profile (TECH LEAD, 08/11). Spec: docs/roadmap-1.5/ccr-claude-plan-label.md §3b.
// The profile fixture is PROVISIONAL until the user's probe (scripts/claude-plan-probe.mjs) confirms the field.
// Temp credentials file and a stubbed fetch only: never the user's ~/.claude, never the network.
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

vi.mock('electron', () => ({ app: { getVersion: () => '1.5.0-test', isPackaged: false } }))

const { ClaudeCreditsService, PROFILE_URL, USAGE_URL } = await import('../../../electron/main/services/agentCredits/claudeCredits.service')
const { planChip } = await import('../../../shared/agent-plan')

const TOKEN = 'test-token-not-real-0123456789'
let dir: string
let calls: string[]
let profile: { status: number; body?: unknown }

function credentials(oauth: Record<string, unknown>): string {
  const file = join(dir, '.credentials.json')
  writeFileSync(file, JSON.stringify({ claudeAiOauth: { accessToken: TOKEN, expiresAt: Date.now() + 3_600_000, ...oauth } }))
  return file
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'oxe-plan-'))
  calls = []
  profile = { status: 404 }
  vi.stubGlobal('fetch', vi.fn(async (url: string | URL) => {
    const href = String(url)
    calls.push(href)
    if (href === USAGE_URL) return new Response(JSON.stringify({ five_hour: { utilization: 12, resets_at: Date.now() + 3_600_000 }, seven_day: { utilization: 30 } }), { status: 200 })
    if (href === PROFILE_URL) return new Response(profile.body === undefined ? null : JSON.stringify(profile.body), { status: profile.status })
    return new Response(null, { status: 599 })
  }))
})
afterEach(() => { vi.unstubAllGlobals(); rmSync(dir, { recursive: true, force: true }) })

describe('Claude plan label, part 2: the live plan wins', () => {
  test('the endpoints are Anthropic\'s, and the token goes nowhere else', () => {
    expect(USAGE_URL).toBe('https://api.anthropic.com/api/oauth/usage')
    expect(PROFILE_URL).toBe('https://api.anthropic.com/api/oauth/profile')
  })

  test('credentials say "pro" (from sign-in) but the live profile says Max 20x: the live one wins', async () => {
    profile = { status: 200, body: { account: { has_claude_max: true, has_claude_pro: false }, organization: { organization_type: 'claude_max', rate_limit_tier: 'default_claude_max_20x' } } }
    const snapshot = await new ClaudeCreditsService(credentials({ subscriptionType: 'pro', subscriptionTypeSource: 'sign_in' })).getCredits(true)
    expect(snapshot).toMatchObject({ available: true, planLabel: 'Max 20x', planSource: 'live' })
    expect(planChip(snapshot)).toEqual({ text: 'Max 20x', mayBeStale: false })
    expect(JSON.stringify(snapshot)).not.toContain(TOKEN)
    expect(calls.every(url => url.startsWith('https://api.anthropic.com/'))).toBe(true)
  })

  test('a profile that fails or is malformed falls back to the possibly stale cached plan, and usage still shows', async () => {
    for (const next of [{ status: 404 }, { status: 500 }, { status: 200, body: { unexpected: true } }, { status: 200, body: 'not json' }]) {
      profile = next
      const snapshot = await new ClaudeCreditsService(credentials({ subscriptionType: 'max' })).getCredits(true)
      expect(snapshot, JSON.stringify(next)).toMatchObject({ available: true, planLabel: 'Max', planSource: 'sign-in' })
      expect(snapshot.windows.length).toBeGreaterThan(0)
    }
  })

  test('an unknown live value shows nothing, and never falls back to the stale cache', async () => {
    profile = { status: 200, body: { organization: { organization_type: 'claude_quantum' } } }
    const snapshot = await new ClaudeCreditsService(credentials({ subscriptionType: 'pro' })).getCredits(true)
    expect(snapshot).toMatchObject({ planLabel: null, planSource: 'live' })
    expect(planChip(snapshot)).toBeNull()
  })

  test('the profile is read at most once an hour; usage keeps its own cadence', async () => {
    profile = { status: 200, body: { organization: { organization_type: 'claude_pro' } } }
    const service = new ClaudeCreditsService(credentials({ subscriptionType: 'pro' }))
    await service.getCredits(true); await service.getCredits(true); await service.getCredits(true)
    expect(calls.filter(url => url === PROFILE_URL)).toHaveLength(1)
    expect(calls.filter(url => url === USAGE_URL)).toHaveLength(3)
  })
})
