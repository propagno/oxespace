import { Button, EmptyState, ErrorState, Spinner } from '../../ui'
import { useRef, useState } from 'react'
import { AlertCircle, ChevronDown, RefreshCw } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { ThreadEvent, ThreadFailure, ThreadUsage } from '../../../shared/types/thread'
import { failureGuidance } from '../../../shared/threadTurnVerdict'
import { i18n } from '../../i18n'
import './ThreadFailureCard.css'
import { formatDateTime, formatNumber } from '../../utils/formatTime'

/** Failure codes with a title of their own; anything else reads as a generic failure. */
const TITLED = new Set<string>(['authentication', 'usage', 'rate-limit', 'context', 'budget', 'server', 'network', 'sandbox', 'configuration', 'session-busy', 'unknown'])

export function usageTime(timestamp: number): string {
  return Number.isFinite(timestamp) && !Number.isNaN(new Date(timestamp).getTime())
    ? formatDateTime(timestamp, { dateStyle: 'short', timeStyle: 'long' }) : i18n.t('thread:failure.notProvided')
}

/** "2h", "6d", "35m": how long until a window resets, as in the Usage & rate limits dialog. */
export function usageResetIn(timestamp: number, now = Date.now()): string {
  const minutes = Math.max(0, Math.round((timestamp - now) / 60_000))
  if (minutes < 60) return i18n.t('thread:failure.minutes', { value: Math.max(1, minutes) })
  if (minutes < 60 * 48) return i18n.t('thread:failure.hours', { value: Math.round(minutes / 60) })
  return i18n.t('thread:failure.days', { value: Math.round(minutes / 1440) })
}

const usageClock = (timestamp: number): string => Number.isFinite(timestamp) ? formatDateTime(timestamp, { hour: '2-digit', minute: '2-digit' }) : i18n.t('thread:failure.unknownTime')

/** Same card language as the Usage & rate limits dialog: provider, two-up windows, reset hint, checked time. */
export function ThreadUsageDetails({ usage, provider }: { usage: ThreadUsage; provider?: string }) {
  const { t } = useTranslation('thread')
  // Windows arrive labelled "codex · Session · 5 hours"; the provider becomes the card title.
  const prefix = usage.windows[0]?.label.split(' · ')[0] ?? ''
  const known = /^(codex|claude|copilot)$/i.test(prefix) ? prefix : undefined
  const owner = provider ?? known
  const name = owner ? owner[0].toUpperCase() + owner.slice(1).toLowerCase() : t('failure.usageLimits')
  const labelOf = (label: string): string => known && label.toLowerCase().startsWith(`${known.toLowerCase()} · `) ? label.slice(known.length + 3) : label
  return <section className="thread-usage-card" aria-label={t('failure.providerUsage')}>
    <header><strong>{name}</strong><span>{t('failure.subscriptionLimits')}</span></header>
    {usage.windows.length ? <div className="thread-usage-grid">{usage.windows.map((window, index) => {
      const percent = Math.max(0, Math.min(100, window.usedPercent))
      return <div className="thread-usage-window" key={`${window.label}:${index}`}>
        <div><span>{labelOf(window.label)}</span><strong>{t('failure.used', { percent: formatNumber(window.usedPercent, { maximumFractionDigits: 1 }) })}</strong></div>
        <progress className={percent >= 90 ? 'is-high' : undefined} aria-label={t('failure.windowUsage', { label: window.label })} value={percent} max={100} />
        <small>{window.resetsAt ? <>{t('failure.resetsIn', { time: usageResetIn(window.resetsAt) })} · <time dateTime={new Date(window.resetsAt).toISOString()}>{usageTime(window.resetsAt)}</time> · {t('failure.localTime')}</> : t('failure.noReset')}</small>
      </div>
    })}</div> : <EmptyState compact title={t('failure.noWindows')} />}
    <footer>{t('failure.checked', { name, time: usageClock(usage.checkedAt) })}</footer>
  </section>
}

