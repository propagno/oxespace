// Frozen acceptance test for the Claude plan label — PART 2, the live profile (task BUG-PLAN-2, after part 1).
// Approved under the user's delegation (team/delegation.md, 08/11): reading /api/oauth/profile at most hourly.
// Spec: docs/roadmap-1.5/ccr-claude-plan-label.md §3b. Written by the planner; the executor must not edit it.
// Fixtures follow the REAL response shapes read by TECH LEAD's probe on 08/11; every value is fake except the plan
// fields. Temp credentials file and a stubbed fetch only: never the user's ~/.claude, never the network.
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

vi.mock('electron', () => ({ app: { getVersion: () => '1.5.0-test', isPackaged: false } }))

const { ClaudeCreditsService, PROFILE_URL, USAGE_URL } = await import('../../../electron/main/services/agentCredits/claudeCredits.service')
const { planChip } = await import('../../../shared/agent-plan')

const TOKEN = 'test-token-not-real-0123456789'
const PRIVATE = ['fake.person@example.test', 'Fake Person', '00000000-1111-2222-3333-444444444444', 'Fake Org', '55555555-6666-7777-8888-999999999999']
let dir: string
let calls: string[]
let profile: { status: number; body?: unknown }

/** The real /api/oauth/usage shape (08/11): no plan field, five_hour null on this plan, plus limits[] and spend. */
const USAGE_BODY = {
  five_hour: null,
  seven_day: { utilization: 30, resets_at: '2026-11-12T00:00:00Z' },
  limits: [{ kind: 'weekly', group: 'all', percent: 30, severity: 'normal', resets_at: '2026-11-12T00:00:00Z', is_active: true }],
  spend: null,
  extra_usage: null
}

/** The real /api/oauth/profile shape (08/11). Identity fields are fake; the plan fields are as read. */
function profileBody(organization: Record<string, unknown>, account: Record<string, unknown> = { has_claude_max: true, has_claude_pro: false }) {
  return {
    account: { uuid: PRIVATE[2], email: PRIVATE[0], full_name: PRIVATE[1], display_name: PRIVATE[1], ...account },
    organization: { uuid: PRIVATE[4], name: PRIVATE[3], ...organization }
  }
}
const ULTRA = { organization_type: 'claude_max', rate_limit_tier: 'default_claude_max_20x', subscription_status: 'active', billing_type: 'stripe_subscription', plan_display_name: 'Ultra', plan_display_label: 'Ultra plan' }

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
    if (href === USAGE_URL) return new Response(JSON.stringify(USAGE_BODY), { status: 200 })
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

  test('the user\'s case: credentials say "pro" from sign-in, the profile says "Ultra" → "Ultra", live', async () => {
    profile = { status: 200, body: profileBody(ULTRA) }
    const snapshot = await new ClaudeCreditsService(credentials({ subscriptionType: 'pro', subscriptionTypeSource: 'sign_in' })).getCredits(true)
    expect(snapshot).toMatchObject({ available: true, planLabel: 'Ultra', planSource: 'live' })
    expect(planChip(snapshot)).toEqual({ text: 'Ultra', mayBeStale: false })
    expect(snapshot.windows.length).toBeGreaterThan(0)
    expect(calls.every(url => url.startsWith('https://api.anthropic.com/'))).toBe(true)
  })

  test('nothing private from the profile, and never the token, reaches the snapshot', async () => {
    profile = { status: 200, body: profileBody(ULTRA) }
    const json = JSON.stringify(await new ClaudeCreditsService(credentials({ subscriptionType: 'pro' })).getCredits(true))
    for (const value of [TOKEN, ...PRIVATE, 'stripe_subscription', 'Ultra plan']) expect(json, value).not.toContain(value)
  })

  test('without plan_display_name, the fixed map over organization_type and rate_limit_tier', async () => {
    const cases: Array<[Record<string, unknown>, string]> = [
      [{ organization_type: 'claude_max', rate_limit_tier: 'default_claude_max_20x' }, 'Max 20x'],
      [{ organization_type: 'claude_max', rate_limit_tier: 'default_claude_max_5x' }, 'Max 5x'],
      [{ organization_type: 'claude_max' }, 'Max'],
      [{ organization_type: 'claude_pro', rate_limit_tier: 'default_claude_ai' }, 'Pro'],
      [{ organization_type: 'claude_team' }, 'Team'],
      [{ organization_type: 'claude_enterprise' }, 'Enterprise']
    ]
    for (const [organization, label] of cases) {
      profile = { status: 200, body: profileBody(organization) }
      const snapshot = await new ClaudeCreditsService(credentials({ subscriptionType: 'pro' })).getCredits(true)
      expect(snapshot, JSON.stringify(organization)).toMatchObject({ planLabel: label, planSource: 'live' })
    }
  })

  test('plan_display_name is a short display string: trimmed, capped at 40, and refused when it is not text', async () => {
    const cases: Array<[unknown, string]> = [
      ['  Ultra  ', 'Ultra'],
      ['U'.repeat(60), 'U'.repeat(40)],
      // Not usable: falls back to the map (claude_max + 20x).
      ['', 'Max 20x'],
      ['   ', 'Max 20x'],
      [42, 'Max 20x'],
      ['Ultra\u0000\u001b[31m', 'Max 20x'],
      ['<img src=x onerror=1>', 'Max 20x']
    ]
    for (const [name, label] of cases) {
      profile = { status: 200, body: profileBody({ organization_type: 'claude_max', rate_limit_tier: 'default_claude_max_20x', plan_display_name: name }) }
      const snapshot = await new ClaudeCreditsService(credentials({ subscriptionType: 'pro' })).getCredits(true)
      expect(snapshot, JSON.stringify(name)).toMatchObject({ planLabel: label, planSource: 'live' })
    }
  })

  test('an unknown live plan shows nothing, and never falls back to the stale cache', async () => {
    profile = { status: 200, body: profileBody({ organization_type: 'claude_quantum' }) }
    const snapshot = await new ClaudeCreditsService(credentials({ subscriptionType: 'pro' })).getCredits(true)
    expect(snapshot).toMatchObject({ planLabel: null, planSource: 'live' })
    expect(planChip(snapshot)).toBeNull()
  })

  test('a profile that fails or is malformed falls back to the possibly stale cached plan, and usage still shows', async () => {
    for (const next of [{ status: 404 }, { status: 401 }, { status: 500 }, { status: 200, body: { unexpected: true } }, { status: 200, body: 'not json' }]) {
      profile = next
      const snapshot = await new ClaudeCreditsService(credentials({ subscriptionType: 'max' })).getCredits(true)
      expect(snapshot, JSON.stringify(next)).toMatchObject({ available: true, planLabel: 'Max', planSource: 'sign-in' })
      expect(planChip(snapshot)).toEqual({ text: 'Max', mayBeStale: true })
      expect(snapshot.windows.length).toBeGreaterThan(0)
    }
  })

  test('the profile is read at most once an hour; usage keeps its own cadence', async () => {
    profile = { status: 200, body: profileBody(ULTRA) }
    const service = new ClaudeCreditsService(credentials({ subscriptionType: 'pro' }))
    await service.getCredits(true); await service.getCredits(true); await service.getCredits(true)
    expect(calls.filter(url => url === PROFILE_URL)).toHaveLength(1)
    expect(calls.filter(url => url === USAGE_URL)).toHaveLength(3)
  })
})
