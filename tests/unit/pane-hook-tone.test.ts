import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { deriveStatusTone, type PaneDisplayTerminalState } from '../../src/utils/paneDisplay'

const NOW = 1_700_000_000_000

function entry(over: Partial<PaneDisplayTerminalState>): PaneDisplayTerminalState {
  return {
    status: 'running',
    error: null,
    lastActivityAt: null,
    lastOutput: null,
    lastIntent: null,
    lastIntentAt: null,
    isWorking: false,
    hasUnread: false,
    hookState: null,
    hookAt: null,
    ...over
  }
}

describe('deriveStatusTone with agent hooks', () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(NOW) })
  afterEach(() => vi.useRealTimers())

  it('keeps the heuristic when no hook has reported', () => {
    expect(deriveStatusTone(entry({ isWorking: true }))).toBe('thinking')
    expect(deriveStatusTone(entry({}))).toBe('idle')
  })

  it('trusts a hook over output timing', () => {
    // Output went quiet but the agent says it is still working.
    expect(deriveStatusTone(entry({ hookState: 'working', hookAt: NOW - 1000, lastActivityAt: NOW - 1000 }))).toBe('thinking')
    // The agent is done even though a spinner redraw set isWorking.
    expect(deriveStatusTone(entry({ hookState: 'done', hookAt: NOW - 1000, isWorking: true }))).toBe('awaiting')
    expect(deriveStatusTone(entry({ hookState: 'waiting', hookAt: NOW - 10 * 60_000 }))).toBe('awaiting')
  })

  it('lets done decay to idle', () => {
    expect(deriveStatusTone(entry({ hookState: 'done', hookAt: NOW - 6 * 60_000 }))).toBe('idle')
  })

  it('does not stay "thinking" forever when an agent dies without a Stop hook', () => {
    const stale = entry({ hookState: 'working', hookAt: NOW - 20 * 60_000, lastActivityAt: NOW - 10 * 60_000 })
    expect(deriveStatusTone(stale)).toBe('idle')
    // ...but fresh output keeps a long silent-hook run alive.
    expect(deriveStatusTone({ ...stale, lastActivityAt: NOW - 1000 })).toBe('thinking')
  })

  it('process state still wins over any hook report', () => {
    expect(deriveStatusTone(entry({ status: 'exited', hookState: 'working', hookAt: NOW }))).toBe('exited')
    expect(deriveStatusTone(entry({ error: 'boom', hookState: 'done', hookAt: NOW }))).toBe('error')
  })
})
