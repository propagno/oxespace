import { describe, expect, it } from 'vitest'
import { threadFileScope, threadWorkingRoot, turnChanges } from '../src/components/Threads/threadChanges'
import { requestOutcome, requestOutcomeLabel } from '../shared/threadRequestOutcome'
import type { ThreadRequest } from '../shared/types/thread'

describe('request outcomes', () => {
  const question = { kind: 'question', state: 'resolved', title: 'Choose', id: 'q', nativeId: 'q', nativeMethod: 'AskUserQuestion', generation: 1, createdAt: 1 } as ThreadRequest
  it('separates an answer from a refusal and a turn failure', () => {
    expect(requestOutcome('question', { answers: { choice: ['A'] } })).toEqual({ state: 'resolved', resolution: 'answered' })
    expect(requestOutcome('question', { decision: 'decline' })).toEqual({ state: 'resolved', resolution: 'declined' })
    expect(requestOutcomeLabel({ ...question, resolution: 'turn-failed' })).toContain('Turn failed')
    expect(requestOutcomeLabel({ ...question, resolution: 'declined' })).toBe('Declined by you')
  })
})

it('keeps Linux case-sensitive paths distinct and labels external agent state', () => {
  expect(threadFileScope('/home/user/.claude/projects/repo/session.jsonl', '/repo')).toBe('Agent state')
  expect(threadFileScope('../elsewhere/file.md', '/repo')).toBe('External')
  const files = turnChanges([{ type: 'turn-diff', id: 'turn-diff:1', turnId: 't', files: [{ path: '/repo/Readme.md', kind: 'update' }, { path: '/repo/README.md', kind: 'update' }] }])
  expect(files).toHaveLength(2)
})

describe('threadWorkingRoot', () => {
  it('is the worktree the provider moved into, and the thread root otherwise', () => {
    expect(threadWorkingRoot({ rootPath: '/repo' })).toBe('/repo')
    expect(threadWorkingRoot({ rootPath: '/repo', observedLocation: { cwd: '/repo-fix/src', checkoutRoot: '/repo-fix', sameRepository: true } })).toBe('/repo-fix')
    expect(threadWorkingRoot({ rootPath: '/repo', observedLocation: { cwd: '/elsewhere', checkoutRoot: '/elsewhere', sameRepository: false } })).toBe('/repo')
  })
})
