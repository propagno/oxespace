import { Gauge } from 'lucide-react'
import { useEffect, type ReactElement } from 'react'
import type { AgentProvider } from '../../../shared/types/agent'
import { contextUsageKey, useContextUsageStore } from '../../store/contextUsage.store'
import { ViewportTooltip } from '../common/ViewportTooltip'

// 30s background poll: the context fill only moves after an agent turn (tens of
// seconds to minutes apart), so 5s spawned 6× the IPC/provider work for no extra
// signal. The focus listener below still refreshes immediately when the user
// returns to the window, keeping the meter snappy where it matters.
const REFRESH_INTERVAL_MS = 30_000

/**
 * Live "context left" indicator for the terminal status bar — the `/context`
 * meter turned around, so the user knows when to `/compact` or `/clear`. Rendered only in panes
 * whose provider exposes token data (Claude/Codex/Copilot; gated by the caller).
 *
 * The figure is what remains of the model's window after the current session's fill. It polls
 * every 30s (+ on focus) to track each agent turn. Passive (not a button); hides
 * when no data is available.
 */
export function ContextUsageStatus({ provider, rootPath }: { provider: AgentProvider; rootPath: string }): ReactElement | null {
  const key = contextUsageKey({ provider, workspaceRootPath: rootPath })
  const chip = useContextUsageStore((s) => s.byKey[key])
  const refresh = useContextUsageStore((s) => s.refresh)

  useEffect(() => {
    const input = { provider, workspaceRootPath: rootPath }
    void refresh(input)
    const onFocus = (): void => { void refresh(input) }
    window.addEventListener('focus', onFocus)
    const id = window.setInterval(() => void refresh(input), REFRESH_INTERVAL_MS)
    return () => {
      window.removeEventListener('focus', onFocus)
      window.clearInterval(id)
    }
  }, [refresh, provider, rootPath])

  if (!chip || !chip.available) return null

  const pct = chip.usedPct
  const left = Math.max(0, 100 - pct)
  const tone = pct >= 85 ? 'critical' : pct >= 70 ? 'warning' : 'ok'
  const title =
    `Context: ${left}% left (${fmtTokens(chip.usedTokens)} of ${fmtTokens(chip.limitTokens)} tokens used)` +
    `${chip.modelId ? ` · ${chip.modelId}` : ''} · /compact or /clear when it runs low`

  return (
    <ViewportTooltip
      className={`statusbar-chip context-usage-chip tone-${tone}`}
      content={title}
      ariaLabel={`Context window: ${left}% left`}
    >
      <Gauge size={12} aria-hidden="true" />
      <span className="chip-label">{left}% context left</span>
    </ViewportTooltip>
  )
}

/** 392066 → "392k", 1000000 → "1M". */
function fmtTokens(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(value % 1_000_000 === 0 ? 0 : 1)}M`
  if (value >= 1_000) return `${Math.round(value / 1_000)}k`
  return String(value)
}
