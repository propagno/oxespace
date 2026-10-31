import { describe, expect, it } from 'vitest'
import { deriveThreadTitle, isUnnamedThreadTitle, parseThreadRow, readThreadTitle } from '../../electron/main/services/conversation/thread-title'

describe('deriveThreadTitle', () => {
  it('uses the first sentence of plain text', () => {
    expect(deriveThreadTitle('Fix the login redirect. Then add a test.')).toBe('Fix the login redirect.')
    expect(deriveThreadTitle('  one line\nsecond line ')).toBe('one line')
  })

  it('does not show markup wrapped around the message', () => {
    expect(deriveThreadTitle('<artifact-content-author>draft the PRD</artifact-content-author> Please review the plan')).toBe('Please review the plan')
    expect(deriveThreadTitle('<context path="a.ts">x</context>')).toBe('x')
    expect(deriveThreadTitle('<only-a-tag>')).toBe('')
  })

  it('cuts long text at the limit, and returns an empty title (unnamed) rather than English text', () => {
    expect(deriveThreadTitle('x'.repeat(200))).toHaveLength(80)
    expect(deriveThreadTitle('   ')).toBe('')
  })

  it('reads the legacy "New thread" placeholder as empty, and only that exact literal', () => {
    expect(readThreadTitle('New thread')).toBe('')
    expect(readThreadTitle(null)).toBe('')
    expect(readThreadTitle('New thread pool')).toBe('New thread pool')
    expect(readThreadTitle('New conversation')).toBe('')
    expect(readThreadTitle('new thread')).toBe('new thread')
    expect(isUnnamedThreadTitle('')).toBe(true)
    expect(isUnnamedThreadTitle('New thread')).toBe(true)
    expect(isUnnamedThreadTitle('New thread pool')).toBe(false)
    expect(parseThreadRow<{ title: string; id: string }>('{"id":"t","title":"New thread"}')).toEqual({ id: 't', title: '' })
    expect(parseThreadRow<{ title: string }>('{"title":"Fix CI"}').title).toBe('Fix CI')
  })
})
