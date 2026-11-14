import type { ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '../../ui/Button'
import { Dialog } from '../../ui/Overlay'
import styles from './WhatsNewDialog.module.css'

export type WhatsNewTarget = 'browser' | 'approvals' | 'httpCalls'

export interface WhatsNewDialogProps {
  onClose: () => void
  onOpen: (target: WhatsNewTarget) => void
}

const TARGETS: readonly WhatsNewTarget[] = ['browser', 'approvals', 'httpCalls']

export function WhatsNewDialog({ onClose, onOpen }: WhatsNewDialogProps): ReactElement {
  const { t } = useTranslation()

  return (
    <Dialog
      size="md"
      title={t('updates.whatsNew.title')}
      onClose={onClose}
      footer={
        <Button variant="primary" onClick={onClose}>
          {t('ui.close')}
        </Button>
      }
    >
      <ul className={styles.list}>
        {TARGETS.map(target => {
          const title = t(`updates.whatsNew.rows.${target}.title`)
          return (
            <li key={target} className={styles.row}>
              <div className={styles.copy}>
                <span className={styles.title}>{title}</span>
                <p className={styles.body}>{t(`updates.whatsNew.rows.${target}.body`)}</p>
              </div>
              <Button
                variant="secondary"
                size="sm"
                aria-label={t('updates.whatsNew.openTarget', { title })}
                onClick={() => onOpen(target)}
              >
                {t('updates.whatsNew.open')}
              </Button>
            </li>
          )
        })}
      </ul>
    </Dialog>
  )
}
