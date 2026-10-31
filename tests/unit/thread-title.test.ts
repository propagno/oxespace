import { describe, expect, it } from 'vitest'
import { deriveThreadTitle } from '../../electron/main/services/conversation/thread-title'

describe('deriveThreadTitle', () => {
  it('uses the first sentence of plain text', () => {
    expect(deriveThreadTitle('Fix the login redirect. Then add a test.')).toBe('Fix the login redirect.')
    expect(deriveThreadTitle('  one line\nsecond line ')).toBe('one line')
  })

  it('does not show markup wrapped around the message', () => {
    expect(deriveThreadTitle('<artifact-content-author>draft the PRD</artifact-content-author> Please review the plan')).toBe('Please review the plan')
    expect(deriveThreadTitle('<context path="a.ts">x</context>')).toBe('x')
    expect(deriveThreadTitle('<only-a-tag>')).toBe('New conversation')
  })

  it('cuts long text at the limit and never returns an empty title', () => {
    expect(deriveThreadTitle('x'.repeat(200))).toHaveLength(80)
    expect(deriveThreadTitle('   ')).toBe('New conversation')
  })
})
