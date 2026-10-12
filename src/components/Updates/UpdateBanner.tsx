import { Download } from 'lucide-react'
import { useEffect, useRef, useState, type ReactElement } from 'react'
import { useUpdaterStore } from '../../store/updater.store'

/**
 * RTK sidecar updates share the titlebar's quiet notification pattern.
 */
export function UpdateBanner(): ReactElement | null {
  const rtk = useUpdaterStore((s) => s.rtk)
  const bootstrap = useUpdaterStore((s) => s.bootstrap)
  const updateRtk = useUpdaterStore((s) => s.updateRtk)
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bootstrap()
  }, [bootstrap])
  useEffect(() => {
    if (!open) return
    const close = (event: MouseEvent) => { if (!rootRef.current?.contains(event.target as Node)) setOpen(false) }
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', close)
    document.addEventListener('keydown', escape)
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', escape) }
  }, [open])

  const showRtk = rtk.updateAvailable || rtk.updating

  if (!showRtk) return null

  return (
    <div className="app-update-indicator rtk-update-indicator" ref={rootRef} data-testid="rtk-update-indicator">
      <button type="button" className="app-update-trigger" aria-label={rtk.updating ? 'RTK updating' : `RTK update ${rtk.latestVersion ?? ''} available`} aria-expanded={open} aria-haspopup="dialog" title="RTK update" onClick={() => setOpen(value => !value)}>
        <Download size={15} aria-hidden="true" />
        <span className="app-update-dot" aria-hidden="true" />
      </button>
      {open && <div className="app-update-popover" role="dialog" aria-label="RTK update">
        <strong>RTK {rtk.latestVersion} {rtk.updating ? 'updating' : 'available'}</strong>
        <p>Installed {rtk.version ?? 'unknown (legacy)'} · token saver sidecar.</p>
        <button type="button" disabled={rtk.updating} onClick={() => void updateRtk()}>{rtk.updating ? 'Updating…' : 'Update RTK'}</button>
      </div>}
    </div>
  )
}
