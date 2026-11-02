import { useState, type MouseEvent, type ReactElement } from 'react'
import { AnchoredMenu } from '../../ui'
import { useOpenInTargets, type OpenInRequest } from '../../lib/openIn'
import { pathMenuEntries, pathMenuLabel } from '../../lib/pathMenu'

/**
 * F33 · the path menu on any surface. Put `menu` inside the (positioned) element the path belongs to and give that
 * element `onContextMenu`: right click and Shift+F10 / the context-menu key both raise it, so the keyboard and the
 * mouse reach the same menu. `request` null (a path outside the project) means no menu at all.
 */
export function usePathMenu(request: OpenInRequest | null, options: { openInOxespace?: () => void; folder?: boolean; side?: 'top' | 'right' | 'bottom' | 'left' } = {}): {
  menu: ReactElement | null
  onContextMenu: (event: MouseEvent) => void
  openMenu: () => void
} {
  const [open, setOpen] = useState(false)
  const targets = useOpenInTargets()
  const onContextMenu = (event: MouseEvent): void => {
    if (!request) return
    event.preventDefault()
    event.stopPropagation()
    setOpen(true)
  }
  const menu = request
    ? <AnchoredMenu open={open} onOpenChange={setOpen} side={options.side ?? 'bottom'} label={pathMenuLabel(request.relativePath)} items={open ? pathMenuEntries({
      request,
      targets,
      platform: window.oxe?.app?.platform ?? 'linux',
      openInOxespace: options.openInOxespace,
      folder: options.folder
    }) : []} />
    : null
  return { menu, onContextMenu, openMenu: () => { if (request) setOpen(true) } }
}
