import { useEffect, useState } from 'react'
import type { ThreadTurnUsage, ThreadUsageBucket, ThreadUsageSummary } from '../../../shared/types/thread'
import { formatThreadCost } from './threadCost'
import { Select, LoadingState } from '../../ui'
import { humanizeError } from '../../utils/humanizeError'

type Scope = ThreadUsageSummary['scope']
const SCOPES: [Scope, string][] = [['thread', 'This conversation'], ['project', 'This project'], ['all', 'All projects']]
const PERIODS = [7, 30, 90] as const

export const compactTokens = (n: number): string => n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1_000 ? `${Math.round(n / 1_000)}k` : String(Math.round(n))
const tokens = (bucket: ThreadUsageBucket): number => bucket.inputTokens + bucket.outputTokens + bucket.cacheReadTokens

/** Cost when the provider reported one, otherwise the tokens; Codex reports tokens only. */
export function usageLabel(bucket: ThreadUsageBucket): string {
  const parts = [`${bucket.turns} ${bucket.turns === 1 ? 'turn' : 'turns'}`, `${compactTokens(tokens(bucket))} tokens`]
  if (bucket.pricedTurns) parts.unshift(`≈ ${formatThreadCost(bucket.usd)}${bucket.pricedTurns < bucket.turns ? ' + unpriced turns' : ''}`)
  return parts.join(' · ')
}

function Buckets({ title, buckets, metric }: { title: string; buckets: ThreadUsageBucket[]; metric: (bucket: ThreadUsageBucket) => number }) {
  const max = Math.max(1, ...buckets.map(metric))
  return <section>
    <h3>{title}</h3>
    {buckets.length === 0 ? <p>Nothing recorded in this period.</p> : <ul className="thread-usage-list">
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
  const latest = turns[0] ? contextPerRequest(turns[0]) : undefined
  return <section>
    <h3>Recent turns</h3>
    {latest !== undefined && latest >= LARGE_CONTEXT && <p className="thread-usage-advice" role="note">
      Each request in this conversation sends about {compactTokens(latest)} tokens of context, and a turn makes one request per step.
      <code>/compact</code> summarizes the conversation so the next turns send less.</p>}
    {turns.length === 0 ? <p>No turns recorded in this period.</p> : <table className="thread-usage-turns">
      <thead><tr><th scope="col">When</th><th scope="col">Context sent</th><th scope="col">Steps</th><th scope="col">Output</th><th scope="col">Cost</th></tr></thead>
      <tbody>{turns.map(turn => <tr key={`${turn.at}:${turn.contextTokens}`}>
        <td>{new Date(turn.at).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })}</td>
        <td title={contextPerRequest(turn) === undefined ? undefined : `about ${compactTokens(contextPerRequest(turn)!)} per request`}>{compactTokens(turn.contextTokens)}</td>
        <td>{turn.steps ?? '—'}</td>
        <td>{compactTokens(turn.outputTokens)}</td>
        <td>{turn.usd === undefined ? '—' : `≈ ${formatThreadCost(turn.usd)}`}</td>
      </tr>)}</tbody>
    </table>}
  </section>
}

/** Spending recorded for each finished turn, by day, model and conversation. */
export default function ThreadUsagePanel({ threadId }: { threadId: string }) {
  const api = window.oxe?.thread
  const [scope, setScope] = useState<Scope>('thread')
  const [days, setDays] = useState<number>(30)
  const [summary, setSummary] = useState<ThreadUsageSummary | null>(null)
  const [error, setError] = useState('')
  useEffect(() => {
    if (!api?.usageSummary) return
    let live = true
    setError('')
    api.usageSummary(threadId, { scope, days }).then(value => { if (live) setSummary(value) }, cause => { if (live) setError(humanizeError(cause, 'Could not load spending')) })
    return () => { live = false }
  }, [api, threadId, scope, days])
  if (!api?.usageSummary) return <p>Spending is not available in this build.</p>
  // Rank by cost when anything was priced, otherwise by tokens.
  const metric = summary?.total.pricedTurns ? (bucket: ThreadUsageBucket) => bucket.usd : tokens
  return <div className="thread-usage">
    {error && <p role="alert">{error}</p>}
    <div className="thread-usage-filters">
      <div role="radiogroup" aria-label="Spending scope">{SCOPES.map(([value, label]) => <label key={value}><input type="radio" name="usage-scope" checked={scope === value} onChange={() => setScope(value)} />{label}</label>)}</div>
      <Select aria-label="Spending period" value={days} onChange={event => setDays(Number(event.target.value))}>{PERIODS.map(value => <option key={value} value={value}>Last {value} days</option>)}</Select>
    </div>
    {!summary ? <LoadingState label="Loading usage…" /> : <>
      <p className="thread-usage-total"><strong>{usageLabel(summary.total)}</strong></p>
      <p>Claude reports an API-equivalent estimate; on a subscription it is not a charge. Codex reports tokens only. Turns are recorded from this version on.</p>
      {summary.turns && <Turns turns={summary.turns} />}
      <Buckets title="By day" buckets={summary.byDay} metric={metric} />
      <Buckets title="By model" buckets={summary.byModel} metric={metric} />
      {scope !== 'thread' && <Buckets title="By conversation" buckets={summary.byThread} metric={metric} />}
    </>}
  </div>
}
