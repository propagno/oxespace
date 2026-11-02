import { toast } from '../../ui'
import { i18n } from '../../i18n'
import { openPathIn, preferredEditor, useOpenInStore, type OpenInRequest } from '../../lib/openIn'
import { useEditorStore } from '../../store/editor.store'
import { useWorkspaceStore } from '../../store/workspace.store'
import { terminalPathHint } from './terminalPathLinks'

/** F33 · what a terminal path does, loaded with the link provider on a pane's first render (useTerminalPathMenu). */

/** OXESpace's editor at the line, shown in the workspace (as a search match opens). */
export function openInOxespace(request: OpenInRequest): void {
  void useEditorStore.getState().openFile({ workspaceId: request.workspaceId, rootPath: request.rootPath, relativePath: request.relativePath, line: request.line })
  void useWorkspaceStore.getState().updateEditorState({ workspaceId: request.workspaceId, editorVisible: true })
}

/** Ctrl/Cmd+Shift+click: the preferred external editor, or a note that none was found. */
export function openExternal(request: OpenInRequest): void {
  const editor = preferredEditor(useOpenInStore.getState().targets)
  if (editor) void openPathIn(request, editor.id)
  else toast({ title: (i18n.t as unknown as (key: string, options: object) => string)('openIn.noEditor', { ns: 'common' }), intent: 'info' })
}

/** The hover hint, naming the preferred editor once the list is in; reads it on first use. */
export function hoverHint(): string {
  const state = useOpenInStore.getState()
  if (!state.targets) void state.refresh()
  return terminalPathHint(preferredEditor(state.targets)?.name ?? null)
}
