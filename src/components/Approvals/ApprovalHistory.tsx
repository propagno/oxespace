import type { ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { Badge, Button, Dialog, EmptyState, type Intent } from '../../ui'
import { useApprovalsStore } from './approvals.store'
import { isQueueFull, type ApprovalHistoryRow } from './approvalsRules'
import { approvalT as t, formatMainMessage, formatTime, requesterText, riskName } from './approvalText'
import styles from './Approvals.module.css'

/** Who settled it, in words. Only `by: 'user'` is the person's decision; the rest say what the app did. */
function decision(row: ApprovalHistoryRow): { text: string; intent: Intent } {
  if (isQueueFull(row)) return { text: t('approvals.by.queueFull'), intent: 'neutral' }
  if (row.by !== 'user') return { text: t(`approvals.by.${row.by}`), intent: 'neutral' }
  return { text: t(`approvals.outcome.${row.outcome}`), intent: row.outcome === 'deny' ? 'neutral' : 'warning' }
}

/** This session's approval decisions, newest first: when, what, who asked and what was decided. */
export function ApprovalHistory({ onClose, hasPending }: { onClose: () => void; hasPending: boolean }): ReactElement {
  useTranslation()
  const rows = useApprovalsStore(state => state.history)
  return <Dialog title={t('approvals.history.title')} description={t('approvals.history.description')} size="lg" onClose={onClose} testId="approval-history"
    footer={hasPending
      ? <Button variant="primary" autoFocus onClick={onClose}>{t('approvals.history.back')}</Button>
      : <Button variant="secondary" autoFocus onClick={onClose}>{t('approvals.history.close')}</Button>}>
    {rows.length === 0
      ? <EmptyState title={t('approvals.history.empty')} />
      : <table className={styles.history}>
        <thead><tr>
          <th scope="col">{t('approvals.history.columns.time')}</th>
          <th scope="col">{t('approvals.history.columns.what')}</th>
          <th scope="col">{t('approvals.history.columns.who')}</th>
          <th scope="col">{t('approvals.history.columns.decision')}</th>
        </tr></thead>
        <tbody>{rows.map(row => {
          const result = decision(row)
          return <tr key={row.id} data-testid="approval-history-row" data-by={row.by}>
            <td className={styles.muted}><time dateTime={new Date(row.resolvedAt).toISOString()}>{formatTime(row.resolvedAt)}</time></td>
            <td>{formatMainMessage(row.summary)}<span className={styles.muted}> · {t('approvals.risk.label', { level: riskName(row.risk) })}</span></td>
            <td>{requesterText(row.requester)}</td>
            <td><Badge intent={result.intent}>{result.text}</Badge></td>
          </tr>
        })}</tbody>
      </table>}
  </Dialog>
}
