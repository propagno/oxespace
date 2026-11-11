import { Check } from 'lucide-react'
import type { ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { useAttentionSummary } from '../../hooks/useAttentionSummary'
import { withShortcut } from '../../keyboard/keybindings'
import { cx } from '../../ui'
import { OPEN_APPROVAL_QUEUE_EVENT } from '../Approvals/approvalsBoot'
import styles from './TitleBar.module.css'

/**
 * Title-bar approval queue pill (Playground parity D1.2): shows how many agents are waiting
 * on a person across Code and Chat, and opens ApprovalQueueModal (`Ctrl+Shift+A`) on click.
 */
export function NeedsYouPill(): ReactElement {
  const { t } = useTranslation()
  const attention = useAttentionSummary()
  const count = attention.code.needsYou + attention.thread.needsYou
  const label = count > 0 ? t('attention.needsYou', { count }) : t('attention.nothingWaiting')
  const title = withShortcut(t('attention.approvalsWaiting'), 'approvals.queue')

  return (
    <button
      type="button"
      className={cx(styles.needs, count === 0 && styles.needsZero)}
      title={title}
      data-testid="needs-you-pill"
      onClick={() => window.dispatchEvent(new CustomEvent(OPEN_APPROVAL_QUEUE_EVENT))}
    >
      {count > 0 ? <span className={styles.sun} aria-hidden="true" /> : <Check size={12} aria-hidden="true" />}
      <span>{label}</span>
    </button>
  )
}
