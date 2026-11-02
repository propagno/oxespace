import type { IDisposable, Terminal } from '@xterm/xterm'
import type { MouseEvent as ReactMouseEvent } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { OpenInRequest } from '../../lib/openIn'
import type { ProjectPath } from '../../lib/projectPath'
import { useWorkspaceStore } from '../../store/workspace.store'
import PathMenuView from '../PathMenu/PathMenuView'
import { menuPoint } from '../PathMenu/usePathMenu'
import { hoverHint, openExternal, openInOxespace } from './terminalPathActions'
import { registerTerminalPathLinks, type TerminalPathScope } from './terminalPathLinks'

const requestOf = (scope: TerminalPathScope, path: ProjectPath): OpenInRequest => ({ ...scope, relativePath: path.relativePath, line: path.line, column: path.column })

/**
 * Loaded on a pane's first render (terminalPaths.ts). Links project paths in the pane's output and, on a right click
 * over one, shows the path menu at the pointer in a root of its own; on close the keyboard goes back to the terminal,
 * so typing continues (FRONTEND #470).
 */
export function attach(terminal: Terminal, host: HTMLElement, workspaceId: string): IDisposable {
  if (typeof terminal.registerLinkProvider !== 'function') return { dispose: () => undefined }
  const scope = (): TerminalPathScope | null => {
    const rootPath = useWorkspaceStore.getState().workspaces.find(workspace => workspace.id === workspaceId)?.rootPath
    return rootPath ? { workspaceId, rootPath } : null
  }
  let hovered: { scope: TerminalPathScope; path: ProjectPath } | null = null
  const provider = registerTerminalPathLinks(terminal, {
    scope,
    openInOxespace: (where, path) => openInOxespace(requestOf(where, path)),
    openExternal: (where, path) => { void openExternal(requestOf(where, path)) },
    hovered: link => { hovered = link },
    hint: hoverHint
  })

  let mount: HTMLDivElement | null = null
  let root: Root | null = null
  const close = (): void => { root?.render(null) }
  const onContextMenu = (event: MouseEvent): void => {
    const link = hovered
    if (!link) return
    event.preventDefault()
    event.stopPropagation()
    const request = requestOf(link.scope, link.path)
    if (!root) { mount = document.createElement('div'); document.body.append(mount); root = createRoot(mount) }
    root.render(<PathMenuView request={request} point={menuPoint(event as unknown as ReactMouseEvent)} onClose={close}
      returnFocus={() => host.querySelector<HTMLElement>('.xterm-helper-textarea')} openInOxespace={() => openInOxespace(request)} />)
  }
  host.addEventListener('contextmenu', onContextMenu)
  return {
    dispose: () => {
      provider.dispose()
      host.removeEventListener('contextmenu', onContextMenu)
      const done = root, node = mount
      root = null
      mount = null
      // Unmounting during a render warns: let the current one finish.
      queueMicrotask(() => { done?.unmount(); node?.remove() })
    }
  }
}
