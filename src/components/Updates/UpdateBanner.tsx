import { Download } from 'lucide-react'
import { useEffect, useState, type ReactElement } from 'react'
import { useUpdaterStore } from '../../store/updater.store'
import { Button, Popover } from '../../ui'

/**
 * RTK sidecar updates share the titlebar's quiet notification pattern.
 */
export function UpdateBanner(): ReactElement | null {
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
      <Popover open={open} onOpenChange={setOpen} align="end" label="RTK update"
        trigger={<button type="button" className="app-update-trigger" aria-label={rtk.updating ? 'RTK updating' : `RTK update ${rtk.latestVersion ?? ''} available`} title="RTK update">
          <Download size={14} aria-hidden="true" />
          <span className="app-update-dot" aria-hidden="true" />
        </button>}>
        <div className="app-update-popover">
          <strong>RTK {rtk.latestVersion} {rtk.updating ? 'updating' : 'available'}</strong>
          <p>Installed {rtk.version ?? 'unknown (legacy)'} · token saver sidecar.</p>
          <Button size="sm" loading={rtk.updating} onClick={() => void updateRtk()}>{rtk.updating ? 'Updating…' : 'Update RTK'}</Button>
        </div>
      </Popover>
    </div>
  )
}
