// Frozen acceptance test for the 1.5.0 bug "the usage popover says Claude · Pro on an Ultra plan".
// Spec: docs/roadmap-1.5/ccr-claude-plan-label.md. Written by the planner; the executor must not edit it.
// Temp credentials file and a stubbed fetch only: never the user's ~/.claude, never the network.
// The live profile fixture below follows the spec's §2 shape and is PROVISIONAL until the user's probe confirms it.
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

vi.mock('electron', () => ({ app: { getVersion: () => '1.5.0-test', isPackaged: false } }))

const { ClaudeCreditsService, PROFILE_URL, USAGE_URL } = await import('../../../electron/main/services/agentCredits/claudeCredits.service')
const { claudePlanName, planChip } = await import('../../../shared/agent-plan')

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

describe('Claude plan label: live first, never a stale plan stated as fact', () => {
  test('the endpoints are Anthropic\'s, and the token goes nowhere else', () => {
    expect(USAGE_URL).toBe('https://api.anthropic.com/api/oauth/usage')
    expect(PROFILE_URL).toBe('https://api.anthropic.com/api/oauth/profile')
  })

  test('credentials say "pro" (from sign-in) but the live profile says Max 20x: the live one wins', async () => {
    profile = { status: 200, body: { account: { has_claude_max: true, has_claude_pro: false }, organization: { organization_type: 'claude_max', rate_limit_tier: 'default_claude_max_20x' } } }
    const snapshot = await new ClaudeCreditsService(credentials({ subscriptionType: 'pro', subscriptionTypeSource: 'sign_in' })).getCredits(true)
    expect(snapshot).toMatchObject({ available: true, planLabel: 'Max 20x', planSource: 'live' })
    expect(JSON.stringify(snapshot)).not.toContain(TOKEN)
    expect(calls.every(url => url.startsWith('https://api.anthropic.com/'))).toBe(true)
  })

  test('no live source (profile 404): the cached plan is shown as possibly stale, never as fact', async () => {
    const snapshot = await new ClaudeCreditsService(credentials({ subscriptionType: 'pro', subscriptionTypeSource: 'sign_in' })).getCredits(true)
    expect(snapshot).toMatchObject({ available: true, planLabel: 'Pro', planSource: 'sign-in' })
    expect(planChip(snapshot)).toEqual({ text: 'Pro', mayBeStale: true })
  })

  test('a profile that fails or is malformed falls back the same way, and the usage numbers still show', async () => {
    for (const next of [{ status: 500 }, { status: 200, body: { unexpected: true } }, { status: 200, body: 'not json' }]) {
      profile = next
      const snapshot = await new ClaudeCreditsService(credentials({ subscriptionType: 'max' })).getCredits(true)
      expect(snapshot, JSON.stringify(next)).toMatchObject({ available: true, planLabel: 'Max', planSource: 'sign-in' })
      expect(snapshot.windows.length).toBeGreaterThan(0)
    }
  })

  test('an unknown plan value shows nothing rather than a guess, live or cached', async () => {
    profile = { status: 200, body: { organization: { organization_type: 'claude_quantum' } } }
    const live = await new ClaudeCreditsService(credentials({ subscriptionType: 'pro' })).getCredits(true)
    expect(live).toMatchObject({ planLabel: null, planSource: 'live' })
    expect(planChip(live)).toBeNull()
    profile = { status: 404 }
    const cached = await new ClaudeCreditsService(credentials({ subscriptionType: 'ultra-secret-tier-xyz' })).getCredits(true)
    expect(cached).toMatchObject({ planLabel: null, planSource: null })
    expect(planChip(cached)).toBeNull()
  })

  test('the profile is read at most once an hour; usage keeps its own 60 s cache', async () => {
    profile = { status: 200, body: { organization: { organization_type: 'claude_pro' } } }
    const service = new ClaudeCreditsService(credentials({ subscriptionType: 'pro' }))
    await service.getCredits(true); await service.getCredits(true); await service.getCredits(true)
    expect(calls.filter(url => url === PROFILE_URL)).toHaveLength(1)
    expect(calls.filter(url => url === USAGE_URL)).toHaveLength(3)
  })

  test('display names come from a fixed map, not the raw string', () => {
    expect(['pro', 'max', 'team', 'enterprise'].map(claudePlanName)).toEqual(['Pro', 'Max', 'Team', 'Enterprise'])
    expect(['claude_pro', 'claude_max', 'claude_team', 'claude_enterprise'].map(claudePlanName)).toEqual(['Pro', 'Max', 'Team', 'Enterprise'])
    expect([undefined, null, '', 'PRO ', 'claude_quantum', 42, '<b>pro</b>'].map(claudePlanName)).toEqual([null, null, null, null, null, null, null])
    expect(planChip({ planLabel: 'Max 5x', planSource: 'live' })).toEqual({ text: 'Max 5x', mayBeStale: false })
    expect(planChip({ planLabel: null, planSource: 'sign-in' })).toBeNull()
  })
})
