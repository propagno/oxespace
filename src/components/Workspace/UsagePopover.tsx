import { Bot, RefreshCw, Sparkles } from 'lucide-react'
import { useEffect, useState, type ReactElement } from 'react'
import type { AgentProvider } from '../../../shared/types/agent'
import type { AgentCreditsSnapshot } from '../../../shared/types/agentCredits'
import { useAgentCreditsStore } from '../../store/agentCredits.store'
import { useUIStore } from '../../store/ui.store'
import { Button, Meter, cx } from '../../ui'
import { formatResetIn, providerName } from './UsageStatus'
import popover from './UsagePopover.module.css'

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
      return <section key={snapshot.provider} className={popover.provider} aria-label={`${providerName(snapshot.provider)} usage`}>
        <header><Icon size={14} aria-hidden="true" /><strong>{providerName(snapshot.provider)}</strong>{snapshot.planLabel && <span className={popover.plan}>{snapshot.planLabel}</span>}{snapshot.provider === active && <span className={popover.current}>In use</span>}</header>
        {windows.map(window => {
          const reset = formatResetIn(window.resetsAtMs, now)
          return <Meter key={window.kind} label={window.kind === 'session' ? '5-hour window' : 'Weekly window'} value={window.usedPct}
            detail={`${window.usedPct}% used${reset ? ` · renews in ${reset}` : ''}`} />
        })}
        <p className={cx(popover.age, snapshot.stale && popover.stale)}>{snapshot.stale ? `Last known reading, ${age} min old: the provider is not answering now.` : age < 1 ? 'Read just now' : `Read ${age} min ago`}</p>
      </section>
    })}
    <footer>
      <Button size="sm" variant="ghost" icon={<RefreshCw size={13} aria-hidden="true" className={loading ? 'spin' : undefined} />} disabled={loading}
        onClick={() => { for (const provider of PROVIDERS) if (byProvider[provider]?.installed) void refresh(provider, true) }}>{loading ? 'Reading…' : 'Read now'}</Button>
      <Button size="sm" variant="ghost" onClick={() => useUIStore.getState().openUsage()}>Usage details</Button>
    </footer>
  </div>
}
