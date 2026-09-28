import { Download } from 'lucide-react'
import { useEffect, type ReactElement } from 'react'
import { useUpdaterStore } from '../../store/updater.store'

/**
 * RTK sidecar update banner. Application updates live in the titlebar.
 */
export function UpdateBanner(): ReactElement | null {
  const rtk = useUpdaterStore((s) => s.rtk)
  const bootstrap = useUpdaterStore((s) => s.bootstrap)
  const updateRtk = useUpdaterStore((s) => s.updateRtk)

  useEffect(() => {
    bootstrap()
  }, [bootstrap])

  const showRtk = rtk.updateAvailable && !rtk.updating

  if (!showRtk) return null

  return (
    <div className="update-banners" data-testid="update-banners">
      {showRtk ? (
        <div className="update-banner rtk" role="status" data-testid="rtk-update-banner">
          <Download size={14} aria-hidden="true" />
          <div className="update-banner-text">
            <strong>RTK {rtk.latestVersion} available</strong>
            <span>
              Installed {rtk.version ?? 'unknown (legacy)'} · token saver sidecar
            </span>
          </div>
          <div className="update-banner-actions">
            <button
              type="button"
              className="update-banner-primary"
              disabled={rtk.updating}
              onClick={() => void updateRtk()}
            >
              {rtk.updating ? 'Updating…' : 'Update RTK'}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  )
}
