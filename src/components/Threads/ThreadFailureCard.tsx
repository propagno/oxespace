import { useRef, useState } from 'react'
import { AlertCircle, ChevronDown, Loader2, RefreshCw } from 'lucide-react'
import type { ThreadEvent, ThreadFailure, ThreadUsage } from '../../../shared/types/thread'
import { failureGuidance } from '../../../shared/threadTurnVerdict'
import './ThreadFailureCard.css'

export function usageTime(timestamp: number): string {
  return Number.isFinite(timestamp) && !Number.isNaN(new Date(timestamp).getTime())
    ? new Intl.DateTimeFormat(undefined, { dateStyle: 'short', timeStyle: 'long' }).format(timestamp) : 'Not provided'
}

/** "2h", "6d", "35m": how long until a window resets, as in the Usage & rate limits dialog. */
export function usageResetIn(timestamp: number, now = Date.now()): string {
  const minutes = Math.max(0, Math.round((timestamp - now) / 60_000))
  if (minutes < 60) return `${Math.max(1, minutes)}m`
  if (minutes < 60 * 48) return `${Math.round(minutes / 60)}h`
  return `${Math.round(minutes / 1440)}d`
}

const usageClock = (timestamp: number): string => Number.isFinite(timestamp) ? new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' }).format(timestamp) : 'unknown'

/** Same card language as the Usage & rate limits dialog: provider, two-up windows, reset hint, checked time. */
export function ThreadUsageDetails({ usage, provider }: { usage: ThreadUsage; provider?: string }) {
  // Windows arrive labelled "codex · Session · 5 hours"; the provider becomes the card title.
  const prefix = usage.windows[0]?.label.split(' · ')[0] ?? ''
  const known = /^(codex|claude|copilot)$/i.test(prefix) ? prefix : undefined
  const owner = provider ?? known
  const name = owner ? owner[0].toUpperCase() + owner.slice(1).toLowerCase() : 'Usage limits'
  const labelOf = (label: string): string => known && label.toLowerCase().startsWith(`${known.toLowerCase()} · `) ? label.slice(known.length + 3) : label
  return <section className="thread-usage-card" aria-label="Provider usage">
    <header><strong>{name}</strong><span>Subscription limits</span></header>
    {usage.windows.length ? <div className="thread-usage-grid">{usage.windows.map((window, index) => {
      const percent = Math.max(0, Math.min(100, window.usedPercent))
      return <div className="thread-usage-window" key={`${window.label}:${index}`}>
        <div><span>{labelOf(window.label)}</span><strong>{window.usedPercent.toLocaleString(undefined, { maximumFractionDigits: 1 })}% used</strong></div>
        <progress className={percent >= 90 ? 'is-high' : undefined} aria-label={`${window.label} usage`} value={percent} max={100} />
        <small>{window.resetsAt ? <>Resets in {usageResetIn(window.resetsAt)} · <time dateTime={new Date(window.resetsAt).toISOString()}>{usageTime(window.resetsAt)}</time> · local time</> : 'Reset time not provided by the provider.'}</small>
      </div>
    })}</div> : <p>The provider did not return usage windows or a reset time.</p>}
    <footer>{name} account · checked {usageClock(usage.checkedAt)} · local time</footer>
  </section>
}

