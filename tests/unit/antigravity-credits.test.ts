import { describe, expect, test, vi } from 'vitest'
import { ANTIGRAVITY_PLAN_URL, ANTIGRAVITY_QUOTA_URL, ANTIGRAVITY_USER_QUOTA_URL, AntigravityCreditsService, antigravityGroup, antigravityPlan, antigravityProject, antigravityUserAgent, antigravityUserQuotaWindows, antigravityWindows, parseAntigravitySignIn } from '../../electron/main/services/agentCredits/antigravityCredits.service'

const NOW = Date.parse('2026-11-12T20:00:00Z')
const stored = (expiry: string, accessToken = 'live-token') => JSON.stringify({ token: { access_token: accessToken, token_type: 'Bearer', refresh_token: 'refresh', expiry }, auth_method: 'consumer', id_token_email: 'someone@example.invalid' })
const summary = {
  groups: [{
    displayName: 'Claude and GPT models',
    buckets: [
      { bucketId: '3p-weekly', window: 'weekly', resetTime: '2026-11-18T01:15:21Z', remainingFraction: 0.425832 },
      { bucketId: '3p-5h', window: '5h', resetTime: '2026-11-13T01:39:31Z', remainingFraction: 1 }
    ]
  }]
}
const plan = { currentTier: { id: 'free-tier', name: 'Antigravity' }, paidTier: { id: 'g1-ultra-lite-tier', name: 'Google AI Ultra' } }
const answer = (body: unknown, status = 200, headers: Record<string, string> = {}): Response => new Response(JSON.stringify(body), { status, headers })

function service(options: { store: Array<string | null>; quota?: () => Response; plan?: () => Response; userQuota?: () => Response; renew?: () => Promise<void>; now?: () => number }) {
  const reads = [...options.store]
  const readStored = vi.fn(async () => reads.length > 1 ? reads.shift() ?? null : reads[0] ?? null)
  const renew = vi.fn(options.renew ?? (async () => undefined))
  const request = vi.fn(async (url: string | URL | Request) => {
    const target = String(url)
    if (target === ANTIGRAVITY_QUOTA_URL) return options.quota?.() ?? answer(summary)
    if (target === ANTIGRAVITY_USER_QUOTA_URL) return options.userQuota?.() ?? answer({ buckets: [] })
    return options.plan?.() ?? answer(plan)
  })
  const credits = new AntigravityCreditsService({ readStored, renew, cliVersion: async () => '1.5.7\n', fetch: request as unknown as typeof fetch, now: options.now ?? (() => NOW) })
  return { credits, readStored, renew, request }
}

