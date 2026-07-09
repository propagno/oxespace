import { Download, RefreshCw, X } from 'lucide-react'
import { useEffect, type ReactElement } from 'react'
import { useUpdaterStore } from '../../store/updater.store'

/**
 * Global banner for app updates (electron-updater) and RTK sidecar updates.
 * Hidden in dev (status=disabled) and when the user dismisses a given version.
 */
export function UpdateBanner(): ReactElement | null {
  const app = useUpdaterStore((s) => s.app)
  const rtk = useUpdaterStore((s) => s.rtk)
  const dismissedVersion = useUpdaterStore((s) => s.dismissedVersion)
  const bootstrap = useUpdaterStore((s) => s.bootstrap)
  const quitAndInstall = useUpdaterStore((s) => s.quitAndInstall)
  const updateRtk = useUpdaterStore((s) => s.updateRtk)
  const dismissBanner = useUpdaterStore((s) => s.dismissBanner)

  useEffect(() => {
    bootstrap()
  }, [bootstrap])

  const showApp =
    (app.status === 'available' || app.status === 'downloading' || app.status === 'downloaded') &&
    app.availableVersion !== null &&
    app.availableVersion !== dismissedVersion

  const showRtk = rtk.updateAvailable && !rtk.updating

  if (!showApp && !showRtk && app.status !== 'downloading') return null

  return (
    <div className="update-banners" data-testid="update-banners">
      {showApp || app.status === 'downloading' ? (
        <div className={`update-banner app status-${app.status}`} role="status">
          <Download size={14} aria-hidden="true" />
          <div className="update-banner-text">
            {app.status === 'downloading' ? (
              <>
                <strong>Downloading OXESpace {app.availableVersion ?? ''}</strong>
                <span>{app.progress !== null ? `${app.progress}%` : '…'}</span>
              </>
            ) : app.status === 'downloaded' ? (
              <>
                <strong>OXESpace {app.availableVersion} ready</strong>
                <span>Restart to install the update</span>
              </>
            ) : (
              <>
                <strong>OXESpace {app.availableVersion} available</strong>
                <span>Current {app.currentVersion} · downloading in background</span>
              </>
            )}
          </div>
          <div className="update-banner-actions">
            {app.status === 'downloaded' ? (
              <button type="button" className="update-banner-primary" onClick={() => void quitAndInstall()}>
                <RefreshCw size={12} aria-hidden="true" />
                Restart now
              </button>
            ) : null}
            <button type="button" className="update-banner-dismiss" aria-label="Dismiss update" onClick={dismissBanner}>
              <X size={14} aria-hidden="true" />
            </button>
          </div>
        </div>
      ) : null}

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
