import { useEffect, useRef, useState, type ReactElement, type ReactNode } from 'react'
import { RefreshCw } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { i18n } from '../../i18n'
import type { AgentCreditsSnapshot, CreditsWindow } from '../../../shared/types/agentCredits'
import type { CopilotCredits } from '../../../shared/types/copilot'
import { Badge, Button, Dialog, Meter } from '../../ui'
import styles from './UsageModal.module.css'
import { formatDateTime } from '../../utils/formatTime'

interface UsageModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

function fmtReset(ms: number | null): string {
  if (!ms) return i18n.t('usage.resetUnknown')
  const diff = ms - Date.now()
  if (diff <= 0) return i18n.t('usage.resetting')
  const minutes = Math.floor(diff / 60_000)
  const hours = Math.floor(minutes / 60)
  const days = Math.floor(hours / 24)
  return i18n.t('usage.resetsIn', { time: days >= 1 ? `${days}d` : hours >= 1 ? `${hours}h` : `${Math.max(1, minutes)}m` })
}

function WindowRow({ window }: { window: CreditsWindow }): ReactElement {
  const { t } = useTranslation()
  return <div className={styles.window} data-testid="usage-window">
    <Meter label={window.kind === 'session' ? t('usage.session') : t('usage.week')} value={Math.round(window.usedPct)} detail={t('usage.used', { percent: Math.round(window.usedPct) })} />
    <span className={styles.note} title={window.resetsAtMs ? formatDateTime(window.resetsAtMs) : undefined}>{fmtReset(window.resetsAtMs)}</span>
  </div>
}

function Card({ title, meta, testId, children, footer }: { title: string; meta?: ReactNode; testId: string; children: ReactNode; footer?: ReactNode }): ReactElement {
  return <section className={styles.card} data-testid={testId} aria-label={title}>
    <header className={styles.cardHead}><h3>{title}</h3>{meta}</header>
    <div className={styles.cardBody}>{children}</div>
    {footer && <footer className={styles.cardFoot}>{footer}</footer>}
  </section>
}

function ProviderCard({ title, snapshot }: { title: string; snapshot: AgentCreditsSnapshot | null }): ReactElement {
  const { t } = useTranslation()
  const source = snapshot?.source === 'oauth' ? t('usage.source.oauth') : snapshot?.source === 'local-session' ? t('usage.source.local') : t('usage.source.account')
  const checked = snapshot?.observedAtMs ? ` · ${t('usage.checked', { time: formatDateTime(snapshot.observedAtMs, { hour: '2-digit', minute: '2-digit' }) })}` : ''
  return <Card title={title} testId={`usage-card-${title.toLowerCase()}`}
    meta={snapshot?.stale ? <Badge intent="warning">{t('usage.lastKnown')}</Badge> : snapshot?.planLabel ? <Badge>{snapshot.planLabel}</Badge> : <Badge>{t('usage.subscription')}</Badge>}
    footer={<>{snapshot?.stale && <span className={styles.stale}>{t('usage.stale')}</span>}<span>{source}{checked}</span></>}>
    {!snapshot || !snapshot.installed ? <p className={styles.note}>{t('usage.notDetected')}</p>
      : snapshot.error && !snapshot.stale ? <p className={styles.error}>{snapshot.error}</p>
      : snapshot.windows.length === 0 ? <p className={styles.note}>{t('usage.noQuota')}</p>
      : snapshot.windows.map(window => <WindowRow key={window.kind} window={window} />)}
  </Card>
}

function CopilotCard({ credits }: { credits: CopilotCredits | null }): ReactElement {
  const { t } = useTranslation()
  return <Card title="Copilot" testId="usage-card-copilot" meta={credits?.plan ? <Badge>{credits.plan}</Badge> : undefined}>
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

/** Subscription limits of each provider (Claude, Codex, Copilot) with reset times. */
export function UsageModal({ open, onOpenChange }: UsageModalProps): ReactElement | null {
  const { t } = useTranslation()
  const [claude, setClaude] = useState<AgentCreditsSnapshot | null>(null)
  const [codex, setCodex] = useState<AgentCreditsSnapshot | null>(null)
  const [copilot, setCopilot] = useState<CopilotCredits | null>(null)
  const [loading, setLoading] = useState(false)
  const [refreshRevision, setRefreshRevision] = useState(0)
  const lastRefreshRevision = useRef(0)
  const [, setClock] = useState(0)

  useEffect(() => {
    if (!open) return
    const timer = window.setInterval(() => setClock(value => value + 1), 60_000)
    return () => window.clearInterval(timer)
  }, [open])

  useEffect(() => {
    if (!open) return
    let active = true
    const force = refreshRevision !== lastRefreshRevision.current
    lastRefreshRevision.current = refreshRevision
    setLoading(true)
    void Promise.allSettled([
      window.oxe.agentCredits.get({ provider: 'claude', force }),
      window.oxe.agentCredits.get({ provider: 'codex', force }),
      window.oxe.copilot.credits()
    ]).then(results => {
      if (!active) return
      const [c, x, cop] = results
      setClaude(c.status === 'fulfilled' ? c.value : null)
      setCodex(x.status === 'fulfilled' ? x.value : null)
      setCopilot(cop.status === 'fulfilled' ? cop.value : null)
      setLoading(false)
    })
    return () => { active = false }
  }, [open, refreshRevision])

  if (!open) return null
  return <Dialog title={t('usage.title')} size="lg" testId="usage-modal" onClose={() => onOpenChange(false)}
    description={loading ? t('usage.reading') : t('usage.description')}
    footer={<span className={styles.footnote}>{t('usage.footnote')}</span>}>
    <div className={styles.toolbar}>
      <span>{t('usage.timeZone')}</span>
      <Button size="sm" icon={<RefreshCw size={14} className={loading ? styles.spin : undefined} aria-hidden="true" />} disabled={loading} onClick={() => setRefreshRevision(value => value + 1)}>{t('usage.refresh')}</Button>
    </div>
    <div className={styles.roster}>
      <ProviderCard title="Claude" snapshot={claude} />
      <ProviderCard title="Codex" snapshot={codex} />
      <CopilotCard credits={copilot} />
    </div>
  </Dialog>
}
