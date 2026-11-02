import type { ReactElement } from 'react'
import { AnchoredMenu } from '../../ui'
import { useOpenInTargets, type OpenInRequest } from '../../lib/openIn'
import { pathMenuEntries, pathMenuLabel } from '../../lib/pathMenu'

/**
 * F33 · the path menu itself, loaded on the first right click (usePathMenu): the menu, the open-in client and main's
 * message codes stay out of the renderer's entry chunk.
 *
 * It hangs from a zero-size fixed box at the pointer, so it opens where the person clicked whatever the size of the
 * element, and on close focus goes where `returnFocus` says (FRONTEND/DESIGN #470).
 */
export default function PathMenuView({ request, point, onClose, returnFocus, openInOxespace, folder }: {
  request: OpenInRequest
  point: { x: number; y: number }
  onClose(): void
  returnFocus(): HTMLElement | null
  openInOxespace?: () => void
  folder?: boolean
}): ReactElement {
  const targets = useOpenInTargets()
  return <span style={{ position: 'fixed', left: point.x, top: point.y, width: 0, height: 0 }}>
    <AnchoredMenu open onOpenChange={open => { if (!open) onClose() }} side="bottom" label={pathMenuLabel(request.relativePath)} returnFocus={returnFocus}
      items={pathMenuEntries({ request, targets, platform: window.oxe?.app?.platform ?? 'linux', openInOxespace, folder })} />
  </span>
}

/** The path menu's items at the end of the editor tab menu (a menu of plain buttons), in the same order. */
export function TabPathItems({ request, close }: { request: OpenInRequest; close(): void }): ReactElement {
  const targets = useOpenInTargets()
  const entries = pathMenuEntries({ request, targets, platform: window.oxe?.app?.platform ?? 'linux' })
  return <>
    <hr role="separator" className="ws-group-context-menu-separator" />
    {entries.map((entry, at) => entry.type === 'separator'
      ? <hr key={at} role="separator" className="ws-group-context-menu-separator" />
      : 'onSelect' in entry
        ? <button key={at} type="button" role="menuitem" onClick={() => { close(); entry.onSelect() }}>{entry.label}{'shortcut' in entry && entry.shortcut ? <span className="ws-group-context-menu-shortcut">{entry.shortcut}</span> : null}</button>
        : null)}
  </>
}
