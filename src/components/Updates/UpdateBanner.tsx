import { Download } from 'lucide-react'
import { useEffect, useState, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { useUpdaterStore } from '../../store/updater.store'
import { Button, Popover } from '../../ui'

/**
 * RTK sidecar updates share the titlebar's quiet notification pattern.
 */
export function UpdateBanner(): ReactElement | null {
  const { t } = useTranslation()
  const rtk = useUpdaterStore((s) => s.rtk)
  const bootstrap = useUpdaterStore((s) => s.bootstrap)
  const updateRtk = useUpdaterStore((s) => s.updateRtk)
  const [open, setOpen] = useState(false)

  useEffect(() => {
    bootstrap()
  }, [bootstrap])

  const showRtk = rtk.updateAvailable || rtk.updating

  if (!showRtk) return null

  return (
    <div className="app-update-indicator rtk-update-indicator" data-testid="rtk-update-indicator">
      <Popover open={open} onOpenChange={setOpen} align="end" label={t('updates.rtk.title')}
        trigger={<button type="button" className="app-update-trigger" aria-label={rtk.updating ? t('updates.rtk.updatingLabel') : t('updates.rtk.availableLabel', { version: rtk.latestVersion ?? '' })} title={t('updates.rtk.title')}>
          <Download size={14} aria-hidden="true" />
          <span className="app-update-dot" aria-hidden="true" />
        </button>}>
        <div className="app-update-popover">
          <strong>{rtk.updating ? t('updates.rtk.updating', { version: rtk.latestVersion }) : t('updates.rtk.available', { version: rtk.latestVersion })}</strong>
          <p>{t('updates.rtk.installed', { version: rtk.version ?? t('updates.rtk.unknown') })}</p>
          <Button size="sm" loading={rtk.updating} onClick={() => void updateRtk()}>{rtk.updating ? t('updates.rtk.updatingButton') : t('updates.rtk.update')}</Button>
        </div>
      </Popover>
    </div>
  )
}
