import { useRef, useState } from 'react'
import { AlertCircle, ChevronDown, Loader2, RefreshCw } from 'lucide-react'
import type { ThreadEvent, ThreadUsage } from '../../../shared/types/thread'
import './ThreadFailureCard.css'

export function usageTime(timestamp: number): string {
  return Number.isFinite(timestamp) && !Number.isNaN(new Date(timestamp).getTime())
    ? new Intl.DateTimeFormat(undefined, { dateStyle: 'short', timeStyle: 'long' }).format(timestamp) : 'Not provided'
}

export function ThreadUsageDetails({ usage }: { usage: ThreadUsage }) {
  return <section className="thread-usage-details" aria-label="Provider usage">
    <header><strong>Usage limits</strong><small>Checked {usageTime(usage.checkedAt)} · local time</small></header>
    {usage.windows.length ? usage.windows.map((window, index) => <div className="thread-usage-window" key={`${window.label}:${index}`}>
      <div><span>{window.label}</span><strong>{window.usedPercent.toLocaleString(undefined, { maximumFractionDigits: 1 })}% used</strong></div>
      <progress aria-label={`${window.label} usage`} value={Math.max(0, Math.min(100, window.usedPercent))} max={100} />
      <small>{window.resetsAt ? <>Resets <time dateTime={new Date(window.resetsAt).toISOString()}>{usageTime(window.resetsAt)}</time> · local time</> : 'Reset time not provided by the provider.'}</small>
    </div>) : <p>The provider did not return usage windows or a reset time.</p>}
  </section>
}

export function ThreadFailureCard({ event, latest, refreshUsage, onAccounts, onRetry, disabled }: {
  event: Extract<ThreadEvent, { type: 'completed' }>; latest: boolean
  refreshUsage?: () => Promise<ThreadUsage>; onAccounts?: () => void; onRetry?: () => void; disabled?: boolean
}) {
  const failure = event.failure
  const [currentUsage, setCurrentUsage] = useState<ThreadUsage>(), [loading, setLoading] = useState(false), [refreshError, setRefreshError] = useState('')
  const refreshing = useRef(false)
  const usage = currentUsage && (!failure?.usage || currentUsage.checkedAt >= failure.usage.checkedAt) ? currentUsage : failure?.usage
  const code = failure?.code ?? event.errorCode
  const title = code === 'authentication' ? 'Sign-in required' : code === 'usage' ? 'Usage allowance exhausted' : code === 'rate-limit' ? 'Request limit reached' : code === 'network' ? 'Connection failed' : code === 'server' ? 'Provider unavailable' : 'Turn failed'
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
      <p>{failure?.message ?? (code === 'authentication' ? 'Reconnect your native agent account to continue.' : event.error ?? 'The agent could not finish this turn.')}</p>
      {failure?.detail && <pre className="thread-failure-diagnostic" aria-label="Provider diagnostic">{failure.detail}</pre>}
      {(failure?.providerCode || failure?.httpStatus) && <div className="thread-failure-codes">{failure.providerCode && <code>{failure.providerCode}</code>}{failure.httpStatus && <code>HTTP {failure.httpStatus}</code>}</div>}
      {usage && <ThreadUsageDetails usage={usage} />}
      {!usage && code !== 'authentication' && <p className="thread-failure-note">{failure?.usageUnavailable ? 'Current usage could not be retrieved. The provider has not confirmed a reset time.' : refreshUsage && failure ? 'Checking current provider usage…' : 'Usage and reset time were not recorded for this failure.'}</p>}
      {usage && failure?.usageUnavailable && !currentUsage && <p className="thread-failure-note">Could not refresh usage. The snapshot above was checked at the displayed time.</p>}
      {refreshError && <p role="alert" className="thread-failure-note">{refreshError}</p>}
      {(refreshUsage || onRetry || code === 'authentication' && onAccounts) && <footer>
        {code === 'authentication' && onAccounts && <button type="button" onClick={onAccounts}>Reconnect account</button>}
        {onRetry && <button type="button" disabled={disabled} onClick={onRetry}>Retry turn</button>}
        {refreshUsage && <button type="button" disabled={loading} onClick={() => void refresh()}>{loading ? <Loader2 size={13} className="thread-spin" /> : <RefreshCw size={13} />}{loading ? 'Checking usage…' : 'Refresh usage'}</button>}
      </footer>}
    </div>
  </details>
}
