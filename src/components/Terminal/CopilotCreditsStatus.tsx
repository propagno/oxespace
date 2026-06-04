import { Bot } from 'lucide-react'
import { useEffect, type ReactElement } from 'react'
import { useCopilotCreditsStore } from '../../store/copilotCredits.store'

const REFRESH_INTERVAL_MS = 60_000

/**
 * Copilot AI-Credits indicator for the terminal status bar. Rendered ONLY in
 * Copilot panes (gated by the caller). The figure is account-wide (the same
 * global snapshot for every Copilot terminal), so it can repeat harmlessly
 * across panes — it is not per-session.
 *
 * Mirrors VS Code's Copilot status: shows premium-credit % on paid plans, and
 * the inline-suggestions (completions) tally on free plans. It's a passive
 * indicator (not a button) — refreshes itself on focus + on an interval.
 */
export function CopilotCreditsStatus(): ReactElement | null {
  const credits = useCopilotCreditsStore((s) => s.credits)
  const refresh = useCopilotCreditsStore((s) => s.refresh)

  useEffect(() => {
    void refresh()
    const onFocus = (): void => { void refresh() }
    window.addEventListener('focus', onFocus)
    const id = window.setInterval(() => void refresh(), REFRESH_INTERVAL_MS)
    return () => {
      window.removeEventListener('focus', onFocus)
      window.clearInterval(id)
    }
  }, [refresh])

  if (!credits || !credits.available) return null

  const bucket = credits.credits
  const resetLabel = formatReset(credits.resetDate)
  const planLabel = credits.plan ?? 'copilot'

  let label: string
  let tone: 'ok' | 'warning' | 'critical' | 'idle'
  let title: string

  if (bucket && bucket.entitlement > 0) {
    // AI Credits used out of the account's allowance (e.g. 18.8/200 free,
    // 69/300 Business). `remaining` is fractional, matching the Copilot CLI.
    const used = Math.max(0, bucket.entitlement - bucket.remaining)
    const pct = bucket.usedPct
    tone = pct >= 100 ? 'critical' : pct >= 80 ? 'warning' : 'ok'
    label = `${fmt(used)}/${fmt(bucket.entitlement)}`
    title = `Copilot AI credits (${planLabel}): ${fmt(used)}/${fmt(bucket.entitlement)} usados · ${pct}%${resetLabel ? ` · renova ${resetLabel}` : ''}`
  } else {
    tone = 'idle'
    label = planLabel
    title = `Copilot (${planLabel})`
  }

  return (
    <span
      className={`statusbar-chip copilot-credits-chip tone-${tone}`}
      data-tooltip={title}
      aria-label={`Copilot credits: ${label}`}
    >
      <Bot size={10} aria-hidden="true" />
      <span className="chip-label">{label}</span>
    </span>
  )
}

/** Credits can be fractional (180.8). Show ≤1 decimal, dropping a trailing .0. */
function fmt(n: number): string {
  return Number.isInteger(n) ? String(n) : (Math.round(n * 10) / 10).toString()
}

/** "2026-07-01" / ISO → "1 jul". Returns null when unparseable. */
function formatReset(value: string | null): string | null {
  if (!value) return null
  const parsed = Date.parse(value.length === 10 ? `${value}T00:00:00` : value)
  if (!Number.isFinite(parsed)) return null
  return new Date(parsed).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
}
