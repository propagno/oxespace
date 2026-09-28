import { ArrowUpCircle, Download, RefreshCw } from 'lucide-react'
import { useEffect, useRef, useState, type ReactElement } from 'react'
import { useUpdaterStore } from '../../store/updater.store'

const RELEASE_URL = 'https://github.com/propagno/oxespace/releases/latest'

export function AppUpdateIndicator(): ReactElement | null {
  const app = useUpdaterStore(state => state.app)
  const quitAndInstall = useUpdaterStore(state => state.quitAndInstall)
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const close = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', close)
    document.addEventListener('keydown', escape)
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', escape) }
  }, [open])

  if (!['available', 'downloading', 'downloaded'].includes(app.status)) return null
  const manual = app.installMode === 'manual'
  const label = app.status === 'downloaded' ? 'OXESpace update ready' : `OXESpace update ${app.availableVersion ?? ''} available`

  return <div className="app-update-indicator" ref={rootRef}>
    <button type="button" className="app-update-trigger" aria-label={label} aria-expanded={open} aria-haspopup="dialog" title={label} onClick={() => setOpen(value => !value)}>
      {app.status === 'downloading' ? <Download size={15} /> : <ArrowUpCircle size={15} />}
      <span className="app-update-dot" aria-hidden="true" />
    </button>
    {open && <div className="app-update-popover" role="dialog" aria-label="OXESpace update">
      <strong>OXESpace {app.availableVersion}</strong>
      <p>{manual ? 'A newer release is available. Development and Linux package installs update manually.' : app.status === 'downloaded' ? 'Downloaded and ready to install.' : app.status === 'downloading' ? `Downloading… ${app.progress ?? 0}%` : 'Downloading in the background.'}</p>
      {manual ? <a href={RELEASE_URL} target="_blank" rel="noopener noreferrer">Open releases <ArrowUpCircle size={13} /></a> : app.status === 'downloaded' ? <button type="button" onClick={() => void quitAndInstall()}><RefreshCw size={13} /> Restart and install</button> : null}
    </div>}
  </div>
}
