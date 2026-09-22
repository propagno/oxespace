import { describe, expect, it } from 'vitest'
import { diagnosticText, parseThreadUsage, threadFailure } from '../electron/main/services/conversation/thread-failure'

describe('thread failure diagnostics', () => {
  it.each([
    ['unauthorized', 401, 'authentication'], ['usageLimitExceeded', undefined, 'usage'],
    ['rateLimitExceeded', 429, 'rate-limit'], ['contextWindowExceeded', undefined, 'context'],
    ['sessionBudgetExceeded', undefined, 'budget'], ['serverOverloaded', 503, 'server'],
    ['sandboxError', undefined, 'sandbox'], ['responseStreamDisconnected', undefined, 'network'], ['badRequest', 400, 'configuration']
  ])('classifies %s independently of authentication', (providerCode, httpStatusCode, expected) => {
    expect(threadFailure({ codexErrorInfo: httpStatusCode ? { [providerCode!]: { httpStatusCode } } : providerCode, message: 'Action failed' })).toMatchObject({ code: expected, providerCode, detail: 'Action failed' })
  })
  it('bounds diagnostics and removes credentials, URL credentials and query strings without losing the useful reason', () => {
    const result = diagnosticText('Usage exhausted. Bearer abc-secret api_key=key-secret password="long secret with spaces" https://user:pass@example.com/path?token=url-secret#fragment sk-sensitive-key eyJheader.eyJpayload.signature')
    expect(result).toContain('Usage exhausted.')
    for (const secret of ['abc-secret', 'key-secret', 'long secret', 'url-secret', 'user:pass', 'sk-sensitive', 'eyJheader']) expect(result).not.toContain(secret)
    expect(result).toContain('https://example.com/path')
    expect(diagnosticText('x'.repeat(20000))).toHaveLength(4000)
    expect(diagnosticText({ accessToken: 'secret' })).toBe('')
  })
  it('reads native UNIX seconds, includes session/weekly/spending windows and handles empty or incomplete responses', () => {
    const usage = parseThreadUsage({ rateLimitsByLimitId: {}, rateLimits: { limitId: 'codex', primary: { usedPercent: 100, windowDurationMins: 300, resetsAt: 1790000000 }, secondary: { usedPercent: 15, windowDurationMins: 10080, resetsAt: null }, individualLimit: { remainingPercent: 0, resetsAt: 1790001000 } } })
    expect(usage.windows).toHaveLength(3)
    expect(usage.windows[0]).toMatchObject({ label: 'codex · Session · 5 hours', resetsAt: 1790000000000 })
    expect(usage.windows[1]).toMatchObject({ label: 'codex · Weekly', usedPercent: 15 })
    expect(usage.windows[1].resetsAt).toBeUndefined()
    expect(usage.windows[2]).toMatchObject({ usedPercent: 100, resetsAt: 1790001000000 })
    expect(parseThreadUsage({}).windows).toEqual([])
    expect(parseThreadUsage({ rateLimits: { primary: { usedPercent: NaN, resetsAt: Infinity } } }).windows).toEqual([])
  })
})
