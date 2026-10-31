import { useId, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { Badge, ErrorState, LoadingState, Meter, StatusDot, type Intent, type Status } from '../../ui'
import { alerting, type HealthCard, type HealthTone } from './diagnosticsHealth'
import { formatBytes, formatList } from './diagnosticsFormat'
import type { LiveStatus } from './useDiagnostics'
import styles from './Diagnostics.module.css'

const DOT: Record<HealthTone, Status> = { ok: 'success', warning: 'attention', error: 'danger', unknown: 'idle' }
const INTENT: Record<HealthTone, Intent> = { ok: 'success', warning: 'warning', error: 'danger', unknown: 'neutral' }

type Translate = (key: string, values?: Record<string, unknown>) => string

/** The words a card's values need: sizes as sizes, the busiest process by what it is. */
function cardValues(card: HealthCard, tx: Translate): Record<string, string | number> {
  const values: Record<string, string | number> = { ...card.values }
  for (const name of ['bytes', 'logs'] as const) if (typeof values[name] === 'number') values[name] = formatBytes(values[name] as number)
  if (typeof values.kind === 'string') values.kind = tx(`diagnostics.processKind.${values.kind}`)
  return values
}

function CardView({ card, tx }: { card: HealthCard; tx: Translate }): ReactElement {
  const titleId = useId()
  const base = `diagnostics.cards.${card.id}`
  const values = cardValues(card, tx)
  const title = tx(`${base}.title`)
  const tone = tx(`diagnostics.tone.${card.tone}`)
  const figure = card.id === 'network'
    ? tx(`${base}.state.${card.alert === 'offline' ? 'offline' : card.alert === 'unknown' ? 'unknown' : 'online'}`)
    : card.id === 'disk' && card.tone === 'unknown' ? tx(`${base}.figureUnknown`) : tx(`${base}.figure`, values)
  const detail = card.id === 'database' || card.id === 'processes' ? tx(`${base}.detail`, values)
    : card.id === 'network' ? tx(`${base}.phone.${values.phone}`, values) : null
  const alert = `${base}.alerts.${card.alert}`
  const needsAction = card.tone !== 'ok'
  return <article className={styles.card} data-tone={card.tone} aria-labelledby={titleId} data-testid={`diagnostics-card-${card.id}`}>
    <header className={styles.cardHead}>
      <StatusDot status={DOT[card.tone]} label={tone} />
      <h4 id={titleId} className={styles.cardTitle}>{title}</h4>
      <Badge intent={INTENT[card.tone]} className={styles.cardBadge}>{tone}</Badge>
    </header>
    {card.meter
      ? <Meter label={tx(`${base}.meter`)} value={card.meter.value} max={card.meter.max} detail={figure} />
      : <p className={styles.figure}>{figure}</p>}
    {detail && <p className={styles.detail}>{detail}</p>}
    <p className={styles.alert}>{tx(`${alert}.text`, values)}</p>
    {needsAction && <p className={styles.action}><strong>{tx('diagnostics.health.whatToDo')}</strong> {tx(`${alert}.action`)}</p>}
  </article>
}

/**
 * The health cards of the latest measurement. The summary line is the one live region, and it only changes when the
 * set of cards needing attention changes: the numbers update quietly every few seconds.
 */
export function HealthCards({ cards, status }: { cards: HealthCard[] | null; status: LiveStatus }): ReactElement {
  const { t } = useTranslation('settings')
  const tx: Translate = (key, values) => t(key as never, values as never) as unknown as string
  const attention = cards ? alerting(cards) : []
  // Its text depends only on which cards alert (and the language), so the DOM, and the announcement, change only then.
  const summary = attention.length
    ? tx('diagnostics.health.attention', { cards: formatList(attention.map(card => tx(`diagnostics.cards.${card.id}.title`))) })
    : tx('diagnostics.health.allClear')

  if (status === 'unavailable') return <p className={styles.note}>{tx('diagnostics.health.unavailable')}</p>
  if (status === 'failed') return <ErrorState compact title={tx('diagnostics.health.failed')} />
  return <>
    <p className={styles.summary} role="status" data-testid="diagnostics-health-summary" data-tone={attention[0]?.tone ?? 'ok'}>{cards ? summary : ''}</p>
    {cards
      ? <div className={styles.cards} data-testid="diagnostics-health">{cards.map(card => <CardView key={card.id} card={card} tx={tx} />)}</div>
      : <LoadingState label={tx('diagnostics.health.loading')} />}
  </>
}
