import { useEffect, type ReactElement } from 'react'
import { useCopilotCreditsStore } from '../../store/copilotCredits.store'

interface CopilotCreditsChipProps {
  /** Compact pip for the collapsed rail. */
  compact?: boolean
}

const REFRESH_INTERVAL_MS = 10 * 60_000

/**
 * Global Copilot AI-Credits indicator for the sidebar footer — the OXESpace
 * analogue of VS Code's "Credits X% used · Resets …". Sourced from
 * `gh api copilot_internal/user` (premium_interactions bucket). Renders nothing
 * when there are no premium credits to show (gh absent, not authed, or a plan
 * without a premium allowance) so it stays out of the way.
 */
export function CopilotCreditsChip({ compact = false }: CopilotCreditsChipProps): ReactElement | null {
  const credits = useCopilotCreditsStore((s) => s.credits)
  const loading = useCopilotCreditsStore((s) => s.loading)
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

  // Show whenever Copilot is reachable for this account. The % bar appears only
  // when there's a premium allowance (paid plans); free plans have entitlement 0,
  // so we render a muted pill with the plan name — the indicator stays visible
  // (and verifiable) instead of vanishing.
  if (!credits || !credits.available) return null
  const premium = credits.premium
  const hasPremium = Boolean(premium && premium.entitlement > 0)
  const usedPct = premium?.usedPct ?? 0
  const planLabel = credits.plan ?? 'copilot'
  const tone = !hasPremium ? 'idle' : usedPct >= 100 ? 'critical' : usedPct >= 80 ? 'warning' : 'ok'
  const resetLabel = formatReset(credits.resetDate)
  const title = hasPremium
    ? `Copilot premium credits: ${usedPct}% usado (${premium!.remaining}/${premium!.entitlement} restantes)${resetLabel ? ` · renova ${resetLabel}` : ''}${premium!.overagePermitted ? ' · overage permitido' : ''}\nClique para atualizar`
    : `Copilot (${planLabel}) — sem créditos premium neste plano.\nClique para atualizar`

  if (compact) {
    // Collapsed rail: only worth a pip when there's a premium % to show.
    if (!hasPremium) return null
    return (
      <button
        type="button"
        className={`copilot-credits-pip tone-${tone}`}
        title={title}
        aria-label={`Copilot credits ${usedPct}% usado`}
        disabled={loading}
        onClick={() => void refresh(true)}
      >
        {usedPct}%
      </button>
    )
  }

  return (
    <button
      type="button"
      className={`copilot-credits-chip tone-${tone}`}
      title={title}
      aria-label={hasPremium ? `Copilot credits ${usedPct}% usado` : `Copilot ${planLabel}`}
      disabled={loading}
      onClick={() => void refresh(true)}
    >
      <span className="copilot-credits-label">Copilot</span>
      {hasPremium ? (
        <>
          <span className="copilot-credits-bar" aria-hidden="true">
            <span className="copilot-credits-fill" style={{ width: `${usedPct}%` }} />
          </span>
          <span className="copilot-credits-pct">{usedPct}%</span>
        </>
      ) : (
        <span className="copilot-credits-pct copilot-credits-muted">{planLabel}</span>
      )}
    </button>
  )
}

/** "2026-07-01" / ISO → "1 jul". Returns null when unparseable. */
function formatReset(value: string | null): string | null {
  if (!value) return null
  const parsed = Date.parse(value.length === 10 ? `${value}T00:00:00` : value)
  if (!Number.isFinite(parsed)) return null
  return new Date(parsed).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
}
