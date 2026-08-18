import { Bot, Sparkles } from 'lucide-react'
import { useEffect, type ReactElement } from 'react'
import type { AgentProvider } from '../../../shared/types/agent'
import type { CreditsWindow } from '../../../shared/types/agentCredits'
import { useAgentCreditsStore } from '../../store/agentCredits.store'
import { ViewportTooltip } from '../common/ViewportTooltip'

const REFRESH_INTERVAL_MS = 60_000

/**
 * Per-provider usage/credits indicator for the terminal status bar — the
 * Claude/Codex counterpart to `CopilotCreditsStatus`. Rendered ONLY in panes of
 * the matching provider (gated by the caller). The figure is account-wide (the
 * same global snapshot for every pane of that agent), so it can repeat
 * harmlessly across panes — it is not per-session.
 *
 * Shows the weekly window's used-% (matching Copilot's periodically-renewing
 * credits); the tooltip details both the 5h session and weekly windows + resets.
 * Passive indicator (not a button) — refreshes on focus + on an interval.
 */
export function AgentCreditsStatus({ provider }: { provider: AgentProvider }): ReactElement | null {
  const snapshot = useAgentCreditsStore((s) => s.byProvider[provider])
  const refresh = useAgentCreditsStore((s) => s.refresh)

  useEffect(() => {
    void refresh(provider)
    const onFocus = (): void => { void refresh(provider) }
    window.addEventListener('focus', onFocus)
    const id = window.setInterval(() => void refresh(provider), REFRESH_INTERVAL_MS)
    return () => {
      window.removeEventListener('focus', onFocus)
      window.clearInterval(id)
    }
  }, [refresh, provider])

  if (!snapshot || !snapshot.available || !snapshot.display) return null

  const pct = snapshot.display.usedPct
  const tone = pct >= 100 ? 'critical' : pct >= 80 ? 'warning' : 'ok'
  const name = providerLabel(provider, snapshot.planLabel)
  const Icon = provider === 'codex' ? Bot : Sparkles
  const title = buildTitle(name, snapshot.windows)

  return (
    <ViewportTooltip
      className={`statusbar-chip agent-credits-chip tone-${tone}`}
      content={title}
      ariaLabel={`${name} credits: ${pct}%`}
    >
      <Icon size={10} aria-hidden="true" />
      <span className="chip-label">{pct}%</span>
    </ViewportTooltip>
  )
}

function providerLabel(provider: AgentProvider, planLabel: string | null): string {
  const base = provider === 'codex' ? 'Codex' : provider === 'claude' ? 'Claude' : provider
  return planLabel ? `${base} (${planLabel})` : base
}

/** "Claude (max): semanal 48% · renova 5 jun · sessão 55%" */
function buildTitle(name: string, windows: CreditsWindow[]): string {
  const weekly = windows.find((w) => w.kind === 'weekly')
  const session = windows.find((w) => w.kind === 'session')
  const parts: string[] = []
  if (weekly) {
    const reset = formatReset(weekly.resetsAtMs)
    parts.push(`semanal ${weekly.usedPct}%${reset ? ` · renova ${reset}` : ''}`)
  }
  if (session) parts.push(`sessão ${session.usedPct}%`)
  return `${name}: ${parts.join(' · ')}`
}

/** epoch ms → "5 jun". Returns null when unparseable. */
function formatReset(ms: number | null): string | null {
  if (ms === null || !Number.isFinite(ms)) return null
  return new Date(ms).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
}
