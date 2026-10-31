import { describe, expect, it } from 'vitest'
import {
  decideThreadWorktreeFinish, parseThreadWorktreeError, parseThreadWorktreePrefs, planThreadWorktreeFinish,
  tagThreadWorktreeError, threadWorktreeFailureAdvice, withThreadWorktreePref, type ThreadWorktreeState
} from '../shared/threadWorktree'

const empty: ThreadWorktreeState = { missing: false, uncommitted: 0, untracked: 0, unpushed: 0 }
const state = (change: Partial<ThreadWorktreeState>): ThreadWorktreeState => ({ ...empty, ...change })

describe('decideThreadWorktreeFinish', () => {
  it('removes a worktree with nothing in it without asking', () => {
    expect(decideThreadWorktreeFinish(empty)).toEqual({ kind: 'remove' })
  })

  it('asks for each kind of work on its own', () => {
    expect(decideThreadWorktreeFinish(state({ uncommitted: 2 }))).toMatchObject({ kind: 'ask', uncommitted: 2 })
    expect(decideThreadWorktreeFinish(state({ untracked: 1 }))).toMatchObject({ kind: 'ask', untracked: 1 })
    expect(decideThreadWorktreeFinish(state({ unpushed: 3 }))).toMatchObject({ kind: 'ask', unpushed: 3 })
  })

  it('reports a folder that is already gone instead of asking about it', () => {
    expect(decideThreadWorktreeFinish(state({ missing: true, uncommitted: 5 }))).toEqual({ kind: 'gone' })
  })

  it('asks when Git could not be read, even though the counts are zero', () => {
    expect(decideThreadWorktreeFinish(state({ unreadable: true }))).toMatchObject({ kind: 'ask', unreadable: true })
  })
})

describe('planThreadWorktreeFinish', () => {
  it('auto removes an empty worktree and leaves one that gained work since the question', () => {
    expect(planThreadWorktreeFinish('auto', empty)).toEqual({ kind: 'remove', force: false })
    expect(planThreadWorktreeFinish('auto', state({ untracked: 1 }))).toEqual({ kind: 'leave', reason: 'changes' })
    expect(planThreadWorktreeFinish('auto', state({ unreadable: true }))).toEqual({ kind: 'leave', reason: 'changes' })
  })

  it('keep never removes, whatever the state', () => {
    expect(planThreadWorktreeFinish('keep', empty)).toEqual({ kind: 'leave', reason: 'chosen' })
  })

  it('only discard forces, and only for a folder that exists', () => {
    expect(planThreadWorktreeFinish('discard', state({ uncommitted: 4, unpushed: 1 }))).toEqual({ kind: 'remove', force: true })
    expect(planThreadWorktreeFinish('discard', state({ missing: true }))).toEqual({ kind: 'leave', reason: 'missing' })
  })
})

describe('worktree creation errors', () => {
  it('survive the trip through Electron, which keeps only the message', () => {
    const wire = `Error invoking remote method 'thread:create': Error: ${tagThreadWorktreeError('BRANCH_EXISTS', 'A branch named “x” already exists.')}`
    expect(parseThreadWorktreeError(wire)).toEqual({ code: 'BRANCH_EXISTS', message: 'A branch named “x” already exists.' })
  })

  it('are not guessed from untagged or unknown text', () => {
    expect(parseThreadWorktreeError('A branch named “x” already exists.')).toBeNull()
    expect(parseThreadWorktreeError('[thread-worktree:SOMETHING_NEW] hmm')).toBeNull()
  })

  it('say what can be corrected, and when going on is possible', () => {
    expect(threadWorktreeFailureAdvice('BRANCH_EXISTS')).toEqual({ fix: 'branch', canContinue: false })
    expect(threadWorktreeFailureAdvice('INVALID_BASE')).toEqual({ fix: 'base', canContinue: false })
    expect(threadWorktreeFailureAdvice('DIRTY_BASE')).toEqual({ fix: null, canContinue: true })
    expect(threadWorktreeFailureAdvice('NOT_A_REPO')).toEqual({ fix: null, canContinue: false })
  })
})

describe('per-project preference', () => {
  it('reads nothing, junk and non-boolean entries as off', () => {
    expect(parseThreadWorktreePrefs(null)).toEqual({})
    expect(parseThreadWorktreePrefs('{not json')).toEqual({})
    expect(parseThreadWorktreePrefs('[true]')).toEqual({})
    expect(parseThreadWorktreePrefs('{"a":true,"b":"yes","c":false}')).toEqual({ a: true, c: false })
  })

  it('stores only the projects that turned it on', () => {
    const on = withThreadWorktreePref({}, 'a', true)
    expect(on).toEqual({ a: true })
    expect(withThreadWorktreePref(withThreadWorktreePref(on, 'b', true), 'a', false)).toEqual({ b: true })
  })
})