export function ThreadFailureCard({ event, latest, refreshUsage, onAccounts, onRetry, onCompact, onPermissions, disabled }: {
  event: Extract<ThreadEvent, { type: 'completed' }>; latest: boolean
  refreshUsage?: () => Promise<ThreadUsage>; onAccounts?: () => void; onRetry?: () => void
  /** Offered when the context window is full. */
  onCompact?: () => void
  /** Offered when the sandbox or the configuration blocked the turn. */
  onPermissions?: () => void
  disabled?: boolean
}) {
  const failure = event.failure
  const [currentUsage, setCurrentUsage] = useState<ThreadUsage>(), [loading, setLoading] = useState(false), [refreshError, setRefreshError] = useState('')
  const refreshing = useRef(false)
  const usage = currentUsage && (!failure?.usage || currentUsage.checkedAt >= failure.usage.checkedAt) ? currentUsage : failure?.usage
  // Previously saved failures were classified as unknown; render them correctly without rewriting history.
  const code = failure?.detail && /already has an active writer|active writer/i.test(failure.detail) ? 'session-busy' : failure?.code ?? event.errorCode
  // Older events carry only a free-form errorCode; anything unrecognised reads as a generic failure.
  const guidance = failureGuidance(code as ThreadFailure['code'] | undefined)
  const title = guidance.title
  // Retrying is offered only where sending the same turn again can succeed without changing anything.
  const retry = onRetry && (guidance.retryable || guidance.action === 'wait') ? onRetry : undefined
  const compact = guidance.action === 'compact' ? onCompact : undefined
  const permissions = guidance.action === 'review-permissions' || guidance.action === 'change-configuration' ? onPermissions : undefined
  const refresh = async () => {
    if (!refreshUsage || refreshing.current) return
    refreshing.current = true; setLoading(true); setRefreshError('')
    try { setCurrentUsage(await refreshUsage()) }
    catch { setRefreshError('Could not retrieve current usage. Check your account connection and try again. The provider has not confirmed a reset time.') }
    finally { refreshing.current = false; setLoading(false) }
  }
  return <details className="thread-turn-error thread-failure-card" open={latest}>
    <summary><AlertCircle size={14} /><strong>{title}</strong>{failure && <time dateTime={new Date(failure.occurredAt).toISOString()}>{usageTime(failure.occurredAt)}</time>}<ChevronDown size={14} /></summary>
    <div className="thread-failure-body">
      <p>{code === 'session-busy' ? 'This native session is active elsewhere. Finish or close the other Codex session, then send your saved draft again.' : failure?.message ?? (code === 'authentication' ? 'Reconnect your native agent account to continue.' : event.error ?? 'The agent could not finish this turn.')}</p>
      {failure?.detail && <pre className="thread-failure-diagnostic" aria-label="Provider diagnostic">{failure.detail}</pre>}
      {(failure?.providerCode || failure?.httpStatus) && <div className="thread-failure-codes">{failure.providerCode && <code>{failure.providerCode}</code>}{failure.httpStatus && <code>HTTP {failure.httpStatus}</code>}</div>}
      {usage && <ThreadUsageDetails usage={usage} />}
      {!usage && code !== 'authentication' && code !== 'session-busy' && <p className="thread-failure-note">{failure?.usageUnavailable ? 'Current usage could not be retrieved. The provider has not confirmed a reset time.' : refreshUsage && failure ? 'Checking current provider usage…' : 'Usage and reset time were not recorded for this failure.'}</p>}
      {usage && failure?.usageUnavailable && !currentUsage && <p className="thread-failure-note">Could not refresh usage. The snapshot above was checked at the displayed time.</p>}
      {refreshError && <p role="alert" className="thread-failure-note">{refreshError}</p>}
      {(code !== 'session-busy' && (refreshUsage || retry || compact || permissions) || code === 'authentication' && onAccounts) && <footer>
        {code === 'authentication' && onAccounts && <button type="button" onClick={onAccounts}>Reconnect account</button>}
        {compact && <button type="button" disabled={disabled} onClick={compact}>Compact conversation</button>}
        {permissions && <button type="button" disabled={disabled} onClick={permissions}>{guidance.action === 'review-permissions' ? 'Review permissions' : 'Change configuration'}</button>}
        {retry && <button type="button" disabled={disabled} onClick={retry}>Retry turn</button>}
        {refreshUsage && <button type="button" disabled={loading} onClick={() => void refresh()}>{loading ? <Loader2 size={13} className="thread-spin" /> : <RefreshCw size={13} />}{loading ? 'Checking usage…' : 'Refresh usage'}</button>}
      </footer>}
    </div>
  </details>
}
