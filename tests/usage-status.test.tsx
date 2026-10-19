import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentCreditsSnapshot } from '../shared/types/agentCredits'
import { formatResetIn, USAGE_POLL_MS, UsageStatus, usageText } from '../src/components/Workspace/UsageStatus'
import { useAgentCreditsStore } from '../src/store/agentCredits.store'

const now = Date.parse('2026-10-19T12:00:00Z')
const snapshot = (overrides: Partial<AgentCreditsSnapshot> = {}): AgentCreditsSnapshot => ({
  provider: 'claude', available: true, installed: true, planLabel: 'max', source: 'oauth', observedAtMs: now - 5_000, error: null,
  display: { kind: 'weekly', usedPct: 18, resetsAtMs: now + 3 * 86_400_000 },
  windows: [{ kind: 'weekly', usedPct: 18, resetsAtMs: now + 3 * 86_400_000 + 4 * 3_600_000 }, { kind: 'session', usedPct: 42, resetsAtMs: now + 80 * 60_000 }],
  ...overrides
}) as AgentCreditsSnapshot

describe('usage in the status bar', () => {
  it('reads both windows, session first, with the time left until each resets', () => {
    const text = usageText(snapshot(), now)
    expect(text.short).toBe('5h 42% · wk 18%')
    expect(text.peak).toBe(42)
    expect(text.detail).toBe('Claude (max)\n5-hour window: 42% used, resets in 1h 20m\nWeekly window: 18% used, resets in 3d 4h\nRead 5s ago')
    expect(usageText(snapshot({ stale: true }), now).detail).toContain('Last known reading, 5s old')
    expect(formatResetIn(now + 35 * 60_000, now)).toBe('35m')
    expect(formatResetIn(null, now)).toBeNull()
  })

  describe('polling', () => {
    const get = vi.fn(async () => snapshot())
    beforeEach(() => {
      vi.useFakeTimers({ now })
      useAgentCreditsStore.setState({ byProvider: {}, loading: {} })
      Object.assign(window, { oxe: { agentCredits: { get } } })
      get.mockClear()
    })
    afterEach(() => { cleanup(); vi.useRealTimers() })

    it('reads on mount and every minute, and reads now when clicked', async () => {
      render(<UsageStatus provider="claude" />)
      await act(async () => { await Promise.resolve() })
      expect(get).toHaveBeenCalledTimes(1)
      expect(screen.getByTestId('usage-status')).toHaveTextContent('5h 42% · wk 18%')
      await act(async () => { vi.advanceTimersByTime(USAGE_POLL_MS); await Promise.resolve() })
      expect(get).toHaveBeenCalledTimes(2)
      fireEvent.click(screen.getByTestId('usage-status'))
      await act(async () => { await Promise.resolve() })
      expect(get).toHaveBeenLastCalledWith({ provider: 'claude', force: true })
    })

    it('shows nothing, and does not throw, for a reading that lacks its windows', async () => {
      get.mockResolvedValueOnce({ provider: 'claude', available: true, installed: true, planLabel: 'Pro', source: 'oauth', observedAtMs: now, error: null } as unknown as AgentCreditsSnapshot)
      render(<UsageStatus provider="claude" />)
      await act(async () => { await Promise.resolve() })
      expect(screen.queryByTestId('usage-status')).toBeNull()
    })

    it('shows nothing while the provider has no reading', async () => {
      get.mockResolvedValueOnce(snapshot({ available: false, windows: [], display: null }))
      render(<UsageStatus provider="codex" />)
      await act(async () => { await Promise.resolve() })
      expect(screen.queryByTestId('usage-status')).toBeNull()
    })
  })
})
