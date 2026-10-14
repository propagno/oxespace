import { describe, expect, it } from 'vitest'
import { createApiRetryTracker, describeApiRetry } from '../electron/main/services/conversation/claude-api-retry'
import { foldLeadStatus, isHeldOpenByChildWork, summarizeChildren } from '../shared/agentLeadStatusFold'

describe('foldLeadStatus', () => {
  it('keeps the session working while children run after the lead is done', () => {
    expect(foldLeadStatus('done', 'working')).toBe('working')
    expect(foldLeadStatus('idle', 'monitoring')).toBe('monitoring')
    expect(foldLeadStatus('done', 'none')).toBe('done')
  })

  it('surfaces a human-needed state from either side', () => {
    expect(foldLeadStatus('working', 'waiting')).toBe('waiting')
    expect(foldLeadStatus('done', 'waiting')).toBe('waiting')
    expect(foldLeadStatus('blocked', 'working')).toBe('blocked')
    expect(foldLeadStatus('waiting', 'waiting')).toBe('waiting')
  })

  it('knows when child work is the only thing holding the session open', () => {
    expect(isHeldOpenByChildWork('done', 'working')).toBe(true)
    expect(isHeldOpenByChildWork('working', 'working')).toBe(false)
    expect(isHeldOpenByChildWork('done', 'none')).toBe(false)
  })

  it('ignores settled children', () => {
    expect(summarizeChildren(['completed', 'failed', 'interrupted'])).toBe('none')
    expect(summarizeChildren(['completed', 'running'])).toBe('working')
    expect(summarizeChildren(['running', 'waiting'])).toBe('waiting')
  })
})

describe('Claude api_retry', () => {
  const frame = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
    type: 'system', subtype: 'api_retry', attempt: 1, max_retries: 10, retry_delay_ms: 2000, error: 'rate_limit', error_status: 429, ...over
  })

  it('ignores unrelated frames', () => {
    expect(describeApiRetry({ type: 'system', subtype: 'init' })).toBeNull()
    expect(describeApiRetry({ type: 'assistant' })).toBeNull()
  })

  it('renders reason, status, attempt and delay', () => {
    const text = describeApiRetry(frame())!.summary
    expect(text).toMatch(/rate limit/)
    expect(text).toMatch(/HTTP 429/)
    expect(text).toMatch(/attempt 1 of 10/)
    expect(text).toMatch(/2s/)
  })

  it('tolerates missing fields', () => {
    const text = describeApiRetry({ type: 'system', subtype: 'api_retry' })!.summary
    expect(text).toMatch(/retrying/)
  })

  it('revises one row per run and starts a new row for a later storm', () => {
    let n = 0
    const tracker = createApiRetryTracker(() => `run-${++n}`)
    expect(tracker.observe(frame({ attempt: 1 }))!.id).toBe('run-1')
    expect(tracker.observe(frame({ attempt: 2 }))!.id).toBe('run-1')
    expect(tracker.observe(frame({ attempt: 3 }))!.id).toBe('run-1')
    // Attempt counter went back: a different incident.
    expect(tracker.observe(frame({ attempt: 1 }))!.id).toBe('run-2')
    tracker.reset()
    expect(tracker.observe(frame({ attempt: 2 }))!.id).toBe('run-3')
    expect(tracker.observe({ type: 'user' })).toBeNull()
  })
})
