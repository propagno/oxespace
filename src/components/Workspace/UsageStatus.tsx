import { Bot, Orbit, Sparkles } from 'lucide-react'
import { Suspense, lazy, useEffect, type ReactElement } from 'react'
import type { AgentProvider } from '../../../shared/types/agent'
import type { AgentCreditsSnapshot, CreditsWindow } from '../../../shared/types/agentCredits'
import { useAgentCreditsStore } from '../../store/agentCredits.store'
import { Popover, cx } from '../../ui'
import styles from './AppStatusBar.module.css'
import { i18n } from '../../i18n'
import type { UsageProvider } from './usageProviders'

const tc = i18n.getFixedT(null, 'code')

// Loaded when the detail first opens: the status bar is in the first bundle, the detail is not.
const UsagePopover = lazy(() => import('./UsagePopover').then(module => ({ default: module.UsagePopover })))

/** How often the status bar reads the provider's usage while the window is visible. */
export const USAGE_POLL_MS = 60_000

export { USAGE_PROVIDERS, isUsageProvider, type UsageProvider } from './usageProviders'

export const providerName = (provider: AgentProvider) => provider === 'codex' ? 'Codex' : provider === 'antigravity' ? 'Antigravity' : 'Claude'
export const PROVIDER_ICONS = { claude: Sparkles, codex: Bot, antigravity: Orbit } as const satisfies Record<UsageProvider, unknown>

/** "1h 20m", "35m", "2d 4h": the time left until a window resets. */
export function formatResetIn(resetsAtMs: number | null, now: number): string | null {
  if (resetsAtMs === null || !Number.isFinite(resetsAtMs)) return null
  const minutes = Math.max(0, Math.round((resetsAtMs - now) / 60_000))
  if (minutes < 60) return tc('workspace.usage.minutes', { minutes })
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return tc('workspace.usage.hours', { hours, minutes: minutes % 60 })
  return tc('workspace.usage.days', { days: Math.floor(hours / 24), hours: hours % 24 })
}

/** The short reading for the bar ("5h 42% · wk 18%") and the detail for its tooltip. */
export function usageText(snapshot: AgentCreditsSnapshot, now: number): { short: string; detail: string; peak: number } {
  const label = (window: CreditsWindow) => window.kind === 'session' ? tc('workspace.usage.sessionShort') : tc('workspace.usage.weekShort')
  const windows = [...(snapshot.windows ?? [])].sort((a, b) => a.kind === b.kind ? 0 : a.kind === 'session' ? -1 : 1)
  const name = `${providerName(snapshot.provider)}${snapshot.planLabel ? ` (${snapshot.planLabel})` : ''}`
  const detail = windows.map(window => {
    const reset = formatResetIn(window.resetsAtMs, now)
    const name = window.kind === 'session' ? tc('workspace.usage.session') : tc('workspace.usage.weekly')
    return reset ? tc('workspace.usage.lineReset', { name, pct: window.usedPct, reset }) : tc('workspace.usage.line', { name, pct: window.usedPct })
  })
  const age = Math.max(0, Math.round((now - (snapshot.observedAtMs ?? now)) / 1000))
  return {
    short: windows.map(window => `${label(window)} ${window.usedPct}%`).join(' · '),
    detail: [name, ...detail, snapshot.stale ? tc('workspace.usage.staleSeconds', { age }) : tc('workspace.usage.readSeconds', { age })].join('\n'),
    peak: Math.max(0, ...windows.map(window => window.usedPct))
  }
}

/**
 * The provider's subscription usage, read every minute while the app is visible
 * and on focus. Shown for the agent in use: the selected conversation in Thread,
 * the active terminal's agent in Code. Clicking opens the detail.
 */
export function UsageStatus({ provider }: { provider: UsageProvider }): ReactElement | null {
  const snapshot = useAgentCreditsStore(state => state.byProvider[provider])
  const loading = useAgentCreditsStore(state => Boolean(state.loading[provider]))
  const refresh = useAgentCreditsStore(state => state.refresh)
  useEffect(() => {
    if (!window.oxe?.agentCredits) return
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
  const Icon = PROVIDER_ICONS[provider]
  const clampedPeak = Math.min(100, Math.max(0, Math.round(peak)))
  return <Popover label={tc('workspace.usage.label')} side="top" align="end" trigger={<button type="button" className={cx(styles.item, styles.usage, peak >= 100 ? styles.usageCritical : peak >= 80 || snapshot.stale ? styles.usageWarning : undefined)}
    title={`${detail}\n${tc('workspace.usage.click')}`} aria-label={`${providerName(provider)} ${clampedPeak}%, ${tc('workspace.usage.aria', { name: providerName(provider), value: short })}`} aria-busy={loading || undefined} data-testid="usage-status">
    <Icon size={11} aria-hidden="true" />
    <span>{providerName(provider)} {clampedPeak}%</span>
    <span className={styles.usageBar} aria-hidden="true"><i style={{ width: `${clampedPeak}%` }} /></span>
  </button>}><Suspense fallback={null}><UsagePopover active={provider} /></Suspense></Popover>
}
