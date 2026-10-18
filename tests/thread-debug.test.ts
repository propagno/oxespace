import { describe, expect, it } from 'vitest'
import { compileDebugFilter, parseDebugTimeToken, summarizeThreadEvent } from '../shared/threadDebug'

const row = (search: string, createdAt = 0) => ({ search: search.toLowerCase(), createdAt })

describe('compileDebugFilter', () => {
  it('keeps everything for an empty filter', () => {
    expect(compileDebugFilter('')(row('anything'))).toBe(true)
    expect(compileDebugFilter('  , ')(row('anything'))).toBe(true)
  })

  it('matches any include term and drops any exclude term', () => {
    const keep = compileDebugFilter('tool, message, !lint')
    expect(keep(row('tool bash npm test'))).toBe(true)
    expect(keep(row('message hello'))).toBe(true)
    expect(keep(row('tool bash npm run lint'))).toBe(false)
    expect(keep(row('delta partial'))).toBe(false)
    expect(compileDebugFilter('!delta')(row('tool x'))).toBe(true)
  })

  it('bounds time with before: and after:, rounding to the unit given', () => {
    const mid = new Date(2026, 9, 14, 12, 0, 0).getTime()
    expect(compileDebugFilter('before:2026-10-14')(row('x', mid))).toBe(true)
    expect(compileDebugFilter('before:2026-10-13')(row('x', mid))).toBe(false)
    expect(compileDebugFilter('after:2026-10-14t13')(row('x', mid))).toBe(false)
    expect(compileDebugFilter('after:2026-10-14t11:30 tool')(row('tool', mid))).toBe(true)
    expect(compileDebugFilter('before:2026 after:2026-01')(row('x', mid))).toBe(true)
  })

  it('reads the end of a month and the start of a year', () => {
    expect(parseDebugTimeToken('before:2026-02', 'before')).toBe(new Date(2026, 1, 28, 23, 59, 59, 999).getTime())
    expect(parseDebugTimeToken('after:2026', 'after')).toBe(new Date(2026, 0, 1).getTime())
    expect(parseDebugTimeToken('nothing', 'before')).toBeNull()
  })
})

describe('summarizeThreadEvent', () => {
  it('reads a tool with its duration, state and output', () => {
    const summary = summarizeThreadEvent({ type: 'tool', id: 't', name: 'Bash', state: 'failed', detail: 'npm test', output: 'boom', exitCode: 2, startedAt: 10, completedAt: 40 })
    expect(summary).toMatchObject({ label: 'Bash npm test', state: 'failed', durationMs: 30, exitCode: 2 })
    expect(summary.text).toContain('boom')
  })

  it('does not invent a duration from a missing or reversed clock', () => {
    expect(summarizeThreadEvent({ type: 'tool', id: 't', name: 'Bash', state: 'running', detail: 'x', startedAt: 10 }).durationMs).toBeUndefined()
    expect(summarizeThreadEvent({ type: 'tool', id: 't', name: 'Bash', state: 'completed', detail: 'x', startedAt: 50, completedAt: 40 }).durationMs).toBeUndefined()
  })

  it('summarises a turn cost and a completion', () => {
    expect(summarizeThreadEvent({ type: 'turn-cost', usd: 0.0123, inputTokens: 100, outputTokens: 20, cacheReadTokens: 80 }).label).toBe('$0.0123 · 100 in · 20 out · 80 cached')
    expect(summarizeThreadEvent({ type: 'completed', status: 'failed', error: 'rate limited' })).toMatchObject({ label: 'rate limited', state: 'failed' })
  })
})
