import type { ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '../../ui'
import styles from './DelegationNotice.module.css'

/** The note that a delegated task changed, in the window's corner, until it is viewed or dismissed. */
export function DelegationNotice({ onView, onDismiss }: { onView: () => void; onDismiss: () => void }): ReactElement {
  const { t } = useTranslation('code')
  return <div role="status" className={styles.notice}>
    <p>{t('delegated.notice')}</p>
    <Button variant="secondary" onClick={onView}>{t('delegated.view')}</Button>
    <Button variant="secondary" onClick={onDismiss}>{t('ui.dismiss', { ns: 'common' })}</Button>
  </div>
}
