import { useState, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { Button, cx } from '../../ui'
import type { ThreadPendingRequestSummary } from '../../../shared/types/thread'
import styles from './ThreadSidebar.module.css'

/**
 * What a row's mini card offers (OXE-166, OXC-1). A plain permission that carries its command is answered here, once; a
 * critical one (the policy classifier's high risk or red level), a guarded one, a high-impact one or one without a
 * command only opens the conversation; a question opens it to be answered there.
 */
export type RowAttentionKind = 'permission' | 'critical' | 'question' | 'open'

export function rowAttentionKind(request: ThreadPendingRequestSummary): RowAttentionKind {
  if (request.kind === 'question' || request.kind === 'elicitation') return 'question'
  if (request.policy?.risk === 'high' || request.policy?.level === 'red') return 'critical'
  if (request.policy?.guarded || request.impact?.risk === 'high' || request.impact?.risk === 'critical' || !request.command) return 'open'
  return 'permission'
}

/** A critical request's label: the request card's own words, from the policy verdict and the catalog only, never the agent's text. */
function riskKey(request: ThreadPendingRequestSummary): 'request.highRisk' | 'request.destructive' {
  return request.policy?.risk === 'high' ? 'request.highRisk' : 'request.destructive'
}

/**
 * The needs-you mini card of a conversation row. Its data are window.oxe.thread.pendingRequestsAll()'s; Allow once goes
 * through window.oxe.thread.respondPending(), the same path as the approval center.
 */
export function ThreadRowAttention({ request, onOpen, onAnswered }: { request: ThreadPendingRequestSummary; onOpen: () => void; onAnswered?: () => void }): ReactElement {
  const { t } = useTranslation('thread')
  const [busy, setBusy] = useState(false)
  const kind = rowAttentionKind(request)
  const allowOnce = async (): Promise<void> => {
    const respond = window.oxe?.thread?.respondPending
    if (!respond) { onOpen(); return }
    setBusy(true)
    try {
      const result = await respond({ threadId: request.threadId, requestId: request.requestId, generation: request.generation, response: { decision: 'accept' } })
      // A refused answer (answered elsewhere, a newer generation) leaves the decision to the conversation itself.
      if (!result?.ok) onOpen()
    } catch { onOpen() } finally { setBusy(false); onAnswered?.() }
  }
  return <div data-ui="row-attention" data-kind={kind} className={styles.attention} role="group" aria-label={t('status.attention')}>
    {kind === 'permission' && request.command
      ? <code className={cx(styles.attentionText, styles.attentionCommand)} title={request.command}>{request.command}</code>
      : kind === 'critical'
        ? <span className={cx(styles.attentionText, styles.attentionRisk)}>{t(riskKey(request))}</span>
        : <span className={styles.attentionText}>{t('status.attention')}</span>}
    {kind === 'permission'
      ? <Button size="sm" variant="secondary" loading={busy} onClick={() => void allowOnce()}>{t('f7.card.allowOnce')}</Button>
      : <Button size="sm" variant="secondary" onClick={onOpen}>{kind === 'question' ? t('request.answer') : t('f7.card.seeImpact')}</Button>}
  </div>
}
