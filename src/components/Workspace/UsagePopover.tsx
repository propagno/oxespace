import { RefreshCw } from 'lucide-react'
import { useEffect, useState, type ReactElement } from 'react'
import type { AgentCreditsSnapshot } from '../../../shared/types/agentCredits'
import { useAgentCreditsStore } from '../../store/agentCredits.store'
import { useUIStore } from '../../store/ui.store'
import { Button, Meter, cx } from '../../ui'
import { AgentProviderIcon } from '../Sidebar/AgentProviderIcon'
import { USAGE_PROVIDERS as PROVIDERS, formatResetIn, formatUsageAge, hasMissingAntigravityGeminiWeekly, orderWindows, providerName, windowGroups, windowName, type UsageProvider } from './UsageStatus'
import popover from './UsagePopover.module.css'
import { i18n } from '../../i18n'

const tc = i18n.getFixedT(null, 'code')

/**
 * The detail behind the status bar reading: each provider with a reading, the one in use first, with a bar
 * per window, when it renews and when it was read.
 */
export function UsagePopover({ active }: { active?: UsageProvider | null }): ReactElement {
  const byProvider = useAgentCreditsStore(state => state.byProvider)
  const loading = useAgentCreditsStore(state => PROVIDERS.some(provider => state.loading[provider]))
  const refresh = useAgentCreditsStore(state => state.refresh)
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => { const timer = window.setInterval(() => setNow(Date.now()), 15_000); return () => window.clearInterval(timer) }, [])
  const order = active ? [active, ...PROVIDERS.filter(provider => provider !== active)] : [...PROVIDERS]
  const shown = order
    .map(provider => byProvider[provider]).filter((snapshot): snapshot is AgentCreditsSnapshot => Boolean(snapshot?.available && snapshot.windows?.length))
  return <div className={popover.root} data-testid="usage-popover">
    {shown.map(snapshot => {
      const windows = orderWindows(snapshot.windows)
      const groups = windowGroups(windows)
      const elapsedMs = Math.max(0, now - (snapshot.observedAtMs ?? now))
      const ageLabel = formatUsageAge(elapsedMs)
      const isLocal = snapshot.source === 'local-session'
      const ageText = snapshot.stale
        ? tc(isLocal ? 'workspace.usage.localStaleAge' : 'workspace.usage.staleAge', { age: ageLabel })
        : elapsedMs < 60_000 ? tc('workspace.usage.readNow') : tc('workspace.usage.readAge', { age: ageLabel })
      return <section key={snapshot.provider} className={popover.provider} aria-label={tc('workspace.usage.provider', { name: providerName(snapshot.provider) })}>
        <header><AgentProviderIcon provider={snapshot.provider} size={16} /><strong>{providerName(snapshot.provider)}</strong>{snapshot.planLabel && <span className={popover.plan}>{snapshot.planLabel}</span>}{snapshot.provider === active && <span className={popover.current}>{tc('workspace.usage.inUse')}</span>}</header>
        {windows.map(window => {
          const reset = formatResetIn(window.resetsAtMs, now)
          return <Meter key={`${window.group ?? ''}-${window.kind}`} label={windowName(window, groups)} value={window.usedPct}
            detail={reset ? tc('workspace.usage.usedReset', { pct: window.usedPct, reset }) : tc('workspace.usage.used', { pct: window.usedPct })} />
        })}
        {hasMissingAntigravityGeminiWeekly(snapshot) && <p className={popover.hint}>{tc('workspace.usage.antigravityGeminiWeeklyHint')}</p>}
        <p className={cx(popover.age, snapshot.stale && !isLocal && popover.stale)}>{ageText}</p>
      </section>
    })}
    <footer>
      <Button size="sm" variant="secondary" icon={<RefreshCw size={13} aria-hidden="true" className={loading ? 'spin' : undefined} />} disabled={loading}
        onClick={() => { for (const provider of PROVIDERS) if (byProvider[provider]?.installed) void refresh(provider, true) }}>{loading ? tc('workspace.usage.reading') : tc('workspace.usage.read')}</Button>
      <Button size="sm" variant="secondary" onClick={() => useUIStore.getState().openUsage()}>{tc('workspace.usage.details')}</Button>
    </footer>
  </div>
}
