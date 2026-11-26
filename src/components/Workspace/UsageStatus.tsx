import { Gauge } from 'lucide-react'
import { Suspense, useEffect, useRef, useState, type ReactElement } from 'react'
import type { AgentProvider } from '../../../shared/types/agent'
import type { AgentCreditsSnapshot, CreditsWindow } from '../../../shared/types/agentCredits'
import { useAgentCreditsStore } from '../../store/agentCredits.store'
import { Popover, cx } from '../../ui'
import { AgentProviderIcon } from '../Sidebar/AgentProviderIcon'
import styles from './AppStatusBar.module.css'
import { i18n } from '../../i18n'
import { chunk, lazyFrom } from '../../lib/chunk'
import { USAGE_PROVIDERS, type UsageProvider } from './usageProviders'

const tc = i18n.getFixedT(null, 'code')

// Loaded on pointer/focus intent or when the detail first opens: the status bar is in the first bundle, the detail is not.
export const USAGE_POPOVER_CHUNK = chunk(() => import('./UsagePopover'))
const UsagePopover = lazyFrom(USAGE_POPOVER_CHUNK, module => module.UsagePopover)

/** How often the status bar reads the active provider's usage while the window is visible. */
export const USAGE_POLL_MS = 60_000
/** How often inactive providers are polled in the background (reduces idle OAuth 429s). */
export const USAGE_BACKGROUND_POLL_MS = 5 * 60_000

export { USAGE_PROVIDERS, isUsageProvider, type UsageProvider } from './usageProviders'

export const providerName = (provider: AgentProvider) => provider === 'codex' ? 'Codex' : provider === 'antigravity' ? 'Antigravity' : 'Claude'

/** True when Antigravity only has a Gemini session window (no Gemini weekly bucket reported by the API). */
export function hasMissingAntigravityGeminiWeekly(snapshot: AgentCreditsSnapshot | null | undefined): boolean {
  if (!snapshot || snapshot.provider !== 'antigravity') return false
  if (snapshot.geminiWeeklyUnavailable) return true
  const windows = snapshot.windows ?? []
  return windows.some(window => window.group === 'gemini' && window.kind === 'session')
    && !windows.some(window => window.group === 'gemini' && window.kind === 'weekly')
}

/** "1h 20m", "35m", "2d 4h": the time left until a window resets. Returns null once the reset time has passed. */
export function formatResetIn(resetsAtMs: number | null, now: number): string | null {
  if (resetsAtMs === null || !Number.isFinite(resetsAtMs)) return null
  const diffMs = resetsAtMs - now
  if (diffMs <= 0) return null
  const minutes = Math.max(1, Math.round(diffMs / 60_000))
  if (minutes < 60) return tc('workspace.usage.minutes', { minutes })
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return tc('workspace.usage.hours', { hours, minutes: minutes % 60 })
  return tc('workspace.usage.days', { days: Math.floor(hours / 24), hours: hours % 24 })
}

/** Compact human age for a past reading: "12m", "5h", "13d" (pt-BR: "12 min", "5 h", "13 d"). */
export function formatUsageAge(elapsedMs: number): string {
  const minutes = Math.max(1, Math.round(elapsedMs / 60_000))
  if (minutes < 60) return tc('workspace.usage.ageMinutes', { minutes })
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return tc('workspace.usage.ageHours', { hours })
  return tc('workspace.usage.ageDays', { days: Math.floor(hours / 24) })
}

/** The groups of a reading, in order of first appearance. */
export function windowGroups(windows: CreditsWindow[]): string[] {
  return [...new Set(windows.map(window => window.group).filter((group): group is string => Boolean(group)))]
}

/**
 * The name of a group of models whose quota counts apart (Antigravity), or null for a single quota. A group the app
 * does not know is "Outros modelos", numbered when the reading has more than one ("Outros modelos 2"): never the
 * service's own words, which are not the app's (brand review of #846).
 */
export function groupName(group: string | undefined, groups: string[] = group ? [group] : []): string | null {
  if (!group) return null
  if (group === 'gemini') return tc('workspace.usage.groupGemini')
  if (group === 'claude-gpt') return tc('workspace.usage.groupClaudeGpt')
  const others = groups.filter(other => other !== 'gemini' && other !== 'claude-gpt')
  const n = others.indexOf(group) + 1
  return n > 1 ? tc('workspace.usage.groupOtherN', { n }) : tc('workspace.usage.groupOther')
}

/** "Janela semanal", or "Janela semanal · Gemini" when the provider splits its quota by group of models. */
export function windowName(window: CreditsWindow, groups?: string[]): string {
  const base = window.kind === 'session' ? tc('workspace.usage.session') : tc('workspace.usage.weekly')
  const group = groupName(window.group, groups)
  return group ? `${base} · ${group}` : base
}

