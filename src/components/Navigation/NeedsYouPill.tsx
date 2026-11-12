import { Check } from 'lucide-react'
import type { ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { useAttentionSummary } from '../../hooks/useAttentionSummary'
import { withShortcut } from '../../keyboard/keybindings'
import { cx } from '../../ui'
import { useApprovalsStore } from '../Approvals/approvals.store'
import { OPEN_APPROVAL_QUEUE_EVENT } from '../Approvals/approvalsBoot'
import styles from './TitleBar.module.css'

/**
 * Title-bar approval queue pill (Playground parity D1.2): shows how many agents and panels are waiting
 * on a person across Code, Chat and dock tools, and opens the Approvals queue (`Ctrl+Shift+A`) on click.
 */
export function NeedsYouPill(): ReactElement {
  const { t } = useTranslation()
  const attention = useAttentionSummary()
  const paneWaiting = useApprovalsStore(state => state.queue.length)
  const count = attention.code.needsYou + attention.thread.needsYou + paneWaiting
  const label = count > 0 ? t('attention.needsYou', { count }) : t('attention.nothingWaiting')
  const title = withShortcut(t('attention.approvalsWaiting'), 'approvals.queue')

  return (
    <span className={styles.needsSlot}>
      {/* The slot is as wide as the text shown most of the time, so the command bar beside it stays where it is when
          something starts waiting. Never read, never clicked. */}
      {count > 0 && <span className={cx(styles.needs, styles.needsZero, styles.needsSizer)} aria-hidden="true"><Check size={12} aria-hidden="true" /><span>{t('attention.nothingWaiting')}</span></span>}
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
    </span>
  )
}
