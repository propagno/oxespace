import { useCallback, useEffect, useRef, useState, type MouseEvent, type ReactElement } from 'react'
import type { IDisposable, Terminal } from '@xterm/xterm'
import type { OpenInRequest } from '../../lib/openIn'
import type { ProjectPath } from '../../lib/projectPath'
import { useWorkspaceStore } from '../../store/workspace.store'
import { LazyPathMenu, menuPoint } from '../PathMenu/usePathMenu'
import type { TerminalPathScope } from './terminalPathLinks'

const requestOf = (scope: TerminalPathScope, path: ProjectPath): OpenInRequest => ({ ...scope, relativePath: path.relativePath, line: path.line, column: path.column })

/**
 * F33 · project paths in a terminal pane: `register` adds the link provider to the pane's xterm, `onContextMenu` goes
 * on the pane's host, and `menu` is the path menu a right click on a path opens. The provider, its actions and the
 * menu load after the pane is up, so none of them weighs on the renderer's entry chunk.
 */
export function useTerminalPathMenu(workspaceId: string | undefined): {
  register(terminal: Terminal): IDisposable
  onContextMenu(event: MouseEvent): void
  menu: ReactElement | null
} {
  const rootPath = useWorkspaceStore(state => state.workspaces.find(workspace => workspace.id === workspaceId)?.rootPath)
  const scope = useRef<TerminalPathScope | null>(null)
  const hovered = useRef<{ scope: TerminalPathScope; path: ProjectPath } | null>(null)
  useEffect(() => { scope.current = workspaceId && rootPath ? { workspaceId, rootPath } : null }, [workspaceId, rootPath])
  const [request, setRequest] = useState<OpenInRequest | null>(null)
  const [point, setPoint] = useState<{ x: number; y: number } | null>(null)
  const host = useRef<HTMLElement | null>(null)

  const register = useCallback((terminal: Terminal): IDisposable => {
    let disposed = false
    let provider: IDisposable | undefined
    void Promise.all([import('./terminalPathLinks'), import('./terminalPathActions')]).then(([links, actions]) => {
      if (disposed || typeof terminal.registerLinkProvider !== 'function') return
      provider = links.registerTerminalPathLinks(terminal, {
        scope: () => scope.current,
        openInOxespace: (where, path) => actions.openInOxespace(requestOf(where, path)),
        openExternal: (where, path) => actions.openExternal(requestOf(where, path)),
        hovered: link => { hovered.current = link },
        hint: actions.hoverHint
      })
    })
    return { dispose: () => { disposed = true; provider?.dispose() } }
  }, [])

  const onContextMenu = (event: MouseEvent): void => {
    const link = hovered.current
    if (!link) return
    event.preventDefault()
    event.stopPropagation()
    host.current = event.currentTarget as HTMLElement
    setPoint(menuPoint(event))
    setRequest(requestOf(link.scope, link.path))
  }

  // Hung at the pointer; on close the keyboard goes back to the terminal, so typing continues (FRONTEND #470).
  const menu = <LazyPathMenu request={request} point={point} onClose={() => { setRequest(null); setPoint(null) }}
    returnFocus={() => host.current?.querySelector<HTMLElement>('.xterm-helper-textarea') ?? null}
    openInOxespace={request ? () => { void import('./terminalPathActions').then(actions => actions.openInOxespace(request)) } : undefined} />
  return { register, onContextMenu, menu }
}