/** The groups in the provider's order (the first is the one the bar shows), the five-hour window before the weekly. */
export function orderWindows(windows: CreditsWindow[]): CreditsWindow[] {
  const groups = [...new Set(windows.map(window => window.group ?? ''))]
  return [...windows].sort((a, b) => groups.indexOf(a.group ?? '') - groups.indexOf(b.group ?? '') || (a.kind === b.kind ? 0 : a.kind === 'session' ? -1 : 1))
}

/**
 * The short reading for the bar ("5h 42% · wk 18%") and the detail for its tooltip. When the quota is split by group
 * of models (OXE-174), the bar reads the display window's group only, named ("Gemini: 5h 9% · wk 3%"); the tooltip
 * lists every group.
 */
export function usageText(snapshot: AgentCreditsSnapshot, now: number): { short: string; detail: string; peak: number } {
  const label = (window: CreditsWindow) => window.kind === 'session' ? tc('workspace.usage.sessionShort') : tc('workspace.usage.weekShort')
  const windows = orderWindows(snapshot.windows ?? [])
  const barGroup = snapshot.display?.group ?? windows[0]?.group
  const bar = barGroup === undefined ? windows : windows.filter(window => window.group === barGroup)
  const name = `${providerName(snapshot.provider)}${snapshot.planLabel ? ` (${snapshot.planLabel})` : ''}`
  const groups = windowGroups(windows)
  const detail = windows.map(window => {
    const reset = formatResetIn(window.resetsAtMs, now)
    const name = windowName(window, groups)
    return reset ? tc('workspace.usage.lineReset', { name, pct: window.usedPct, reset }) : tc('workspace.usage.line', { name, pct: window.usedPct })
  })
  const elapsedMs = Math.max(0, now - (snapshot.observedAtMs ?? now))
  const ageSeconds = Math.round(elapsedMs / 1000)
  const isLocal = snapshot.source === 'local-session'
  const ageLine = ageSeconds < 60
    ? (snapshot.stale
      ? tc(isLocal ? 'workspace.usage.localStaleSeconds' : 'workspace.usage.staleSeconds', { age: ageSeconds })
      : tc('workspace.usage.readSeconds', { age: ageSeconds }))
    : (snapshot.stale
      ? tc(isLocal ? 'workspace.usage.localStaleAge' : 'workspace.usage.staleAge', { age: formatUsageAge(elapsedMs) })
      : tc('workspace.usage.readAge', { age: formatUsageAge(elapsedMs) }))
  const group = groupName(barGroup, groups)
  const short = bar.map(window => `${label(window)} ${window.usedPct}%`).join(' · ')
  return {
    short: group ? `${group}: ${short}` : short,
    detail: [name, ...detail, ageLine].join('\n'),
    peak: Math.max(0, ...bar.map(window => window.usedPct))
  }
}

export type UsageStatusProps =
  | { provider: UsageProvider; activeProvider?: never; providers?: never }
  | { provider?: undefined; activeProvider?: UsageProvider | null; providers?: readonly UsageProvider[] }

const clampPct = (value: number): number => Math.min(100, Math.max(0, Math.round(value)))

/**
 * Subscription usage in the status bar, polled every minute while visible and on focus.
 * - With `provider`, renders the single-provider chip (direct unit callers).
 * - Without `provider` (OXE-423, AppStatusBar), polls all connected providers and renders one unified Usage control
 *   summarizing the peak reading across providers; clicking opens UsagePopover with every available provider.
 */
