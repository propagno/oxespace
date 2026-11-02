import { useRef, useState, type MouseEvent, type ReactElement } from 'react'
import { AnchoredMenu } from '../../ui'
import { useOpenInTargets, type OpenInRequest } from '../../lib/openIn'
import { pathMenuEntries, pathMenuLabel } from '../../lib/pathMenu'

/** Where a context menu opens: the pointer, or for Shift+F10 / the menu key (no pointer) the element's corner. */
export function menuPoint(event: MouseEvent): { x: number; y: number } {
  if (event.clientX || event.clientY) return { x: event.clientX, y: event.clientY }
  const rect = (event.currentTarget as HTMLElement).getBoundingClientRect()
  return { x: rect.left, y: rect.bottom }
}

/**
 * The path menu hung from a point: a zero-size fixed box at the pointer holds AnchoredMenu's anchor, so the menu
 * opens where the person clicked, whatever the size of the element (FRONTEND/DESIGN #470).
 */
export function PointMenu({ point, open, onOpenChange, label, items, returnFocus }: {
  point: { x: number; y: number } | null; open: boolean; onOpenChange(open: boolean): void; label: string
  items: ReturnType<typeof pathMenuEntries>; returnFocus(): HTMLElement | null
}): ReactElement {
  return <span style={{ position: 'fixed', left: point?.x ?? 0, top: point?.y ?? 0, width: 0, height: 0 }}>
    <AnchoredMenu open={open} onOpenChange={onOpenChange} side="bottom" label={label} items={items} returnFocus={returnFocus} />
  </span>
}

/**
 * F33 · the path menu on any surface. Give the element the path belongs to `onContextMenu` (right click, Shift+F10 and
 * the context-menu key all raise it) and render `menu` next to it, never inside a button. On close, focus goes back to
 * that element. `request` null (a path outside the project) means no menu at all.
 */
export function usePathMenu(request: OpenInRequest | null, options: { openInOxespace?: () => void; folder?: boolean } = {}): {
  menu: ReactElement | null
  onContextMenu: (event: MouseEvent) => void
} {
  const [point, setPoint] = useState<{ x: number; y: number } | null>(null)
  const owner = useRef<HTMLElement | null>(null)
  const targets = useOpenInTargets()
  const onContextMenu = (event: MouseEvent): void => {
    if (!request) return
    event.preventDefault()
    event.stopPropagation()
    owner.current = event.currentTarget as HTMLElement
    setPoint(menuPoint(event))
  }
  const menu = request
    ? <PointMenu point={point} open={point !== null} onOpenChange={open => { if (!open) setPoint(null) }} label={pathMenuLabel(request.relativePath)}
      returnFocus={() => owner.current}
      items={point ? pathMenuEntries({ request, targets, platform: window.oxe?.app?.platform ?? 'linux', openInOxespace: options.openInOxespace, folder: options.folder }) : []} />
    : null
  return { menu, onContextMenu }
}
