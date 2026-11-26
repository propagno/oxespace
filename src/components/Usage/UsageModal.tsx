import { useEffect, useRef, useState, type ReactElement, type ReactNode } from 'react'
import { RefreshCw } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { i18n } from '../../i18n'
import type { AgentProvider } from '../../../shared/types/agent'
import type { AgentCreditsSnapshot, CreditsWindow } from '../../../shared/types/agentCredits'
import type { CopilotCredits } from '../../../shared/types/copilot'
import { useAgentCreditsStore } from '../../store/agentCredits.store'
import { Badge, Button, Dialog, Meter, cx } from '../../ui'
import { AgentProviderIcon } from '../Sidebar/AgentProviderIcon'
import styles from './UsageModal.module.css'
import { formatDateTime } from '../../utils/formatTime'
import { formatUsageAge, groupName, hasMissingAntigravityGeminiWeekly, orderWindows, windowGroups } from '../Workspace/UsageStatus'

interface UsageModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function fmtReset(window: CreditsWindow, stale = false, now: number = Date.now()): string {
  const ms = window.resetsAtMs
  if (ms === null || !Number.isFinite(ms)) {
    return window.usedPct === 0 ? i18n.t('usage.quotaAvailable') : i18n.t('usage.resetUnknown')
  }
  const diff = ms - now
  if (diff <= 0) return stale ? i18n.t('usage.windowEnded') : i18n.t('usage.resetting')
  const minutes = Math.floor(diff / 60_000)
  const hours = Math.floor(minutes / 60)
  const days = Math.floor(hours / 24)
  return i18n.t('usage.resetsIn', { time: days >= 1 ? `${days}d` : hours >= 1 ? `${hours}h` : `${Math.max(1, minutes)}m` })
}

function isSameCalendarDay(aMs: number, bMs: number): boolean {
  const a = new Date(aMs)
  const b = new Date(bMs)
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
}

