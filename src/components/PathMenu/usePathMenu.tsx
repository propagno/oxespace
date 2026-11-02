import { lazy, Suspense, useEffect, useRef, useState, type ComponentType, type MouseEvent, type ReactElement } from 'react'
import type { OpenInRequest } from '../../lib/openIn'
import { parseProjectPath } from '../../lib/projectPath'
import { i18n } from '../../i18n'
import { toast } from '../../ui'

type ViewProps = { request: OpenInRequest; point: { x: number; y: number }; onClose(): void; returnFocus(): HTMLElement | null; openInOxespace?: () => void; folder?: boolean; copyOnly?: boolean }

/**
 * The menu, the open-in client and main's message codes load on the first right click, not with the window. A chunk
 * that fails to load (an update replaced it) never reaches an error boundary, which would replace the pane: the menu
 * closes with a toast, and the next right click loads it again (FRONTEND #470).
 */
let PathMenuView: ComponentType<ViewProps> = makeView()
function makeView(): ComponentType<ViewProps> {
  return lazy((): Promise<{ default: ComponentType<ViewProps> }> => import('./PathMenuView').catch(() => ({ default: MenuUnavailable })))
}
function MenuUnavailable({ onClose }: ViewProps): null {
  useEffect(() => {
    PathMenuView = makeView()
    toast({ title: (i18n.t as unknown as (key: string, options: object) => string)('openIn.menuUnavailable', { ns: 'common' }), intent: 'warning' })
    onClose()
  }, [onClose])
  return null
}

/** Where a context menu opens: the pointer, or for Shift+F10 / the menu key (no pointer) the element's corner. */
export function menuPoint(event: MouseEvent): { x: number; y: number } {
  if (event.clientX || event.clientY) return { x: event.clientX, y: event.clientY }
  const rect = (event.currentTarget as HTMLElement).getBoundingClientRect()
  return { x: rect.left, y: rect.bottom }
}

/** The loaded path menu at `point`, or nothing while closed. */
export function LazyPathMenu({ request, point, onClose, returnFocus, openInOxespace, folder, copyOnly }: {
  request: OpenInRequest | null; point: { x: number; y: number } | null; onClose(): void; returnFocus(): HTMLElement | null; openInOxespace?: () => void; folder?: boolean; copyOnly?: boolean
}): ReactElement | null {
  if (!request || !point) return null
  return <Suspense fallback={null}><PathMenuView request={request} point={point} onClose={onClose} returnFocus={returnFocus} openInOxespace={openInOxespace} folder={folder} copyOnly={copyOnly} /></Suspense>
}

/**
 * F33 · the path menu on any surface. Give the element the path belongs to `onContextMenu` (right click, Shift+F10 and
 * the context-menu key all raise it) and render `menu` next to it, never inside a button. On close, focus goes back to
 * that element. `request` null (a path outside the project) means no menu at all.
 */
export function usePathMenu(request: OpenInRequest | null, options: { openInOxespace?: () => void; folder?: boolean; copyOnly?: boolean } = {}): {
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
  const menu = <LazyPathMenu request={request} point={point} onClose={() => setPoint(null)} returnFocus={() => owner.current} openInOxespace={options.openInOxespace} folder={options.folder} copyOnly={options.copyOnly} />
  return { menu, onContextMenu }
}

/** The path menu for one item of a list, without a component of its own: `render` gets the handler for its element. */
export function WithPathMenu({ request, openInOxespace, copyOnly, render }: {
  request: OpenInRequest | null; openInOxespace?: () => void; copyOnly?: boolean; render(onContextMenu: (event: MouseEvent) => void): ReactElement
}): ReactElement {
  const { menu, onContextMenu } = usePathMenu(request, { openInOxespace: copyOnly ? undefined : openInOxespace, copyOnly })
  return <>{render(onContextMenu)}{menu}</>
}

/**
 * The menu a conversation's file gets: the full menu for a file of its own project, the copy items only for one in
 * another checkout it worked in (a worktree main can't open from this scope; DESIGN #470), none outside both.
 */
export function conversationPathMenu(path: string, workspaceId: string | undefined, root: string, others: Array<string | null | undefined>): { request: OpenInRequest; copyOnly: boolean } | null {
  if (!workspaceId) return null
  const own = root ? parseProjectPath(path, root) : null
  if (own) return { request: { workspaceId, rootPath: root, relativePath: own.relativePath }, copyOnly: false }
  for (const other of others) {
    if (!other || other === root) continue
    const found = parseProjectPath(path, other)
    if (found) return { request: { workspaceId, rootPath: other, relativePath: found.relativePath }, copyOnly: true }
  }
  return null
}
