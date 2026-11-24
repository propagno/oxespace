// OXE-310: the usage chip renders without calling Date.now() (react-hooks/purity). The moment its "resets in" text
// counts from is state, set when the chip mounts and at each later reading; a re-render reads no clock.
import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentCreditsSnapshot } from '../../shared/types/agentCredits'
import { USAGE_POLL_MS, UsageStatus } from '../../src/components/Workspace/UsageStatus'
import { useAgentCreditsStore } from '../../src/store/agentCredits.store'

const now = Date.parse('2026-10-19T12:00:00Z')
const reading = (): AgentCreditsSnapshot => ({
  provider: 'claude', available: true, installed: true, planLabel: 'Pro', source: 'oauth', observedAtMs: now, error: null,
  display: { kind: 'weekly', usedPct: 18, resetsAtMs: now + 3 * 86_400_000 },
  windows: [{ kind: 'session', usedPct: 42, resetsAtMs: now + 2 * 3_600_000 }, { kind: 'weekly', usedPct: 18, resetsAtMs: now + 3 * 86_400_000 }]
} as AgentCreditsSnapshot)

describe('OXE-310 · UsageStatus', () => {
  beforeEach(() => {
    vi.useFakeTimers({ now })
    useAgentCreditsStore.setState({ byProvider: {}, loading: {} })
    Object.assign(window, { oxe: { agentCredits: { get: vi.fn(async () => reading()) } } })
  })
  afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks() })

  it('UsageStatus computes elapsed time cleanly without impure Date.now calls during render', async () => {
    render(<UsageStatus provider="claude" />)
    await act(async () => { await Promise.resolve() })
    const chip = screen.getByTestId('usage-status')
    expect(chip).toHaveTextContent('Claude 42%')
    const before = chip.getAttribute('title')

    const clock = vi.spyOn(Date, 'now')
    act(() => { useAgentCreditsStore.setState(state => ({ loading: { ...state.loading, claude: true } })) })
    act(() => { useAgentCreditsStore.setState(state => ({ loading: { ...state.loading, claude: false } })) })
    expect(clock, 'a re-render reads no clock').not.toHaveBeenCalled()
    expect(screen.getByTestId('usage-status').getAttribute('title')).toBe(before)

    // A later reading moves the clock the text counts from.
    await act(async () => { vi.advanceTimersByTime(USAGE_POLL_MS); await Promise.resolve() })
    expect(clock).toHaveBeenCalled()
  })
})
