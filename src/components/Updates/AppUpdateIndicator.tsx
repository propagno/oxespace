import { AlertTriangle, ArrowUpCircle, Download, RefreshCw } from 'lucide-react'
import { useState, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { useUpdaterStore } from '../../store/updater.store'
import { Button, Popover } from '../../ui'
import { useApprovalsStore } from '../Approvals/approvals.store'
import { ExternalAnchor } from '../ExternalLinks/ExternalAnchor'
import { updateChipView } from './updateChip'

const RELEASE_URL = 'https://github.com/propagno/oxespace/releases/latest'

export function AppUpdateIndicator(): ReactElement | null {
  const { t } = useTranslation()
  const app = useUpdaterStore(state => state.app)
  const quitAndInstall = useUpdaterStore(state => state.quitAndInstall)
  const dismissBanner = useUpdaterStore(state => state.dismissBanner)
  const criticalHold = useApprovalsStore(state => state.queue.some(req => req.risk === 'critical'))
  const [open, setOpen] = useState(false)

  const chip = updateChipView(app, { criticalHold })
  if (!chip) return null
  const manual = app.installMode === 'manual'

  return <div className="app-update-indicator">
    <Popover open={open} onOpenChange={setOpen} align="end" label={t('updates.app.title')}
      trigger={<Button variant="ghost" size="sm" className="app-update-trigger" aria-label={chip.label} title={chip.label}>
        {app.status === 'downloading' ? <Download size={14} /> : app.status === 'error' ? <AlertTriangle size={14} /> : <ArrowUpCircle size={14} />}
        <span className="app-update-dot" aria-hidden="true" />
      </Button>}>
      <div className="app-update-popover">
        <strong>OXESpace {app.availableVersion ?? ''}</strong>
        <p>{manual ? t('updates.app.manual') : chip.label}</p>
        {manual || app.status === 'error' ? (
          <ExternalAnchor href={RELEASE_URL} source="app">{t('updates.chip.openReleases')} <ArrowUpCircle size={14} /></ExternalAnchor>
        ) : app.status === 'downloaded' ? (
          <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
            <Button size="sm" variant="primary" icon={<RefreshCw size={14} />} onClick={() => void quitAndInstall()}>{t('updates.chip.restartNow')}</Button>
            <Button size="sm" variant="secondary" onClick={() => { dismissBanner(); setOpen(false) }}>{t('updates.chip.later')}</Button>
          </div>
        ) : null}
      </div>
    </Popover>
  </div>
}