export function UsageStatus({ provider, activeProvider, providers }: UsageStatusProps): ReactElement | null {
  const byProvider = useAgentCreditsStore(state => state.byProvider)
  const loadingMap = useAgentCreditsStore(state => state.loading)
  const refresh = useAgentCreditsStore(state => state.refresh)
  const polled: readonly UsageProvider[] = provider ? [provider] : (providers ?? USAGE_PROVIDERS)
  const pollKey = polled.join(',')
  const primaryProvider: UsageProvider | null = provider ?? activeProvider ?? null
  const lastPolledRef = useRef<Partial<Record<UsageProvider, number>>>({})
  // The moment the "resets in" text counts from: set when the chip mounts and at each later reading (OXE-310: never
  // Date.now() while rendering, which made the render impure).
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!window.oxe?.agentCredits) return
    const targets = pollKey.split(',').filter(Boolean) as UsageProvider[]
    const read = (currentNow: number) => {
      if (document.visibilityState === 'hidden') return
      for (const each of targets) {
        const last = lastPolledRef.current[each]
        const cadence = each === primaryProvider ? USAGE_POLL_MS : USAGE_BACKGROUND_POLL_MS
        if (last !== undefined && currentNow - last < cadence) continue
        lastPolledRef.current[each] = currentNow
        void refresh(each)
      }
    }
    const tick = () => {
      const currentNow = Date.now()
      setNow(currentNow)
      read(currentNow)
    }
    read(Date.now())
    const timer = window.setInterval(tick, USAGE_POLL_MS)
    window.addEventListener('focus', tick)
    document.addEventListener('visibilitychange', tick)
    return () => { window.clearInterval(timer); window.removeEventListener('focus', tick); document.removeEventListener('visibilitychange', tick) }
  }, [pollKey, primaryProvider, refresh])

  const warmPopover = (): void => { void USAGE_POPOVER_CHUNK.load().catch(() => undefined) }

  let icon: ReactElement
  let chipText: string
  let peak: number
  let stale: boolean
  let title: string
  let ariaLabel: string
  let loading: boolean
  let popoverActive: UsageProvider | null
  let providerCount = 1

  if (provider) {
    const snapshot = byProvider[provider]
    // Snapshots come over IPC from an undocumented endpoint: a reading without windows shows nothing, never throws.
    if (!snapshot?.available || !Array.isArray(snapshot.windows) || !snapshot.windows.length) return null
    const { short, detail, peak: providerPeak } = usageText(snapshot, now)
    const clamped = clampPct(providerPeak)
    icon = <AgentProviderIcon provider={provider} size={14} />
    chipText = `${providerName(provider)} ${clamped}%`
    peak = providerPeak
    stale = Boolean(snapshot.stale)
    title = `${detail}\n${tc('workspace.usage.click')}`
    ariaLabel = `${providerName(provider)} ${clamped}%, ${tc('workspace.usage.aria', { name: providerName(provider), value: short })}`
    loading = Boolean(loadingMap[provider])
    popoverActive = provider
  } else {
    // Unified mode (OXE-423): order active provider first, then remaining providers with available readings.
    const ordered: UsageProvider[] = activeProvider && polled.includes(activeProvider)
      ? [activeProvider, ...polled.filter(each => each !== activeProvider)]
      : [...polled]
    const readings = ordered
      .map(each => byProvider[each])
      .filter((snapshot): snapshot is AgentCreditsSnapshot => Boolean(snapshot?.available && Array.isArray(snapshot.windows) && snapshot.windows.length > 0))
      .map(snapshot => ({ snapshot, text: usageText(snapshot, now) }))
    if (!readings.length) return null
    peak = Math.max(0, ...readings.map(item => item.text.peak))
    const clamped = clampPct(peak)
    // Do not let an inactive stale provider turn the unified bar orange while fresh readings exist (OXE-439).
    const hasFresh = readings.some(item => !item.snapshot.stale)
    const activeReading = activeProvider ? readings.find(item => item.snapshot.provider === activeProvider) : undefined
    stale = hasFresh ? Boolean(activeReading?.snapshot.stale) : readings.every(item => Boolean(item.snapshot.stale))
    const summary = readings.map(item => `${providerName(item.snapshot.provider)} ${clampPct(item.text.peak)}%`).join(', ')
    const detail = readings.map(item => item.text.detail).join('\n\n')
    const labelText = tc('workspace.usage.label')
    icon = <Gauge size={11} aria-hidden="true" />
    chipText = `${labelText} ${clamped}%`
    title = `${detail}\n\n${tc('workspace.usage.click')}`
    ariaLabel = tc('workspace.usage.unifiedAria', { pct: clamped, summary })
    loading = polled.some(each => Boolean(loadingMap[each]))
    popoverActive = activeProvider ?? null
    providerCount = readings.length
  }

  const clampedPeak = clampPct(peak)
  return <Popover label={tc('workspace.usage.label')} side="top" align="end" trigger={<button type="button" className={cx(styles.item, styles.usage, peak >= 100 ? styles.usageCritical : peak >= 80 || stale ? styles.usageWarning : undefined)}
    title={title} aria-label={ariaLabel} aria-busy={loading || undefined} data-testid="usage-status"
    onMouseEnter={warmPopover} onFocus={warmPopover}>
    {icon}
    <span>{chipText}</span>
    <span className={styles.usageBar} aria-hidden="true"><i style={{ width: `${clampedPeak}%` }} /></span>
    {providerCount > 1 ? <span className={styles.usageCount} aria-hidden="true">{providerCount}</span> : null}
  </button>}><Suspense fallback={null}><UsagePopover active={popoverActive} /></Suspense></Popover>
}
