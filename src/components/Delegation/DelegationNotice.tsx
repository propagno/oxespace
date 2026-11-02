import type { ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '../../ui'

/** The note that a delegated task changed, in the window's corner, until it is viewed or dismissed. */
export function DelegationNotice({ onView, onDismiss }: { onView: () => void; onDismiss: () => void }): ReactElement {
  const { t } = useTranslation('code')
  return <div role="status" style={{ position: 'fixed', bottom: 18, right: 18, zIndex: 'var(--layer-toast)', padding: 14, borderRadius: 10, background: 'var(--bg-elevated, #19191f)', border: '1px solid var(--accent)', maxWidth: 340 }}>
    <p>{t('delegated.notice')}</p>
    <Button variant="secondary" onClick={onView}>{t('delegated.view')}</Button>
    <Button variant="secondary" onClick={onDismiss}>{t('ui.dismiss', { ns: 'common' })}</Button>
  </div>
}