export function ThreadFailureCard({ event, latest, refreshUsage, onAccounts, onRetry, hasChanges, onCompact, onPermissions, disabled }: {
  event: Extract<ThreadEvent, { type: 'completed' }>; latest: boolean
  refreshUsage?: () => Promise<ThreadUsage>; onAccounts?: () => void
  /** Sends the turn again; `restoreFiles` undoes this turn's file changes first. */
  onRetry?: (restoreFiles: boolean) => void
  /** The failed turn changed files: retrying offers to undo them first, so the attempts do not pile up. */
  hasChanges?: boolean
  /** Offered when the context window is full. */
  onCompact?: () => void
  /** Offered when the sandbox or the configuration blocked the turn. */
  onPermissions?: () => void
  disabled?: boolean
}) {
  const { t } = useTranslation('thread')
  const failure = event.failure
  const [currentUsage, setCurrentUsage] = useState<ThreadUsage>(), [loading, setLoading] = useState(false), [refreshError, setRefreshError] = useState('')
  const refreshing = useRef(false)
  const [choosingRetry, setChoosingRetry] = useState(false)
  const usage = currentUsage && (!failure?.usage || currentUsage.checkedAt >= failure.usage.checkedAt) ? currentUsage : failure?.usage
  // Previously saved failures were classified as unknown; render them correctly without rewriting history.
  const code = failure?.detail && /already has an active writer|active writer/i.test(failure.detail) ? 'session-busy' : failure?.code ?? event.errorCode
  // Older events carry only a free-form errorCode; anything unrecognised reads as a generic failure.
  const guidance = failureGuidance(code as ThreadFailure['code'] | undefined)
  const title = t(`failure.title.${(code && TITLED.has(code) ? code : 'unknown') as ThreadFailure['code']}`)
  // Retrying is offered only where sending the same turn again can succeed without changing anything.
  const retry = onRetry && (guidance.retryable || guidance.action === 'wait') ? onRetry : undefined
  const compact = guidance.action === 'compact' ? onCompact : undefined
  const permissions = guidance.action === 'review-permissions' || guidance.action === 'change-configuration' ? onPermissions : undefined
  const refresh = async () => {
    if (!refreshUsage || refreshing.current) return
    refreshing.current = true; setLoading(true); setRefreshError('')
    try { setCurrentUsage(await refreshUsage()) }
    catch { setRefreshError(t('failure.refreshFailed')) }
    finally { refreshing.current = false; setLoading(false) }
  }
  return <details className="thread-turn-error thread-failure-card" open={latest}>
    <summary><AlertCircle size={14} /><strong>{title}</strong>{failure && <time dateTime={new Date(failure.occurredAt).toISOString()}>{usageTime(failure.occurredAt)}</time>}<ChevronDown size={14} /></summary>
    <div className="thread-failure-body">
      <p>{code === 'session-busy' ? t('failure.sessionBusy') : failure?.message ?? (code === 'authentication' ? t('failure.reconnect') : event.error ?? t('failure.couldNotFinish'))}</p>
      {failure?.detail && <pre className="thread-failure-diagnostic" aria-label={t('failure.diagnostic')}>{failure.detail}</pre>}
      {(failure?.providerCode || failure?.httpStatus) && <div className="thread-failure-codes">{failure.providerCode && <code>{failure.providerCode}</code>}{failure.httpStatus && <code>HTTP {failure.httpStatus}</code>}</div>}
      {usage && <ThreadUsageDetails usage={usage} />}
      {!usage && code !== 'authentication' && code !== 'session-busy' && <p className="thread-failure-note">{failure?.usageUnavailable ? t('failure.usageUnavailable') : refreshUsage && failure ? t('failure.checkingUsage') : t('failure.notRecorded')}</p>}
      {usage && failure?.usageUnavailable && !currentUsage && <p className="thread-failure-note">{t('failure.staleUsage')}</p>}
      {refreshError && <ErrorState compact title={refreshError} />}
      {/* A sign-in failure is acted on in the account notice above the composer, which follows the account state; repeating Reconnect here doubled it. */}
      {code !== 'session-busy' && code !== 'authentication' && (refreshUsage || retry || compact || permissions) && <footer>
        {compact && <Button size="sm" disabled={disabled} onClick={compact}>{t('failure.compact')}</Button>}
        {permissions && <Button size="sm" disabled={disabled} onClick={permissions}>{guidance.action === 'review-permissions' ? t('failure.reviewPermissions') : t('failure.changeConfiguration')}</Button>}
        {retry && !choosingRetry && <Button size="sm" disabled={disabled} onClick={() => hasChanges ? setChoosingRetry(true) : retry(false)}>{t('failure.retry')}</Button>}
        {retry && choosingRetry && <span className="thread-retry-choice" role="group" aria-label={t('failure.retryGroup')}>
          <span>{t('failure.changedFiles')}</span>
          <Button size="sm" variant="primary" disabled={disabled} onClick={() => { setChoosingRetry(false); retry(true) }}>{t('failure.undoAndRetry')}</Button>
          <Button size="sm" disabled={disabled} onClick={() => { setChoosingRetry(false); retry(false) }}>{t('failure.retryKeep')}</Button>
          <Button size="sm" variant="ghost" onClick={() => setChoosingRetry(false)}>{t('common.cancel')}</Button>
        </span>}
        {refreshUsage && <Button size="sm" variant="ghost" disabled={loading} icon={loading ? <Spinner size="sm" decorative /> : <RefreshCw size={14} />} onClick={() => void refresh()}>{loading ? t('failure.checking') : t('failure.refresh')}</Button>}
      </footer>}
    </div>
  </details>
}
