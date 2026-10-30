import { Bot, RefreshCw, Sparkles } from 'lucide-react'
import { useEffect, useState, type ReactElement } from 'react'
import type { AgentProvider } from '../../../shared/types/agent'
import type { AgentCreditsSnapshot } from '../../../shared/types/agentCredits'
import { useAgentCreditsStore } from '../../store/agentCredits.store'
import { useUIStore } from '../../store/ui.store'
import { Button, Meter, cx } from '../../ui'
import { formatResetIn, providerName } from './UsageStatus'
import popover from './UsagePopover.module.css'
import { i18n } from '../../i18n'

const tc = i18n.getFixedT(null, 'code')

const PROVIDERS = ['claude', 'codex'] as const

/**
 * The detail behind the status bar reading: each provider with a reading, the one in use first, with a bar
 * per window, when it renews and when it was read.
 */
export function UsagePopover({ active }: { active: Extract<AgentProvider, 'claude' | 'codex'> }): ReactElement {
  const byProvider = useAgentCreditsStore(state => state.byProvider)
  const loading = useAgentCreditsStore(state => PROVIDERS.some(provider => state.loading[provider]))
  const refresh = useAgentCreditsStore(state => state.refresh)
  const [now, setNow] = useState(Date.now())
  useEffect(() => { const timer = window.setInterval(() => setNow(Date.now()), 15_000); return () => window.clearInterval(timer) }, [])
  const shown = [active, ...PROVIDERS.filter(provider => provider !== active)]
    .map(provider => byProvider[provider]).filter((snapshot): snapshot is AgentCreditsSnapshot => Boolean(snapshot?.available && snapshot.windows?.length))
  return <div className={popover.root} data-testid="usage-popover">
    {shown.map(snapshot => {
      const Icon = snapshot.provider === 'codex' ? Bot : Sparkles
      const windows = [...snapshot.windows].sort((a, b) => a.kind === b.kind ? 0 : a.kind === 'session' ? -1 : 1)
      const age = Math.max(0, Math.round((now - (snapshot.observedAtMs ?? now)) / 60_000))
      return <section key={snapshot.provider} className={popover.provider} aria-label={tc('workspace.usage.provider', { name: providerName(snapshot.provider) })}>
        <header><Icon size={14} aria-hidden="true" /><strong>{providerName(snapshot.provider)}</strong>{snapshot.planLabel && <span className={popover.plan}>{snapshot.planLabel}</span>}{snapshot.provider === active && <span className={popover.current}>{tc('workspace.usage.inUse')}</span>}</header>
        {windows.map(window => {
          const reset = formatResetIn(window.resetsAtMs, now)
          return <Meter key={window.kind} label={window.kind === 'session' ? tc('workspace.usage.session') : tc('workspace.usage.weekly')} value={window.usedPct}
            detail={reset ? tc('workspace.usage.usedReset', { pct: window.usedPct, reset }) : tc('workspace.usage.used', { pct: window.usedPct })} />
        })}
        <p className={cx(popover.age, snapshot.stale && popover.stale)}>{snapshot.stale ? tc('workspace.usage.staleMinutes', { age }) : age < 1 ? tc('workspace.usage.readNow') : tc('workspace.usage.readMinutes', { age })}</p>
      </section>
    })}
    <footer>
      <Button size="sm" variant="ghost" icon={<RefreshCw size={13} aria-hidden="true" className={loading ? 'spin' : undefined} />} disabled={loading}
        onClick={() => { for (const provider of PROVIDERS) if (byProvider[provider]?.installed) void refresh(provider, true) }}>{loading ? tc('workspace.usage.reading') : tc('workspace.usage.read')}</Button>
      <Button size="sm" variant="ghost" onClick={() => useUIStore.getState().openUsage()}>{tc('workspace.usage.details')}</Button>
    </footer>
  </div>
}