describe('Antigravity quota in the usage reading', () => {
  test('the stored sign-in is read in its own shape, and anything else is no sign-in', () => {
    expect(parseAntigravitySignIn(stored('2026-11-12T18:36:13.5212952-03:00'))).toEqual({ accessToken: 'live-token', expiresAtMs: Date.parse('2026-11-12T21:36:13.521Z') })
    expect(parseAntigravitySignIn('{"token":{}}')).toBeNull()
    expect(parseAntigravitySignIn('not json')).toBeNull()
  })

  test('the client name is the CLI\'s, in its words for the system; an odd version falls back to a known one', () => {
    expect(antigravityUserAgent('1.5.7', 'win32', 'x64')).toBe('antigravity/1.5.7 windows/amd64')
    expect(antigravityUserAgent('1.6.0', 'darwin', 'arm64')).toBe('antigravity/1.6.0 darwin/arm64')
    expect(antigravityUserAgent('1.5.7; rm', 'linux', 'x64')).toBe('antigravity/1.5.7 linux/amd64')
  })

  test('each kind of limit reads as what was used, labelled with its group of models', () => {
    expect(antigravityWindows(summary)).toEqual([
      { kind: 'session', usedPct: 0, resetsAtMs: Date.parse('2026-11-13T01:39:31Z'), group: 'claude-gpt' },
      { kind: 'weekly', usedPct: 57, resetsAtMs: Date.parse('2026-11-18T01:15:21Z'), group: 'claude-gpt' }
    ])
    expect(antigravityWindows({})).toEqual([])
    expect(antigravityWindows(null)).toEqual([])
  })

  // OXE-174: the user's /usage (15/11) read Gemini 3% weekly and 9% five-hour, Claude and GPT 58% weekly; the bar
  // showed "Antigravity 57%", the Claude and GPT quota, to a person working with Gemini.
  test('groups keep apart: Gemini first, every group named; loose window names read, unknown ones collected', () => {
    const gemini = { displayName: 'Gemini models', buckets: [
      { window: 'WEEKLY', resetTime: '2026-11-22T03:00:00Z', remainingFraction: 0.9703 },
      { window: 'five_hour', resetTime: '2026-11-15T09:00:00Z', remainingFraction: 0.9113 },
      { window: 'monthly', remainingFraction: 0 },
      { window: 'weekly' }
    ] }
    const unknown = new Set<string>()
    expect(antigravityWindows({ groups: [...summary.groups, gemini] }, unknown)).toEqual([
      { kind: 'session', usedPct: 9, resetsAtMs: Date.parse('2026-11-15T09:00:00Z'), group: 'gemini' },
      { kind: 'weekly', usedPct: 3, resetsAtMs: Date.parse('2026-11-22T03:00:00Z'), group: 'gemini' },
      { kind: 'session', usedPct: 0, resetsAtMs: Date.parse('2026-11-13T01:39:31Z'), group: 'claude-gpt' },
      { kind: 'weekly', usedPct: 57, resetsAtMs: Date.parse('2026-11-18T01:15:21Z'), group: 'claude-gpt' }
    ])
    expect([...unknown]).toEqual(['window monthly'])
    expect(antigravityGroup('Gemini models')).toBe('gemini')
    expect(antigravityGroup('Claude and GPT models')).toBe('claude-gpt')
    expect(antigravityGroup('  Other models ')).toBe('Other models')
    expect(antigravityGroup('')).toBe('other')
  })

  // The agy CLI's own proto (google/internal/cloud/code/v1internal/quota_summary.proto, read from agy 1.5.x):
  // RetrieveUserQuotaSummaryResponse { buckets, groups }, a bucket { bucketId, displayName, description, window,
  // remainingFraction | remainingAmount, disabled, resetTime }. Buckets outside any group were never read.
  test('the response\'s ungrouped buckets count, grouped by their own words; disabled and amount-only ones are skipped', () => {
    const unknown = new Set<string>()
    const response = {
      groups: summary.groups,
      buckets: [
        { bucketId: '1p-weekly', displayName: 'Gemini models', window: 'WINDOW_WEEKLY', resetTime: '2026-11-22T03:00:00Z', remainingFraction: 0.9703 },
        { bucketId: '1p-5h', displayName: 'Gemini models', window: 'FIVE_HOUR', remainingFraction: 0.9113 },
        { bucketId: '1p-daily-images', displayName: 'Image generation', window: 'weekly', remainingAmount: '40' },
        { bucketId: 'old', displayName: 'Gemini models', window: 'weekly', remainingFraction: 0, disabled: true }
      ]
    }
    expect(antigravityWindows(response, unknown)).toEqual([
      { kind: 'session', usedPct: 9, resetsAtMs: null, group: 'gemini' },
      { kind: 'weekly', usedPct: 3, resetsAtMs: Date.parse('2026-11-22T03:00:00Z'), group: 'gemini' },
      { kind: 'session', usedPct: 0, resetsAtMs: Date.parse('2026-11-13T01:39:31Z'), group: 'claude-gpt' },
      { kind: 'weekly', usedPct: 57, resetsAtMs: Date.parse('2026-11-18T01:15:21Z'), group: 'claude-gpt' }
    ])
    expect([...unknown]).toEqual(['amount-only 1p-daily-images'])
    expect(antigravityGroup('3p-weekly')).toBe('claude-gpt')
    expect(antigravityGroup('1p-5h')).toBe('gemini')
  })

  test('the bar reads the first group: with Gemini on the plan, the Gemini weekly window', async () => {
    const gemini = { displayName: 'Gemini models', buckets: [{ window: 'weekly', remainingFraction: 0.97 }, { window: '5h', remainingFraction: 0.91 }] }
    const { credits } = service({ store: [stored('2026-11-12T21:00:00Z')], quota: () => answer({ groups: [...summary.groups, gemini] }) })
    const snapshot = await credits.getCredits()
    expect(snapshot.display).toMatchObject({ kind: 'weekly', usedPct: 3, group: 'gemini' })
    expect(snapshot.windows.map(window => `${window.group}:${window.kind}`)).toEqual(['gemini:session', 'gemini:weekly', 'claude-gpt:session', 'claude-gpt:weekly'])
  })

  test('the plan is the paid one when there is one', () => {
    expect(antigravityPlan(plan)).toBe('Google AI Ultra')
    expect(antigravityPlan({ currentTier: { name: 'Antigravity' } })).toBe('Antigravity')
    expect(antigravityPlan({})).toBeNull()
  })

  test('a live sign-in gives the weekly reading, asked as the CLI asks; the token goes nowhere else', async () => {
    const { credits, request } = service({ store: [stored('2026-11-12T21:00:00Z')] })
    const snapshot = await credits.getCredits()
    expect(snapshot).toMatchObject({ provider: 'antigravity', available: true, installed: true, planLabel: 'Google AI Ultra', source: 'oauth', error: null, display: { kind: 'weekly', usedPct: 57, group: 'claude-gpt' } })
    expect(snapshot.windows).toHaveLength(2)
    const [url, init] = request.mock.calls[1] as unknown as [string, RequestInit]
    expect(url).toBe(ANTIGRAVITY_QUOTA_URL)
    expect(init.method).toBe('POST')
    expect(init.body).toBe('{}')
    expect(init.headers).toMatchObject({ Authorization: 'Bearer live-token', 'User-Agent': antigravityUserAgent('1.5.7') })
    expect(request.mock.calls.map(call => String(call[0]))).toEqual([ANTIGRAVITY_PLAN_URL, ANTIGRAVITY_QUOTA_URL])
    expect(JSON.stringify(snapshot)).not.toContain('live-token')
  })

  test('within a minute the last reading answers; the store and the plan are not asked again while the token lasts', async () => {
    let now = NOW
    const { credits, request, readStored } = service({ store: [stored('2026-11-12T21:00:00Z')], now: () => now })
    await credits.getCredits()
    await credits.getCredits()
    expect(request).toHaveBeenCalledTimes(2)
    now += 61_000
    await credits.getCredits()
    expect(request.mock.calls.map(call => String(call[0]))).toEqual([ANTIGRAVITY_PLAN_URL, ANTIGRAVITY_QUOTA_URL, ANTIGRAVITY_QUOTA_URL])
    expect(readStored).toHaveBeenCalledTimes(1)
  })

  test('no sign-in in the store: not installed, nothing asked', async () => {
    const { credits, request, renew } = service({ store: [null] })
    expect(await credits.getCredits()).toMatchObject({ available: false, installed: false, error: null })
    expect(request).not.toHaveBeenCalled()
    expect(renew).not.toHaveBeenCalled()
  })

  test('an expired token has the CLI sign in once, and the fresh one is used', async () => {
    const { credits, renew, request } = service({ store: [stored('2026-11-12T19:00:00Z', 'old-token'), stored('2026-11-12T21:00:00Z', 'fresh-token')] })
    const snapshot = await credits.getCredits()
    expect(renew).toHaveBeenCalledTimes(1)
    expect(snapshot.available).toBe(true)
    expect((request.mock.calls[0] as unknown as [string, RequestInit])[1].headers).toMatchObject({ Authorization: 'Bearer fresh-token' })
  })

  test('still expired after that: installed, no reading, and the CLI is not run again for ten minutes', async () => {
    let now = NOW
    const { credits, renew, request } = service({ store: [stored('2026-11-12T19:00:00Z')], now: () => now })
    expect(await credits.getCredits()).toMatchObject({ available: false, installed: true, error: 'Antigravity sign-in expired' })
    now += 61_000
    await credits.getCredits()
    expect(renew).toHaveBeenCalledTimes(1)
    expect(request).not.toHaveBeenCalled()
    now += 10 * 60_000
    await credits.getCredits()
    expect(renew).toHaveBeenCalledTimes(2)
  })

  test('a refusal says its status and forgets the token; a 429 waits, and force does not jump the wait', async () => {
    const refused = service({ store: [stored('2026-11-12T21:00:00Z')], quota: () => answer({ error: { status: 'PERMISSION_DENIED' } }, 403) })
    expect(await refused.credits.getCredits()).toMatchObject({ available: false, installed: true, error: 'quota endpoint 403' })
    await refused.credits.getCredits(true)
    expect(refused.readStored).toHaveBeenCalledTimes(2)

    let now = NOW
    let limited = true
    const busy = service({ store: [stored('2026-11-12T23:00:00Z')], quota: () => limited ? answer({}, 429, { 'retry-after': '120' }) : answer(summary), now: () => now })
    expect(await busy.credits.getCredits()).toMatchObject({ available: false, error: 'quota endpoint 429', retryAtMs: NOW + 120_000 })
    limited = false
    now += 60_000
    expect(await busy.credits.getCredits(true)).toMatchObject({ available: false, retryAtMs: NOW + 120_000 })
    now += 61_000
    expect((await busy.credits.getCredits(true)).available).toBe(true)
  })

  test('a failure on the way is a reading with its reason, never a throw', async () => {
    const down = new AntigravityCreditsService({ readStored: async () => stored('2026-11-12T21:00:00Z'), renew: async () => undefined, cliVersion: async () => '1.5.7', fetch: (async () => { throw new Error('getaddrinfo ENOTFOUND') }) as unknown as typeof fetch, now: () => NOW })
    expect(await down.getCredits()).toMatchObject({ available: false, error: 'getaddrinfo ENOTFOUND' })
  })

  // OXE-420: loadCodeAssist returns cloudaicompanionProject (string or { id }), forwarded to quota endpoints.
  test('extracts cloudaicompanionProject in string and object shapes, and forwards { project } to retrieveUserQuotaSummary', async () => {
    expect(antigravityProject({ cloudaicompanionProject: '  my-cloud-proj  ' })).toBe('my-cloud-proj')
    expect(antigravityProject({ cloudaicompanionProject: { id: 'nested-proj-42' } })).toBe('nested-proj-42')
    expect(antigravityProject({ cloudaicompanionProject: '' })).toBeNull()
    expect(antigravityProject({})).toBeNull()

    const geminiSummary = {
      groups: [
        ...summary.groups,
        { displayName: 'Gemini models', buckets: [{ bucketId: '1p-5h', window: '5h', remainingFraction: 0.75, resetTime: '2026-11-12T23:00:00Z' }] }
      ]
    }
    let now = NOW
    const { credits, request } = service({
      store: [stored('2026-11-12T22:00:00Z')],
      plan: () => answer({ ...plan, cloudaicompanionProject: { id: 'proj-ultra-1' } }),
      quota: () => answer(geminiSummary),
      now: () => now
    })
    const snapshot = await credits.getCredits()
    expect(snapshot.display).toMatchObject({ kind: 'session', usedPct: 25, group: 'gemini' })
    expect(request.mock.calls.map(call => String(call[0]))).toEqual([ANTIGRAVITY_PLAN_URL, ANTIGRAVITY_QUOTA_URL])
    expect((request.mock.calls[1] as unknown as [string, RequestInit])[1].body).toBe(JSON.stringify({ project: 'proj-ultra-1' }))
    expect(JSON.stringify(snapshot)).not.toContain('proj-ultra-1')

    // Cached per token: next poll reuses the bound project without re-calling loadCodeAssist.
    now += 61_000
    await credits.getCredits()
    expect(request.mock.calls.map(call => String(call[0]))).toEqual([ANTIGRAVITY_PLAN_URL, ANTIGRAVITY_QUOTA_URL, ANTIGRAVITY_QUOTA_URL])
    expect((request.mock.calls[2] as unknown as [string, RequestInit])[1].body).toBe(JSON.stringify({ project: 'proj-ultra-1' }))
  })

  // OXE-420: live screenshot bug — retrieveUserQuotaSummary only returned Claude & GPT 0%, hiding active Gemini 4 Neon usage.
  test('supplements missing Gemini windows via retrieveUserQuota when summary only returns Claude and GPT', async () => {
    const claudeOnlyZero = {
      groups: [{
        displayName: 'Claude and GPT models',
        buckets: [
          { bucketId: '3p-5h', window: '5h', resetTime: '2026-11-13T01:00:00Z', remainingFraction: 1 },
          { bucketId: '3p-weekly', window: 'weekly', resetTime: '2026-11-18T01:00:00Z', remainingFraction: 1 }
        ]
      }]
    }
    const perModelQuota = {
      buckets: [
        { modelId: 'gemini-4-neon', tokenType: 'REQUESTS', remainingFraction: 0.62, resetTime: '2026-11-12T23:30:00Z' },
        { modelId: 'gemini-3.8-flash', tokenType: 'REQUESTS', remainingFraction: 0.95, resetTime: '2026-11-12T23:30:00Z' },
        { modelId: 'gemini-4-carbon', tokenType: 'REQUESTS', remainingFraction: 0.84, resetTime: '2026-11-17T20:00:00Z' },
        { modelId: 'claude-opus-5-5', tokenType: 'REQUESTS', remainingFraction: 0.5, resetTime: '2026-11-12T23:30:00Z' }
      ]
    }
    const { credits, request } = service({
      store: [stored('2026-11-12T22:00:00Z')],
      plan: () => answer({ ...plan, cloudaicompanionProject: 'proj-ultra-live' }),
      quota: () => answer(claudeOnlyZero),
      userQuota: () => answer(perModelQuota)
    })
    const snapshot = await credits.getCredits()
    expect(request.mock.calls.map(call => String(call[0]))).toEqual([ANTIGRAVITY_PLAN_URL, ANTIGRAVITY_QUOTA_URL, ANTIGRAVITY_USER_QUOTA_URL])
    expect((request.mock.calls[2] as unknown as [string, RequestInit])[1].body).toBe(JSON.stringify({ project: 'proj-ultra-live' }))
    expect(snapshot.available).toBe(true)
    expect(snapshot.planLabel).toBe('Google AI Ultra')
    expect(snapshot.display).toEqual({ kind: 'weekly', usedPct: 16, resetsAtMs: Date.parse('2026-11-17T20:00:00Z'), group: 'gemini' })
    expect(snapshot.windows).toEqual([
      { kind: 'session', usedPct: 38, resetsAtMs: Date.parse('2026-11-12T23:30:00Z'), group: 'gemini' },
      { kind: 'weekly', usedPct: 16, resetsAtMs: Date.parse('2026-11-17T20:00:00Z'), group: 'gemini' },
      { kind: 'session', usedPct: 0, resetsAtMs: Date.parse('2026-11-13T01:00:00Z'), group: 'claude-gpt' },
      { kind: 'weekly', usedPct: 0, resetsAtMs: Date.parse('2026-11-18T01:00:00Z'), group: 'claude-gpt' }
    ])
    expect(JSON.stringify(snapshot)).not.toMatch(/live-token|someone@example\.invalid|proj-ultra-live/)
  })

  test('falls back to retrieveUserQuota when retrieveUserQuotaSummary returns no windows at all', async () => {
    const { credits } = service({
      store: [stored('2026-11-12T22:00:00Z')],
      plan: () => answer({ ...plan, cloudaicompanionProject: 'proj-empty-summary' }),
      quota: () => answer({}),
      userQuota: () => answer({
        buckets: [
          { modelId: 'hydrogen-high', tokenType: 'REQUESTS', remainingFraction: 0.4, resetTime: '2026-11-13T16:00:00Z' }
        ]
      })
    })
    const snapshot = await credits.getCredits()
    expect(snapshot.available).toBe(true)
    expect(snapshot.display).toEqual({ kind: 'weekly', usedPct: 60, resetsAtMs: Date.parse('2026-11-13T16:00:00Z'), group: 'gemini' })
  })

  // OXE-420: proto3 omits float 0.0 (remainingFraction === 0 = 100% exhausted).
  test('treats proto3-omitted remainingFraction with a valid resetTime as 100% used, while skipping bare and amount-only buckets', () => {
    const unknown = new Set<string>()
    const summaryExhausted = {
      groups: [{
        displayName: 'Gemini models',
        buckets: [
          { bucketId: '1p-5h', window: '5h', resetTime: '2026-11-13T01:00:00Z' },
          { bucketId: '1p-weekly', window: 'weekly' },
          { bucketId: '1p-images', window: 'weekly', remainingAmount: '40', resetTime: '2026-11-18T01:00:00Z' },
          { bucketId: '1p-disabled', window: 'weekly', resetTime: '2026-11-18T01:00:00Z', disabled: true }
        ]
      }]
    }
    expect(antigravityWindows(summaryExhausted, unknown)).toEqual([
      { kind: 'session', usedPct: 100, resetsAtMs: Date.parse('2026-11-13T01:00:00Z'), group: 'gemini' }
    ])
    expect([...unknown]).toEqual(['amount-only 1p-images'])

    expect(antigravityUserQuotaWindows({
      buckets: [
        { modelId: 'neon-xhigh', tokenType: 'REQUESTS', resetTime: '2026-11-12T23:00:00Z' },
        { modelId: 'gemini-2.5-pro', tokenType: 'REQUESTS' },
        { modelId: 'gemini-2.5-flash', tokenType: 'REQUESTS', remainingAmount: '12', resetTime: '2026-11-12T23:00:00Z' }
      ]
    }, NOW)).toEqual([
      { kind: 'session', usedPct: 100, resetsAtMs: Date.parse('2026-11-12T23:00:00Z'), group: 'gemini' }
    ])
  })

  // OXE-420: expanded windowKind strings, bucketId fallback on empty/numeric enum window, and Gemini model ID families.
  test('reads short/rolling/daily/24h/1d windows, falls back to bucketId when window is empty or numeric, and recognizes Gemini model IDs', () => {
    const response = {
      buckets: [
        { bucketId: '1p-weekly', displayName: 'Gemini models', window: 2, remainingFraction: 0.7, resetTime: '2026-11-18T00:00:00Z' },
        { bucketId: '1p-5h', displayName: 'Gemini models', window: '', remainingFraction: 0.6, resetTime: '2026-11-13T00:00:00Z' },
        { bucketId: '3p-short', displayName: 'Claude and GPT models', window: 'rolling', remainingFraction: 0.85 },
        { bucketId: '3p-7d', displayName: 'Claude and GPT models', window: '7d', remainingFraction: 0.9 }
      ]
    }
    expect(antigravityWindows(response)).toEqual([
      { kind: 'session', usedPct: 40, resetsAtMs: Date.parse('2026-11-13T00:00:00Z'), group: 'gemini' },
      { kind: 'weekly', usedPct: 30, resetsAtMs: Date.parse('2026-11-18T00:00:00Z'), group: 'gemini' },
      { kind: 'session', usedPct: 15, resetsAtMs: null, group: 'claude-gpt' },
      { kind: 'weekly', usedPct: 10, resetsAtMs: null, group: 'claude-gpt' }
    ])

    for (const win of ['short', 'rolling', 'daily', '24h', '1d']) {
      expect(antigravityWindows({ groups: [{ displayName: 'Gemini models', buckets: [{ window: win, remainingFraction: 0.5 }] }] }))
        .toEqual([{ kind: 'session', usedPct: 50, resetsAtMs: null, group: 'gemini' }])
    }

    for (const id of ['gemini-4-neon', '1p-5h', 'pro-2.5', 'flash-lite', 'carbon-high', 'neon', 'hydrogen', 'argon']) {
      expect(antigravityGroup(id)).toBe('gemini')
    }
    for (const id of ['claude-opus-5-5', 'gpt-5-pro', '3p-weekly']) {
      expect(antigravityGroup(id)).toBe('claude-gpt')
    }
  })

  test('respects 429 backoff on loadCodeAssist and supplemental retrieveUserQuota', async () => {
    let now = NOW
    let limited = true
    const planBusy = service({
      store: [stored('2026-11-12T23:00:00Z')],
      plan: () => limited ? answer({}, 429, { 'retry-after': '120' }) : answer(plan),
      now: () => now
    })
    expect(await planBusy.credits.getCredits()).toMatchObject({ available: false, error: 'quota endpoint 429', retryAtMs: NOW + 120_000 })
    expect(planBusy.request).toHaveBeenCalledTimes(1)
    limited = false
    now += 60_000
    expect((await planBusy.credits.getCredits(true)).available).toBe(false)
    expect(planBusy.request).toHaveBeenCalledTimes(1)
    now += 61_000
    expect((await planBusy.credits.getCredits(true)).available).toBe(true)

    let now2 = NOW
    const fallbackBusy = service({
      store: [stored('2026-11-12T23:00:00Z')],
      plan: () => answer({ ...plan, cloudaicompanionProject: 'proj-429' }),
      quota: () => answer(summary),
      userQuota: () => answer({}, 429, { 'retry-after': '120' }),
      now: () => now2
    })
    const firstSnap = await fallbackBusy.credits.getCredits()
    expect(firstSnap.available).toBe(true)
    expect(firstSnap.display).toMatchObject({ group: 'claude-gpt', usedPct: 57 })
    now2 += 60_000
    await fallbackBusy.credits.getCredits(true)
    // Blocked by 429 backoff from supplemental retrieveUserQuota: no extra network requests during wait.
    expect(fallbackBusy.request).toHaveBeenCalledTimes(3)
  })

  // OXE-439: retrieveUserQuota only reports Gemini 5h session windows on current builds; surface honest hint metadata.
  test('marks geminiWeeklyUnavailable when retrieveUserQuota supplements Gemini session without weekly window', async () => {
    const { credits } = service({
      store: [stored('2026-11-12T22:00:00Z')],
      plan: () => answer({ ...plan, cloudaicompanionProject: 'proj-session-only' }),
      quota: () => answer(summary),
      userQuota: () => answer({
        buckets: [
          { modelId: 'gemini-4-neon', tokenType: 'REQUESTS', remainingFraction: 0.97, resetTime: '2026-11-12T23:30:00Z' }
        ]
      })
    })
    const snap = await credits.getCredits()
    expect(snap.geminiWeeklyUnavailable).toBe(true)
    expect(snap.windows.map(w => `${w.group}:${w.kind}`)).toEqual(['gemini:session', 'claude-gpt:session', 'claude-gpt:weekly'])
  })

  // OXE-491: live agy /usage showed Gemini 5h at 51.40% remaining (49% used, refreshes in 2h 1m) while
  // retrieveUserQuotaSummary returned Gemini weekly (87%) + an unpopulated 5h bucket (0% with no resetTime).
  test('supplements Gemini 5h session via retrieveUserQuota when summary returns weekly usage with empty 5h bucket', async () => {
    const summaryWithEmpty5h = {
      groups: [
        {
          displayName: 'Gemini models',
          buckets: [
            { bucketId: '1p-5h', window: '5h', remainingFraction: 1 },
            { bucketId: '1p-weekly', window: 'weekly', resetTime: '2026-11-18T04:00:00Z', remainingFraction: 0.1246 }
          ]
        },
        {
          displayName: 'Claude and GPT models',
          buckets: [
            { bucketId: '3p-5h', window: '5h', remainingFraction: 1 },
            { bucketId: '3p-weekly', window: 'weekly', remainingFraction: 1 }
          ]
        }
      ]
    }
    const perModel5h = {
      buckets: [
        { modelId: 'gemini-4-neon', tokenType: 'REQUESTS', remainingFraction: 0.514, resetTime: '2026-11-12T22:01:00Z' }
      ]
    }
    const { credits, request } = service({
      store: [stored('2026-11-12T22:00:00Z')],
      plan: () => answer({ ...plan, cloudaicompanionProject: 'proj-ultra-491' }),
      quota: () => answer(summaryWithEmpty5h),
      userQuota: () => answer(perModel5h)
    })
    const snap = await credits.getCredits()
    expect(request.mock.calls.map(call => String(call[0]))).toEqual([ANTIGRAVITY_PLAN_URL, ANTIGRAVITY_QUOTA_URL, ANTIGRAVITY_USER_QUOTA_URL])
    expect(snap.geminiWeeklyUnavailable).toBeUndefined()
    expect(snap.display).toEqual({ kind: 'weekly', usedPct: 88, resetsAtMs: Date.parse('2026-11-18T04:00:00Z'), group: 'gemini' })
    expect(snap.windows).toEqual([
      { kind: 'session', usedPct: 49, resetsAtMs: Date.parse('2026-11-12T22:01:00Z'), group: 'gemini' },
      { kind: 'weekly', usedPct: 88, resetsAtMs: Date.parse('2026-11-18T04:00:00Z'), group: 'gemini' },
      { kind: 'session', usedPct: 0, resetsAtMs: null, group: 'claude-gpt' },
      { kind: 'weekly', usedPct: 0, resetsAtMs: null, group: 'claude-gpt' }
    ])
  })
})
