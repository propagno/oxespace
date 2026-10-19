import { Bot, Sparkles } from 'lucide-react'
import { useEffect, type ReactElement } from 'react'
import type { AgentProvider } from '../../../shared/types/agent'
import type { AgentCreditsSnapshot, CreditsWindow } from '../../../shared/types/agentCredits'
import { useAgentCreditsStore } from '../../store/agentCredits.store'
import { cx } from '../../ui'
import styles from './AppStatusBar.module.css'

/** How often the status bar reads the provider's usage while the window is visible. */
export const USAGE_POLL_MS = 60_000

/** "1h 20m", "35m", "2d 4h": the time left until a window resets. */
export function formatResetIn(resetsAtMs: number | null, now: number): string | null {
  if (resetsAtMs === null || !Number.isFinite(resetsAtMs)) return null
  const minutes = Math.max(0, Math.round((resetsAtMs - now) / 60_000))
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ${minutes % 60}m`
  return `${Math.floor(hours / 24)}d ${hours % 24}h`
}

/** The short reading for the bar ("5h 42% · wk 18%") and the detail for its tooltip. */
export function usageText(snapshot: AgentCreditsSnapshot, now: number): { short: string; detail: string; peak: number } {
  const label = (window: CreditsWindow) => window.kind === 'session' ? '5h' : 'wk'
  const windows = [...(snapshot.windows ?? [])].sort((a, b) => a.kind === b.kind ? 0 : a.kind === 'session' ? -1 : 1)
  const name = `${snapshot.provider === 'codex' ? 'Codex' : 'Claude'}${snapshot.planLabel ? ` (${snapshot.planLabel})` : ''}`
  const detail = windows.map(window => {
    const reset = formatResetIn(window.resetsAtMs, now)
    return `${window.kind === 'session' ? '5-hour window' : 'Weekly window'}: ${window.usedPct}% used${reset ? `, resets in ${reset}` : ''}`
  })
  const age = Math.max(0, Math.round((now - (snapshot.observedAtMs ?? now)) / 1000))
  return {
    short: windows.map(window => `${label(window)} ${window.usedPct}%`).join(' · '),
    detail: [name, ...detail, snapshot.stale ? `Last known reading, ${age}s old (the provider is not answering now)` : `Read ${age}s ago`].join('\n'),
    peak: Math.max(0, ...windows.map(window => window.usedPct))
  }
}

/**
 * The provider's subscription usage, read every minute while the app is visible
 * and on focus; clicking reads it now. Shown for the agent in use: the selected
 * conversation in Thread, the active terminal's agent in Code.
 */
export function UsageStatus({ provider }: { provider: Extract<AgentProvider, 'claude' | 'codex'> }): ReactElement | null {
  const snapshot = useAgentCreditsStore(state => state.byProvider[provider])
  const loading = useAgentCreditsStore(state => Boolean(state.loading[provider]))
  const refresh = useAgentCreditsStore(state => state.refresh)
  useEffect(() => {
    const read = () => { if (document.visibilityState !== 'hidden') void refresh(provider) }
    read()
    const timer = window.setInterval(read, USAGE_POLL_MS)
    window.addEventListener('focus', read)
    document.addEventListener('visibilitychange', read)
    return () => { window.clearInterval(timer); window.removeEventListener('focus', read); document.removeEventListener('visibilitychange', read) }
  }, [provider, refresh])
  // Snapshots come over IPC from an undocumented endpoint: a reading without windows shows nothing, never throws.
  if (!snapshot?.available || !Array.isArray(snapshot.windows) || !snapshot.windows.length) return null
  const { short, detail, peak } = usageText(snapshot, Date.now())
  const Icon = provider === 'codex' ? Bot : Sparkles
  return <button type="button" className={cx(styles.item, styles.usage, peak >= 100 ? styles.usageCritical : peak >= 80 || snapshot.stale ? styles.usageWarning : undefined)}
    title={`${detail}\nClick to read it now`} aria-label={`${provider === 'codex' ? 'Codex' : 'Claude'} usage: ${short}`} aria-busy={loading || undefined}
    data-testid="usage-status" onClick={() => void refresh(provider, true)}>
    <Icon size={12} aria-hidden="true" />{short}
  </button>
}
