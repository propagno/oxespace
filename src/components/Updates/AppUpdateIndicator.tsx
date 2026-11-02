import { ArrowUpCircle, Download, RefreshCw } from 'lucide-react'
import { useState, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { useUpdaterStore } from '../../store/updater.store'
import { Button, Popover } from '../../ui'
import { ExternalAnchor } from '../ExternalLinks/ExternalAnchor'

const RELEASE_URL = 'https://github.com/propagno/oxespace/releases/latest'

export function AppUpdateIndicator(): ReactElement | null {
  const { t } = useTranslation()
  const app = useUpdaterStore(state => state.app)
  const quitAndInstall = useUpdaterStore(state => state.quitAndInstall)
  const [open, setOpen] = useState(false)

  if (!['available', 'downloading', 'downloaded'].includes(app.status)) return null
  const manual = app.installMode === 'manual'
  const label = app.status === 'downloaded' ? t('updates.app.ready') : t('updates.app.available', { version: app.availableVersion ?? '' })

  return <div className="app-update-indicator">
    <Popover open={open} onOpenChange={setOpen} align="end" label={t('updates.app.title')}
      trigger={<button type="button" className="app-update-trigger" aria-label={label} title={label}>
        {app.status === 'downloading' ? <Download size={14} /> : <ArrowUpCircle size={14} />}
        <span className="app-update-dot" aria-hidden="true" />
      </button>}>
      <div className="app-update-popover">
        <strong>OXESpace {app.availableVersion}</strong>
        <p>{manual ? t('updates.app.manual') : app.status === 'downloaded' ? t('updates.app.downloaded') : app.status === 'downloading' ? t('updates.app.downloading', { percent: app.progress ?? 0 }) : t('updates.app.background')}</p>
        {manual ? <ExternalAnchor href={RELEASE_URL} source="app">{t('updates.app.releases')} <ArrowUpCircle size={14} /></ExternalAnchor> : app.status === 'downloaded' ? <Button size="sm" variant="primary" icon={<RefreshCw size={14} />} onClick={() => void quitAndInstall()}>{t('updates.app.install')}</Button> : null}
      </div>
    </Popover>
  </div>
}
