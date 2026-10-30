import { useEffect, useState } from 'react'
import type { ThreadTurnUsage, ThreadUsageBucket, ThreadUsageSummary } from '../../../shared/types/thread'
import { formatThreadCost } from './threadCost'
import { useTranslation } from 'react-i18next'
import { EmptyState, ErrorState, Select, LoadingState } from '../../ui'
import { humanizeError } from '../../utils/humanizeError'
import { formatDateTime, formatNumber } from '../../utils/formatTime'
import { i18n } from '../../i18n'
import { ThreadRichText } from './ThreadRichText'

type Scope = ThreadUsageSummary['scope']
const SCOPES: Scope[] = ['thread', 'project', 'all']
const PERIODS = [7, 30, 90] as const

export const compactTokens = (n: number): string => n >= 1_000_000 ? `${formatNumber(n / 1_000_000, { minimumFractionDigits: 1, maximumFractionDigits: 1 })}M` : n >= 1_000 ? `${formatNumber(Math.round(n / 1_000))}k` : formatNumber(Math.round(n))
const tokens = (bucket: ThreadUsageBucket): number => bucket.inputTokens + bucket.outputTokens + bucket.cacheReadTokens

/** Cost when the provider reported one, otherwise the tokens; Codex reports tokens only. */
export function usageLabel(bucket: ThreadUsageBucket): string {
  const t = i18n.t.bind(i18n)
  const parts = [t('thread:spending.turns', { count: bucket.turns }), t('thread:spending.tokens', { tokens: compactTokens(tokens(bucket)) })]
  if (bucket.pricedTurns) parts.unshift(t(bucket.pricedTurns < bucket.turns ? 'thread:spending.costUnpriced' : 'thread:spending.cost', { cost: formatThreadCost(bucket.usd) }))
  return parts.join(' · ')
}

function Buckets({ title, buckets, metric }: { title: string; buckets: ThreadUsageBucket[]; metric: (bucket: ThreadUsageBucket) => number }) {
  const { t } = useTranslation('thread')
  const max = Math.max(1, ...buckets.map(metric))
  return <section>
    <h3>{title}</h3>
    {buckets.length === 0 ? <EmptyState compact title={t('spending.nothing')} /> : <ul className="thread-usage-list">
      {buckets.map(bucket => <li key={bucket.key}>
        <span className="thread-usage-label" title={bucket.label}>{bucket.label}</span>
        <span className="thread-usage-bar" aria-hidden="true"><span style={{ width: `${Math.max(2, Math.round(metric(bucket) / max * 100))}%` }} /></span>
        <span className="thread-usage-value">{usageLabel(bucket)}</span>
      </li>)}
    </ul>}
  </section>
}

/** Context a request of this turn sent: the turn's context over its requests (one plus one per tool call). */
export const contextPerRequest = (turn: ThreadTurnUsage): number | undefined => turn.steps === undefined ? undefined : turn.contextTokens / (turn.steps + 1)
/** Past this, every step of the conversation resends a large context, and compacting it pays off. */
export const LARGE_CONTEXT = 100_000

/** The conversation's latest turns: what each one sent and did, so a long conversation shows where tokens go. */
function Turns({ turns }: { turns: ThreadTurnUsage[] }) {
  const { t } = useTranslation('thread')
  const latest = turns[0] ? contextPerRequest(turns[0]) : undefined
  return <section>
    <h3>{t('spending.recent')}</h3>
    {latest !== undefined && latest >= LARGE_CONTEXT && <p className="thread-usage-advice" role="note">
      <ThreadRichText text={t('spending.advice', { tokens: compactTokens(latest) })} /></p>}
    {turns.length === 0 ? <EmptyState compact title={t('spending.noTurns')} /> : <table className="thread-usage-turns">
      <thead><tr><th scope="col">{t('spending.when')}</th><th scope="col">{t('spending.context')}</th><th scope="col">{t('spending.steps')}</th><th scope="col">{t('spending.output')}</th><th scope="col">{t('spending.costColumn')}</th></tr></thead>
      <tbody>{turns.map(turn => <tr key={`${turn.at}:${turn.contextTokens}`}>
        <td>{formatDateTime(turn.at, { dateStyle: 'short', timeStyle: 'short' })}</td>
        <td title={contextPerRequest(turn) === undefined ? undefined : t('spending.perRequest', { tokens: compactTokens(contextPerRequest(turn)!) })}>{compactTokens(turn.contextTokens)}</td>
        <td>{turn.steps ?? '—'}</td>
        <td>{compactTokens(turn.outputTokens)}</td>
        <td>{turn.usd === undefined ? '—' : t('spending.cost', { cost: formatThreadCost(turn.usd) })}</td>
      </tr>)}</tbody>
    </table>}
  </section>
}

/** Spending recorded for each finished turn, by day, model and conversation. */
export default function ThreadUsagePanel({ threadId }: { threadId: string }) {
  const { t } = useTranslation('thread')
  const api = window.oxe?.thread
  const [scope, setScope] = useState<Scope>('thread')
  const [days, setDays] = useState<number>(30)
  const [summary, setSummary] = useState<ThreadUsageSummary | null>(null)
  const [error, setError] = useState('')
  useEffect(() => {
    if (!api?.usageSummary) return
    let live = true
    setError('')
    api.usageSummary(threadId, { scope, days }).then(value => { if (live) setSummary(value) }, cause => { if (live) setError(humanizeError(cause, t('spending.loadFailed'))) })
    return () => { live = false }
  }, [api, threadId, scope, days, t])
  if (!api?.usageSummary) return <EmptyState compact title={t('spending.unavailable')} />
  // Rank by cost when anything was priced, otherwise by tokens.
  const metric = summary?.total.pricedTurns ? (bucket: ThreadUsageBucket) => bucket.usd : tokens
  return <div className="thread-usage">
    {error && <ErrorState compact title={error} />}
    <div className="thread-usage-filters">
      <div role="radiogroup" aria-label={t('spending.scopeLabel')}>{SCOPES.map(value => <label key={value}><input type="radio" name="usage-scope" checked={scope === value} onChange={() => setScope(value)} />{t(`spending.scope.${value}`)}</label>)}</div>
      <Select aria-label={t('spending.period')} value={days} onChange={event => setDays(Number(event.target.value))}>{PERIODS.map(value => <option key={value} value={value}>{t('spending.lastDays', { count: value })}</option>)}</Select>
    </div>
    {!summary ? <LoadingState label={t('spending.loading')} /> : <>
      <p className="thread-usage-total"><strong>{usageLabel(summary.total)}</strong></p>
      <p>{t('spending.note')}</p>
      {summary.turns && <Turns turns={summary.turns} />}
      <Buckets title={t('spending.byDay')} buckets={summary.byDay} metric={metric} />
      <Buckets title={t('spending.byModel')} buckets={summary.byModel} metric={metric} />
      {scope !== 'thread' && <Buckets title={t('spending.byConversation')} buckets={summary.byThread} metric={metric} />}
    </>}
  </div>
}
