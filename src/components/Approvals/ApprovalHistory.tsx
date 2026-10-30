import type { ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { Badge, Button, Dialog, EmptyState, type Intent } from '../../ui'
import type { ApprovalHistoryEntry } from './approvalsContract'
import { useApprovalsStore } from './approvals.store'
import { approvalT as t, formatTime, kindName, requesterText, riskName } from './approvalText'
import styles from './Approvals.module.css'

function decision(entry: ApprovalHistoryEntry): { text: string; intent: Intent } {
  if (entry.by === 'timeout') return { text: t('approvals.by.timeout'), intent: 'neutral' }
  if (entry.by === 'cancelled') return { text: t('approvals.by.cancelled'), intent: 'neutral' }
  return { text: t(`approvals.outcome.${entry.outcome}`), intent: entry.outcome === 'deny' ? 'neutral' : 'warning' }
}

/** This session's approval decisions, newest first: when, what, who asked and what was decided. */
export function ApprovalHistory({ onClose, hasPending }: { onClose: () => void; hasPending: boolean }): ReactElement {
  useTranslation()
  const history = useApprovalsStore(state => state.history)
  const rows = [...history].reverse()
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
        <tbody>{rows.map(entry => {
          const result = decision(entry)
          return <tr key={entry.id} data-testid="approval-history-row">
            <td className={styles.muted}><time dateTime={new Date(entry.at).toISOString()}>{formatTime(entry.at)}</time></td>
            <td>{kindName(entry.kind)}<span className={styles.muted}> · {t('approvals.risk.label', { level: riskName(entry.risk) })}{entry.environment ? ` · ${entry.environment.name}` : ''}</span></td>
            <td>{requesterText(entry.requester)}</td>
            <td><Badge intent={result.intent}>{result.text}</Badge></td>
          </tr>
        })}</tbody>
      </table>}
  </Dialog>
}
