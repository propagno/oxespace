import { useCallback, useEffect, useRef, useState, type MouseEvent, type ReactElement } from 'react'
import type { IDisposable, Terminal } from '@xterm/xterm'
import { toast } from '../../ui'
import { PointMenu, menuPoint } from '../PathMenu/usePathMenu'
import { i18n } from '../../i18n'
import { openPathIn, preferredEditor, useOpenInStore, useOpenInTargets, type OpenInRequest } from '../../lib/openIn'
import { pathMenuEntries, pathMenuLabel } from '../../lib/pathMenu'
import { useEditorStore } from '../../store/editor.store'
import { useWorkspaceStore } from '../../store/workspace.store'
import { registerTerminalPathLinks, terminalPathHint, type TerminalPathScope } from './terminalPathLinks'
import type { ProjectPath } from '../../lib/projectPath'

const requestOf = (scope: TerminalPathScope, path: ProjectPath): OpenInRequest => ({ ...scope, relativePath: path.relativePath, line: path.line, column: path.column })

/** OXESpace's editor at the line, shown in the workspace (as a search match opens). */
function openInOxespace(request: OpenInRequest): void {
  void useEditorStore.getState().openFile({ workspaceId: request.workspaceId, rootPath: request.rootPath, relativePath: request.relativePath, line: request.line })
  void useWorkspaceStore.getState().updateEditorState({ workspaceId: request.workspaceId, editorVisible: true })
}

/**
 * F33 · project paths in a terminal pane: `register` adds the link provider to the pane's xterm, `onContextMenu` goes
 * on the pane's host, and `menu` is the path menu a right click on a path opens.
 */
export function useTerminalPathMenu(workspaceId: string | undefined): {
  register(terminal: Terminal): IDisposable
  onContextMenu(event: MouseEvent): void
  menu: ReactElement
} {
  const rootPath = useWorkspaceStore(state => state.workspaces.find(workspace => workspace.id === workspaceId)?.rootPath)
  const targets = useOpenInTargets()
  const scope = useRef<TerminalPathScope | null>(null)
  const hovered = useRef<{ scope: TerminalPathScope; path: ProjectPath } | null>(null)
  const hint = useRef('')
  useEffect(() => {
    scope.current = workspaceId && rootPath ? { workspaceId, rootPath } : null
    hint.current = terminalPathHint(preferredEditor(targets)?.name ?? null)
  }, [workspaceId, rootPath, targets])
  const [request, setRequest] = useState<OpenInRequest | null>(null)
  const [point, setPoint] = useState<{ x: number; y: number } | null>(null)
  const host = useRef<HTMLElement | null>(null)

  const register = useCallback((terminal: Terminal) => registerTerminalPathLinks(terminal, {
    scope: () => scope.current,
    openInOxespace: (where, path) => openInOxespace(requestOf(where, path)),
    openExternal: (where, path) => {
      const editor = preferredEditor(useOpenInStore.getState().targets)
      if (editor) void openPathIn(requestOf(where, path), editor.id)
      else toast({ title: (i18n.t as unknown as (key: string, options: object) => string)('openIn.noEditor', { ns: 'common' }), intent: 'info' })
    },
    hovered: link => { hovered.current = link },
    hint: () => hint.current
  }), [])

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
  const menu = <PointMenu point={point} open={request !== null} onOpenChange={open => { if (!open) setRequest(null) }} label={request ? pathMenuLabel(request.relativePath) : ''}
    returnFocus={() => host.current?.querySelector<HTMLElement>('.xterm-helper-textarea') ?? null}
    items={request ? pathMenuEntries({ request, targets, platform: window.oxe?.app?.platform ?? 'linux', openInOxespace: () => openInOxespace(request) }) : []} />
  return { register, onContextMenu, menu }
}