export function formatCheckedStamp(observedAtMs: number, now: number = Date.now()): string {
  if (isSameCalendarDay(observedAtMs, now)) {
    return i18n.t('usage.checked', { time: formatDateTime(observedAtMs, { hour: '2-digit', minute: '2-digit' }) })
  }
  const time = formatDateTime(observedAtMs, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
  const age = formatUsageAge(Math.max(0, now - observedAtMs))
  return i18n.t('usage.checkedPast', { time, age })
}

export function formatProviderError(error: string, retryAtMs: number | null | undefined, now: number): string {
  if (error === 'oauth_expired') return i18n.t('usage.error.oauthExpired')
  if (/\b429\b/.test(error)) {
    if (typeof retryAtMs === 'number' && Number.isFinite(retryAtMs) && retryAtMs > now) {
      const minutes = Math.max(1, Math.ceil((retryAtMs - now) / 60_000))
      return i18n.t('usage.error.rateLimitedRetry', { minutes })
    }
    return i18n.t('usage.error.rateLimited')
  }
  return error
}

function WindowRow({ window, groups, stale, now }: { window: CreditsWindow; groups: string[]; stale: boolean; now: number }): ReactElement {
  const { t } = useTranslation()
  return <div className={styles.window} data-testid="usage-window">
    <Meter label={[window.kind === 'session' ? t('usage.session') : t('usage.week'), groupName(window.group, groups)].filter(Boolean).join(' · ')} value={Math.round(window.usedPct)} detail={t('usage.used', { percent: Math.round(window.usedPct) })} />
    <span className={styles.note} title={window.resetsAtMs ? formatDateTime(window.resetsAtMs) : undefined}>{fmtReset(window, stale, now)}</span>
  </div>
}

function Card({ provider, title, meta, testId, children, footer }: { provider: AgentProvider; title: string; meta?: ReactNode; testId: string; children: ReactNode; footer?: ReactNode }): ReactElement {
  return <section className={styles.card} data-testid={testId} aria-label={title}>
    <header className={styles.cardHead}>
      <div className={styles.cardTitle}>
        <AgentProviderIcon provider={provider} size={18} />
        <h3>{title}</h3>
      </div>
      {meta}
    </header>
    <div className={styles.cardBody}>{children}</div>
    {footer && <footer className={styles.cardFoot}>{footer}</footer>}
  </section>
}

/** `title` is the provider's name: a signed-in account is that provider's (Codex's quota was labelled "Claude account"). */
function ProviderCard({ provider, title, snapshot, now }: { provider: AgentProvider; title: string; snapshot: AgentCreditsSnapshot | null; now: number }): ReactElement {
  const { t } = useTranslation()
  const source = snapshot?.source === 'oauth' ? t('usage.source.oauth', { provider: title }) : snapshot?.source === 'local-session' ? t('usage.source.local') : t('usage.source.account')
  const checked = snapshot?.observedAtMs ? ` · ${formatCheckedStamp(snapshot.observedAtMs, now)}` : ''
  const isLocal = snapshot?.source === 'local-session'
  const meta = <div className={styles.cardMeta}>
    {snapshot?.planLabel ? <Badge>{snapshot.planLabel}</Badge> : <Badge>{t('usage.subscription')}</Badge>}
    {snapshot?.stale && <Badge intent="warning">{t('usage.lastKnown')}</Badge>}
  </div>
  return <Card provider={provider} title={title} testId={`usage-card-${title.toLowerCase()}`}
    meta={meta}
    footer={<>{snapshot?.stale && (isLocal ? <span>{t('usage.staleLocal')}</span> : <span className={styles.stale}>{t('usage.stale')}</span>)}<span>{source}{checked}</span></>}>
    {!snapshot || !snapshot.installed ? <p className={styles.note}>{t('usage.notDetected')}</p>
      : snapshot.error && !snapshot.stale ? <p className={styles.error}>{formatProviderError(snapshot.error, snapshot.retryAtMs, now)}</p>
      : snapshot.windowsExpired ? <p className={styles.note}>{t('usage.windowsExpired')}</p>
      : snapshot.windows.length === 0 ? <p className={styles.note}>{t('usage.noQuota')}</p>
      : <>
        {orderWindows(snapshot.windows).map(window => <WindowRow key={`${window.group ?? ''}-${window.kind}`} window={window} groups={windowGroups(snapshot.windows)} stale={Boolean(snapshot.stale)} now={now} />)}
        {hasMissingAntigravityGeminiWeekly(snapshot) && <p className={cx(styles.note, styles.fullRow)}>{t('usage.antigravityGeminiWeeklyHint')}</p>}
      </>}
  </Card>
}

function CopilotCard({ credits }: { credits: CopilotCredits | null }): ReactElement {
  const { t } = useTranslation()
  return <Card provider="copilot" title="Copilot" testId="usage-card-copilot" meta={credits?.plan ? <Badge>{credits.plan}</Badge> : undefined}>
    {!credits || !credits.installed ? <p className={styles.note}>{t('usage.ghMissing')}</p>
      : credits.error ? <p className={styles.error}>{credits.error}</p>
      : !credits.credits ? <p className={styles.note}>{t('usage.noAllowance')}</p>
      : credits.credits.unlimited ? <p className={styles.note}>{t('usage.unlimited')}</p>
      : <div className={styles.window} data-testid="usage-window">
        <Meter label={t('usage.credits')} value={Math.round(credits.credits.usedPct)} detail={t('usage.used', { percent: Math.round(credits.credits.usedPct) })} />
        {credits.resetDate && <span className={styles.note}>{t('usage.resets', { date: credits.resetDate })}</span>}
        <span className={styles.note}>{t('usage.remaining', { remaining: credits.credits.remaining, total: credits.credits.entitlement })}</span>
      </div>}
  </Card>
}

/** Subscription limits of each provider (Claude, Codex, Antigravity, Copilot) with reset times. */
export function UsageModal({ open, onOpenChange }: UsageModalProps): ReactElement | null {
  const { t } = useTranslation()
  const byProvider = useAgentCreditsStore((state) => state.byProvider)
  const setSnapshots = useAgentCreditsStore((state) => state.setSnapshots)
  const [copilot, setCopilot] = useState<CopilotCredits | null>(null)
  const [loading, setLoading] = useState(open)
  const [refreshRevision, setRefreshRevision] = useState(0)
  const lastRefreshRevision = useRef(0)
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    if (!open) return
    const timer = window.setInterval(() => setNow(Date.now()), 60_000)
    return () => window.clearInterval(timer)
  }, [open])

  useEffect(() => {
    if (!open) return
    let active = true
    let settled = false
    const force = refreshRevision !== lastRefreshRevision.current
    lastRefreshRevision.current = refreshRevision
    queueMicrotask(() => { if (active && !settled) setLoading(true) })
    void Promise.allSettled([
      window.oxe.agentCredits.get({ provider: 'claude', force }),
      window.oxe.agentCredits.get({ provider: 'codex', force }),
      window.oxe.agentCredits.get({ provider: 'antigravity', force }),
      window.oxe.copilot.credits()
    ]).then(results => {
      settled = true
      if (!active) return
      const [c, x, a, cop] = results
      const updates: Partial<Record<AgentProvider, AgentCreditsSnapshot>> = {}
      if (c.status === 'fulfilled' && c.value) updates.claude = c.value
      if (x.status === 'fulfilled' && x.value) updates.codex = x.value
      if (a.status === 'fulfilled' && a.value) updates.antigravity = a.value
      if (Object.keys(updates).length > 0) setSnapshots(updates)
      setCopilot(cop.status === 'fulfilled' ? cop.value : null)
      setNow(Date.now())
      setLoading(false)
    })
    return () => { active = false }
  }, [open, refreshRevision, setSnapshots])

  if (!open) return null
  return <Dialog title={t('usage.title')} size="lg" testId="usage-modal" onClose={() => onOpenChange(false)}
    description={loading ? t('usage.reading') : t('usage.description')}
    footer={<span className={styles.footnote}>{t('usage.footnote')}</span>}>
    <div className={styles.toolbar}>
      <span>{t('usage.timeZone')}</span>
      <Button size="sm" icon={<RefreshCw size={14} className={loading ? styles.spin : undefined} aria-hidden="true" />} disabled={loading} onClick={() => { setLoading(true); setRefreshRevision(value => value + 1) }}>{t('usage.refresh')}</Button>
    </div>
    <div className={styles.roster}>
      <ProviderCard provider="claude" title="Claude" snapshot={byProvider.claude ?? null} now={now} />
      <ProviderCard provider="codex" title="Codex" snapshot={byProvider.codex ?? null} now={now} />
      <ProviderCard provider="antigravity" title="Antigravity" snapshot={byProvider.antigravity ?? null} now={now} />
      <CopilotCard credits={copilot} />
    </div>
  </Dialog>
}
