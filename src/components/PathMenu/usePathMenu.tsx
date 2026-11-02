import { lazy, Suspense, useRef, useState, type MouseEvent, type ReactElement } from 'react'
import type { OpenInRequest } from '../../lib/openIn'

/** The menu, the open-in client and main's message codes load on the first right click, not with the window. */
const PathMenuView = lazy(() => import('./PathMenuView'))

/** Where a context menu opens: the pointer, or for Shift+F10 / the menu key (no pointer) the element's corner. */
export function menuPoint(event: MouseEvent): { x: number; y: number } {
  if (event.clientX || event.clientY) return { x: event.clientX, y: event.clientY }
  const rect = (event.currentTarget as HTMLElement).getBoundingClientRect()
  return { x: rect.left, y: rect.bottom }
}

/** The loaded path menu at `point`, or nothing while closed. */
export function LazyPathMenu({ request, point, onClose, returnFocus, openInOxespace, folder }: {
  request: OpenInRequest | null; point: { x: number; y: number } | null; onClose(): void; returnFocus(): HTMLElement | null; openInOxespace?: () => void; folder?: boolean
}): ReactElement | null {
  if (!request || !point) return null
  return <Suspense fallback={null}><PathMenuView request={request} point={point} onClose={onClose} returnFocus={returnFocus} openInOxespace={openInOxespace} folder={folder} /></Suspense>
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
  const onContextMenu = (event: MouseEvent): void => {
    if (!request) return
    event.preventDefault()
    event.stopPropagation()
    owner.current = event.currentTarget as HTMLElement
    setPoint(menuPoint(event))
  }
  const menu = <LazyPathMenu request={request} point={point} onClose={() => setPoint(null)} returnFocus={() => owner.current} openInOxespace={options.openInOxespace} folder={options.folder} />
  return { menu, onContextMenu }
}

/** The path menu for one item of a list, without a component of its own: `render` gets the handler for its element. */
export function WithPathMenu({ request, openInOxespace, render }: {
  request: OpenInRequest | null; openInOxespace?: () => void; render(onContextMenu: (event: MouseEvent) => void): ReactElement
}): ReactElement {
  const { menu, onContextMenu } = usePathMenu(request, { openInOxespace })
  return <>{render(onContextMenu)}{menu}</>
}
