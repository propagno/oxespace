import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentCreditsSnapshot } from '../shared/types/agentCredits'
import { formatResetIn, formatUsageAge, USAGE_BACKGROUND_POLL_MS, USAGE_POLL_MS, UsageStatus, usageText } from '../src/components/Workspace/UsageStatus'
import { useAgentCreditsStore } from '../src/store/agentCredits.store'
import { changeLanguage } from '../src/i18n'

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
    expect(formatResetIn(now, now)).toBeNull()
    expect(formatResetIn(now - 13 * 86_400_000, now)).toBeNull()
    expect(formatResetIn(null, now)).toBeNull()
  })

  it('formats stale and past reading ages in minutes, hours or days (OXE-423)', async () => {
    expect(formatUsageAge(12 * 60_000)).toBe('12m')
    expect(formatUsageAge(5 * 3_600_000)).toBe('5h')
    expect(formatUsageAge(19_130 * 60_000)).toBe('13d')
    await changeLanguage('pt-BR')
    expect(formatUsageAge(12 * 60_000)).toBe('12 min')
    expect(formatUsageAge(5 * 3_600_000)).toBe('5 h')
    expect(formatUsageAge(19_130 * 60_000)).toBe('13 d')
    await changeLanguage('en')
  })

  it('a quota split by group of models (OXE-174): the bar reads the first group, named; the detail lists every group', () => {
    const windows = [
      { kind: 'weekly', usedPct: 57, resetsAtMs: null, group: 'claude-gpt' },
      { kind: 'session', usedPct: 9, resetsAtMs: null, group: 'gemini' },
      { kind: 'weekly', usedPct: 3, resetsAtMs: null, group: 'gemini' },
      { kind: 'session', usedPct: 0, resetsAtMs: null, group: 'claude-gpt' }
    ] as AgentCreditsSnapshot['windows']
    const text = usageText(snapshot({ provider: 'antigravity', planLabel: 'Google AI Ultra', display: { kind: 'weekly', usedPct: 3, resetsAtMs: null, group: 'gemini' }, windows }), now)
    // Never the Claude and GPT 57% as "Antigravity" while the person works with Gemini.
    expect(text.short).toBe('Gemini: 5h 9% · wk 3%')
    expect(text.peak).toBe(9)
    expect(text.detail.split('\n').slice(1, 5)).toEqual([
      '5-hour window · Claude and GPT: 0% used',
      'Weekly window · Claude and GPT: 57% used',
      '5-hour window · Gemini: 9% used',
      'Weekly window · Gemini: 3% used'
    ])
  })

  it('a group the app does not know reads "Other models", numbered when there are two; never the service\'s own words', () => {
    const windows = [
      { kind: 'weekly', usedPct: 4, resetsAtMs: null, group: 'gemini' },
      { kind: 'weekly', usedPct: 20, resetsAtMs: null, group: 'Image preview models' },
      { kind: 'weekly', usedPct: 30, resetsAtMs: null, group: 'Audio models' }
    ] as AgentCreditsSnapshot['windows']
    const text = usageText(snapshot({ provider: 'antigravity', display: { kind: 'weekly', usedPct: 20, resetsAtMs: null, group: 'Image preview models' }, windows }), now)
    expect(text.short).toBe('Other models: wk 20%')
    expect(text.detail.split('\n').slice(1, 4)).toEqual(['Weekly window · Gemini: 4% used', 'Weekly window · Other models: 20% used', 'Weekly window · Other models 2: 30% used'])
    expect(text.detail).not.toMatch(/Image preview|Audio models/)
  })

  describe('polling', () => {
    const get = vi.fn(async () => snapshot())
    beforeEach(() => {
      vi.useFakeTimers({ now })
      useAgentCreditsStore.setState({ byProvider: {}, loading: {} })
      Object.assign(window, { oxe: { agentCredits: { get } } })
      get.mockReset()
      get.mockImplementation(async () => snapshot())
    })
    afterEach(() => { cleanup(); vi.useRealTimers() })

    it('reads on mount and every minute; a click opens the detail, where Read now reads at once', async () => {
      render(<UsageStatus provider="claude" />)
      await act(async () => { await Promise.resolve() })
      expect(get).toHaveBeenCalledTimes(1)
      // The chip shows the agent and its highest window; the windows themselves are in its accessible name.
      expect(screen.getByTestId('usage-status')).toHaveTextContent('Claude 42%')
      expect(screen.getByTestId('usage-status')).toHaveAccessibleName(/^Claude 42%.*5h 42% · wk 18%/)
      await act(async () => { vi.advanceTimersByTime(USAGE_POLL_MS); await Promise.resolve() })
      expect(get).toHaveBeenCalledTimes(2)
      vi.useRealTimers() // the popover opens on real time
      fireEvent.click(screen.getByTestId('usage-status'))
      const detail = await screen.findByTestId('usage-popover')
      expect(detail).toHaveTextContent('5-hour window')
      expect(detail).toHaveTextContent('42% used')
      expect(screen.getByRole('region', { name: 'Claude usage' }).querySelectorAll('[role="meter"]')).toHaveLength(2)
      fireEvent.click(screen.getByRole('button', { name: 'Read now' }))
      await act(async () => { await Promise.resolve() })
      expect(get).toHaveBeenLastCalledWith({ provider: 'claude', force: true })
    })

    it('shows nothing, and does not throw, for a reading that lacks its windows', async () => {
      get.mockResolvedValueOnce({ provider: 'claude', available: true, installed: true, planLabel: 'Pro', source: 'oauth', observedAtMs: now, error: null } as unknown as AgentCreditsSnapshot)
      render(<UsageStatus provider="claude" />)
      await act(async () => { await Promise.resolve() })
      expect(screen.queryByTestId('usage-status')).toBeNull()
    })

    it('Antigravity reads like the others: its name, its plan and its highest window', async () => {
      get.mockResolvedValueOnce(snapshot({ provider: 'antigravity', planLabel: 'Google AI Ultra', windows: [{ kind: 'session', usedPct: 0, resetsAtMs: now + 5 * 3_600_000 }, { kind: 'weekly', usedPct: 57, resetsAtMs: now + 5 * 86_400_000 }] }))
      render(<UsageStatus provider="antigravity" />)
      await act(async () => { await Promise.resolve() })
      expect(get).toHaveBeenCalledWith({ provider: 'antigravity', force: false })
      const chip = screen.getByTestId('usage-status')
      expect(chip).toHaveTextContent('Antigravity 57%')
      expect(chip.getAttribute('title')).toContain('Antigravity (Google AI Ultra)')
    })

    it('shows nothing while the provider has no reading', async () => {
      get.mockResolvedValueOnce(snapshot({ available: false, windows: [], display: null }))
      render(<UsageStatus provider="codex" />)
      await act(async () => { await Promise.resolve() })
      expect(screen.queryByTestId('usage-status')).toBeNull()
    })

    it('unified mode (OXE-423): polls all providers into one trigger, formats stale ages/expired resets cleanly and uses secondary popover actions', async () => {
      const staleObservedAt = now - 19_130 * 60_000
      const expiredResetAt = now - 12 * 86_400_000
      get.mockImplementation(async ({ provider }: { provider: string }) => {
        if (provider === 'claude') {
          return snapshot({
            provider: 'claude',
            stale: true,
            observedAtMs: staleObservedAt,
            windows: [{ kind: 'session', usedPct: 100, resetsAtMs: expiredResetAt }]
          })
        }
        if (provider === 'codex') {
          return snapshot({
            provider: 'codex',
            planLabel: 'plus',
            observedAtMs: now - 30_000,
            windows: [{ kind: 'session', usedPct: 5, resetsAtMs: now + 90 * 60_000 }]
          })
        }
        return snapshot({ provider: 'antigravity', available: false, installed: false, windows: [], display: null })
      })

      render(<UsageStatus activeProvider="codex" />)
      await act(async () => { await Promise.resolve() })

      const triggers = screen.getAllByTestId('usage-status')
      expect(triggers).toHaveLength(1)
      const trigger = triggers[0]
      // OXE-470: when an active provider (codex / antigravity / claude) has a live reading, the chip surfaces that
      // active provider's own usage (not an inactive provider's peak) while keeping the unified popover & summary.
      expect(trigger).toHaveTextContent('Codex 5%')
      expect(trigger).toHaveAccessibleName('Codex 5%: Codex 5%, Claude 100%')
      expect(trigger.querySelector('[data-provider="codex"]')).toBeTruthy()
      expect(trigger.getAttribute('title')).toContain('Codex (plus)')
      expect(trigger.getAttribute('title')).toContain('Claude (max)')
      expect(trigger.getAttribute('title')).toContain('13d ago')
      expect(trigger.getAttribute('title')).not.toMatch(/resets in 0m|\b0m\b/)
      expect(trigger.className).not.toMatch(/usageCritical|usageWarning/)

      vi.useRealTimers()
      const clock = vi.spyOn(Date, 'now').mockReturnValue(now)
      try {
        fireEvent.click(trigger)
        const detail = await screen.findByTestId('usage-popover')
        const regions = within(detail).getAllByRole('region')
        expect(regions.map(r => r.getAttribute('aria-label'))).toEqual(['Codex usage', 'Claude usage'])
        expect(detail).toHaveTextContent('13d ago')
        expect(detail.textContent).not.toMatch(/19130/)
        expect(detail.textContent).not.toMatch(/renews in 0m/)
        expect(within(detail).getByRole('button', { name: 'Read now' })).toHaveAttribute('data-variant', 'secondary')
        expect(within(detail).getByRole('button', { name: 'Usage details' })).toHaveAttribute('data-variant', 'secondary')
        expect(detail.querySelector('[data-provider="codex"]')).toBeTruthy()
        expect(detail.querySelector('[data-provider="claude"]')).toBeTruthy()
      } finally {
        clock.mockRestore()
      }
    })

    it('smart polling (OXE-439): polls active provider every minute and throttles inactive providers to 5 minutes', async () => {
      render(<UsageStatus activeProvider="codex" />)
      await act(async () => { await Promise.resolve() })
      expect(get.mock.calls.map(([arg]) => (arg as { provider: string }).provider)).toEqual(['claude', 'codex', 'antigravity'])
      get.mockClear()

      // +60s: only active provider (codex) polls; inactive OAuth providers stay quiet.
      await act(async () => { vi.advanceTimersByTime(USAGE_POLL_MS); await Promise.resolve() })
      expect(get.mock.calls.map(([arg]) => (arg as { provider: string }).provider)).toEqual(['codex'])
      get.mockClear()

      // Focus 20s later: neither active nor inactive is hammered unnecessarily.
      await act(async () => {
        vi.advanceTimersByTime(20_000)
        window.dispatchEvent(new Event('focus'))
        await Promise.resolve()
      })
      expect(get).not.toHaveBeenCalled()

      // Advance until 5 minutes since mount: inactive providers poll again.
      await act(async () => { vi.advanceTimersByTime(USAGE_BACKGROUND_POLL_MS - USAGE_POLL_MS - 20_000); await Promise.resolve() })
      const providersPolled = get.mock.calls.map(([arg]) => (arg as { provider: string }).provider)
      expect(providersPolled).toContain('claude')
      expect(providersPolled).toContain('antigravity')
      expect(providersPolled).toContain('codex')
    })

    it('unified mode (OXE-439): inactive stale provider does not turn the bar orange while fresh readings exist, and local-session copy is honest', async () => {
      get.mockImplementation(async ({ provider }: { provider: string }) => {
        if (provider === 'antigravity') {
          return snapshot({
            provider: 'antigravity',
            planLabel: 'Google AI Ultra',
            stale: false,
            observedAtMs: now - 10_000,
            geminiWeeklyUnavailable: true,
            display: { kind: 'session', usedPct: 3, resetsAtMs: now + 2 * 3_600_000, group: 'gemini' },
            windows: [
              { kind: 'session', usedPct: 3, resetsAtMs: now + 2 * 3_600_000, group: 'gemini' },
              { kind: 'session', usedPct: 0, resetsAtMs: now + 4 * 3_600_000, group: 'claude-gpt' }
            ]
          })
        }
        if (provider === 'codex') {
          return snapshot({
            provider: 'codex',
            source: 'local-session',
            planLabel: 'free',
            stale: true,
            observedAtMs: now - 2 * 3_600_000,
            windows: [{ kind: 'weekly', usedPct: 5, resetsAtMs: now + 5 * 86_400_000 }]
          })
        }
        return snapshot({ provider: 'claude', available: false, installed: true, windows: [], display: null })
      })

      render(<UsageStatus activeProvider="antigravity" />)
      await act(async () => { await Promise.resolve() })

      const trigger = screen.getByTestId('usage-status')
      expect(trigger.className).not.toMatch(/usageWarning|usageCritical/)
      expect(trigger.getAttribute('title')).toContain('From last local session, 2h ago')
      expect(trigger.getAttribute('title')).not.toContain('not answering now')

      vi.useRealTimers()
      const clock = vi.spyOn(Date, 'now').mockReturnValue(now)
      try {
        fireEvent.click(trigger)
        const detail = await screen.findByTestId('usage-popover')
        expect(detail).toHaveTextContent('From last local session, 2h ago')
        expect(detail).not.toHaveTextContent('not answering now')
        expect(detail).toHaveTextContent('Gemini weekly limit is currently only reported in agy /usage.')
      } finally {
        clock.mockRestore()
      }
    })

    it('active-provider focus (OXE-470): Antigravity at 20% is not hijacked by inactive Claude at 100%, and null activeProvider falls back to unified peak', async () => {
      get.mockImplementation(async ({ provider }: { provider: string }) => {
        if (provider === 'antigravity') {
          return snapshot({
            provider: 'antigravity',
            planLabel: 'Google AI Ultra',
            stale: false,
            observedAtMs: now - 10_000,
            windows: [{ kind: 'session', usedPct: 20, resetsAtMs: now + 3 * 3_600_000 }]
          })
        }
        if (provider === 'claude') {
          return snapshot({
            provider: 'claude',
            planLabel: 'max',
            stale: false,
            observedAtMs: now - 15_000,
            windows: [{ kind: 'session', usedPct: 100, resetsAtMs: now + 3_600_000 }]
          })
        }
        return snapshot({ provider: 'codex', available: false, installed: false, windows: [], display: null })
      })

      const { rerender } = render(<UsageStatus activeProvider="antigravity" />)
      await act(async () => { await Promise.resolve() })

      const activeTrigger = screen.getByTestId('usage-status')
      expect(activeTrigger).toHaveTextContent('Antigravity 20%')
      expect(activeTrigger).toHaveAccessibleName('Antigravity 20%: Antigravity 20%, Claude 100%')
      expect(activeTrigger.querySelector('[data-provider="antigravity"]')).toBeTruthy()
      expect(activeTrigger.className).not.toMatch(/usageCritical|usageWarning/)

      rerender(<UsageStatus activeProvider={null} />)
      const unifiedTrigger = screen.getByTestId('usage-status')
      expect(unifiedTrigger).toHaveTextContent('Usage 100%')
      expect(unifiedTrigger).toHaveAccessibleName('Usage 100%: Claude 100%, Antigravity 20%')
      expect(unifiedTrigger.className).toMatch(/usageCritical/)
    })

    it('renders official AgentProviderIcon in single-provider mode', async () => {
      render(<UsageStatus provider="claude" />)
      await act(async () => { await Promise.resolve() })
      expect(screen.getByTestId('usage-status').querySelector('[data-provider="claude"]')).toBeTruthy()
    })
  })
})
