// Frozen acceptance test for the 1.5.0 bug "the usage popover says Claude · Pro on an Ultra plan" — PART 1, the
// safe fallback that ships now (TECH LEAD, 08/11). Spec: docs/roadmap-1.5/ccr-claude-plan-label.md §3a.
// Written by the planner; the executor must not edit it.
// Temp credentials file and a stubbed fetch only: never the user's ~/.claude, never the network.
// Part 2 (the live profile) is claude-plan-label-live.test.ts and waits for the user's OK.
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

vi.mock('electron', () => ({ app: { getVersion: () => '1.5.0-test', isPackaged: false } }))

const { ClaudeCreditsService } = await import('../../../electron/main/services/agentCredits/claudeCredits.service')
const { claudePlanName, planChip } = await import('../../../shared/agent-plan')

const TOKEN = 'test-token-not-real-0123456789'
const USAGE = 'https://api.anthropic.com/api/oauth/usage'
let dir: string
let calls: string[]

function credentials(oauth: Record<string, unknown>): string {
  const file = join(dir, '.credentials.json')
  writeFileSync(file, JSON.stringify({ claudeAiOauth: { accessToken: TOKEN, expiresAt: Date.now() + 3_600_000, ...oauth } }))
  return file
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'oxe-plan-'))
  calls = []
  vi.stubGlobal('fetch', vi.fn(async (url: string | URL) => {
    const href = String(url)
    calls.push(href)
    if (href === USAGE) return new Response(JSON.stringify({ five_hour: { utilization: 12, resets_at: Date.now() + 3_600_000 }, seven_day: { utilization: 30 } }), { status: 200 })
    return new Response(null, { status: 599 })
  }))
})
afterEach(() => { vi.unstubAllGlobals(); rmSync(dir, { recursive: true, force: true }) })

describe('Claude plan label, part 1: a cached plan is never stated as fact', () => {
  test('the cached plan from sign-in is a display name marked as possibly stale', async () => {
    const snapshot = await new ClaudeCreditsService(credentials({ subscriptionType: 'pro', subscriptionTypeSource: 'sign_in' })).getCredits(true)
    expect(snapshot).toMatchObject({ available: true, planLabel: 'Pro', planSource: 'sign-in' })
    expect(snapshot.windows.length).toBeGreaterThan(0)
    expect(planChip(snapshot)).toEqual({ text: 'Pro', mayBeStale: true })
    expect(JSON.stringify(snapshot)).not.toContain(TOKEN)
  })

  test('only Anthropic\'s usage endpoint and, at most once, its profile endpoint are called', async () => {
    // Part 2 (approved 08/11) adds the profile read; this part must hold before and after it.
    const service = new ClaudeCreditsService(credentials({ subscriptionType: 'max' }))
    await service.getCredits(true); await service.getCredits(true)
    expect(calls.filter(url => url === USAGE)).toHaveLength(2)
    expect(calls.filter(url => url !== USAGE).every(url => url === 'https://api.anthropic.com/api/oauth/profile')).toBe(true)
    expect(calls.filter(url => url !== USAGE).length).toBeLessThanOrEqual(1)
  })

  test('an unknown cached value shows nothing rather than a guess', async () => {
    const snapshot = await new ClaudeCreditsService(credentials({ subscriptionType: 'ultra-secret-tier-xyz' })).getCredits(true)
    expect(snapshot).toMatchObject({ planLabel: null, planSource: null })
    expect(planChip(snapshot)).toBeNull()
  })

  test('display names come from a fixed map, not the raw string', () => {
    expect(['pro', 'max', 'team', 'enterprise'].map(claudePlanName)).toEqual(['Pro', 'Max', 'Team', 'Enterprise'])
    expect(['claude_pro', 'claude_max', 'claude_team', 'claude_enterprise'].map(claudePlanName)).toEqual(['Pro', 'Max', 'Team', 'Enterprise'])
    expect([undefined, null, '', 'PRO ', 'claude_quantum', 42, '<b>pro</b>'].map(claudePlanName)).toEqual([null, null, null, null, null, null, null])
    expect(planChip({ planLabel: 'Max 5x', planSource: 'live' })).toEqual({ text: 'Max 5x', mayBeStale: false })
    expect(planChip({ planLabel: null, planSource: 'sign-in' })).toBeNull()
  })
})
