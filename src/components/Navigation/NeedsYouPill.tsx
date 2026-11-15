import type { ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { useAttentionSummary } from '../../hooks/useAttentionSummary'
import { withShortcut } from '../../keyboard/keybindings'
import { cx } from '../../ui'
import { useApprovalsStore } from '../Approvals/approvals.store'
import { OPEN_APPROVAL_QUEUE_EVENT } from '../Approvals/approvalsBoot'
import styles from './TitleBar.module.css'

/**
 * Title-bar approval queue pill (BRD-09): there only while something waits on a person across Code, Chat and dock
 * tools, it says how many and opens the Approvals queue (`Ctrl+Shift+A`) on click. With nothing waiting it is not drawn:
 * an invisible slot as wide as the pill holds its place, so the command field beside it never moves. Never read, never clicked.
 */
export function NeedsYouPill(): ReactElement {
  const { t } = useTranslation()
  const attention = useAttentionSummary()
  const paneWaiting = useApprovalsStore(state => state.queue.length)
  const count = attention.code.needsYou + attention.thread.needsYou + paneWaiting
  if (count === 0) {
    return (
      <span className={cx(styles.needs, styles.needsSlot)} aria-hidden="true">
        <span className={styles.sun} />
        <span>{t('attention.needsYou', { count: 1 })}</span>
      </span>
    )
  }
  return (
    <button
      type="button"
      className={styles.needs}
      title={withShortcut(t('attention.approvalsWaiting'), 'approvals.queue')}
      data-testid="needs-you-pill"
      onClick={() => window.dispatchEvent(new CustomEvent(OPEN_APPROVAL_QUEUE_EVENT))}
    >
      <span className={styles.sun} aria-hidden="true" />
      <span>{t('attention.needsYou', { count })}</span>
    </button>
  )
}
