import { describe, expect, test, vi } from 'vitest'
import { ANTIGRAVITY_PLAN_URL, ANTIGRAVITY_QUOTA_URL, AntigravityCreditsService, antigravityPlan, antigravityUserAgent, antigravityWindows, parseAntigravitySignIn } from '../../electron/main/services/agentCredits/antigravityCredits.service'

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

function service(options: { store: Array<string | null>; quota?: () => Response; renew?: () => Promise<void>; now?: () => number }) {
  const reads = [...options.store]
  const readStored = vi.fn(async () => reads.length > 1 ? reads.shift() ?? null : reads[0] ?? null)
  const renew = vi.fn(options.renew ?? (async () => undefined))
  const request = vi.fn(async (url: string | URL | Request) => String(url) === ANTIGRAVITY_QUOTA_URL ? (options.quota?.() ?? answer(summary)) : answer(plan))
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

  test('each kind of limit reads as what was used; of several groups, the most used one', () => {
    expect(antigravityWindows(summary)).toEqual([
      { kind: 'session', usedPct: 0, resetsAtMs: Date.parse('2026-11-13T01:39:31Z') },
      { kind: 'weekly', usedPct: 57, resetsAtMs: Date.parse('2026-11-18T01:15:21Z') }
    ])
    const two = { groups: [...summary.groups, { displayName: 'Gemini models', buckets: [{ window: 'weekly', resetTime: '2026-11-17T21:46:28Z', remainingFraction: 0.03 }, { window: '5h', remainingFraction: 0.5 }, { window: 'monthly', remainingFraction: 0 }, { window: 'weekly' }] }] }
    expect(antigravityWindows(two)).toEqual([
      { kind: 'session', usedPct: 50, resetsAtMs: null },
      { kind: 'weekly', usedPct: 97, resetsAtMs: Date.parse('2026-11-17T21:46:28Z') }
    ])
    expect(antigravityWindows({})).toEqual([])
    expect(antigravityWindows(null)).toEqual([])
  })

  test('the plan is the paid one when there is one', () => {
    expect(antigravityPlan(plan)).toBe('Google AI Ultra')
    expect(antigravityPlan({ currentTier: { name: 'Antigravity' } })).toBe('Antigravity')
    expect(antigravityPlan({})).toBeNull()
  })

  test('a live sign-in gives the weekly reading, asked as the CLI asks; the token goes nowhere else', async () => {
    const { credits, request } = service({ store: [stored('2026-11-12T21:00:00Z')] })
    const snapshot = await credits.getCredits()
    expect(snapshot).toMatchObject({ provider: 'antigravity', available: true, installed: true, planLabel: 'Google AI Ultra', source: 'oauth', error: null, display: { kind: 'weekly', usedPct: 57 } })
    expect(snapshot.windows).toHaveLength(2)
    const [url, init] = request.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe(ANTIGRAVITY_QUOTA_URL)
    expect(init.method).toBe('POST')
    expect(init.body).toBe('{}')
    expect(init.headers).toMatchObject({ Authorization: 'Bearer live-token', 'User-Agent': antigravityUserAgent('1.5.7') })
    expect(request.mock.calls.map(call => String(call[0]))).toEqual([ANTIGRAVITY_QUOTA_URL, ANTIGRAVITY_PLAN_URL])
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
    expect(request.mock.calls.map(call => String(call[0]))).toEqual([ANTIGRAVITY_QUOTA_URL, ANTIGRAVITY_PLAN_URL, ANTIGRAVITY_QUOTA_URL])
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
    expect(await busy.credits.getCredits()).toMatchObject({ available: false, error: 'quota endpoint 429' })
    limited = false
    now += 60_000
    expect((await busy.credits.getCredits(true)).available).toBe(false)
    now += 61_000
    expect((await busy.credits.getCredits(true)).available).toBe(true)
  })

  test('a failure on the way is a reading with its reason, never a throw', async () => {
    const down = new AntigravityCreditsService({ readStored: async () => stored('2026-11-12T21:00:00Z'), renew: async () => undefined, cliVersion: async () => '1.5.7', fetch: (async () => { throw new Error('getaddrinfo ENOTFOUND') }) as unknown as typeof fetch, now: () => NOW })
    expect(await down.getCredits()).toMatchObject({ available: false, error: 'getaddrinfo ENOTFOUND' })
  })
})
