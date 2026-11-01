import type { Workspace, WorkspacePane } from '../../shared/types/workspace'
import { commandCategoryLabel, tCommand } from './commandText'

/** One "Go to" row of the palette: a short label, a short place, and the full path for the tooltip and the search. */
export interface GoToText {
  label: string
  /** The name alone, as the rows were labelled before "Go to" (kept as a search word). */
  name: string
  detail?: string
  path?: string
}

const segments = (path: string): string[] => path.split(/[\\/]/).filter(Boolean)

/** The folder a workspace lives in, as its last two folders ("…/Estudos/oxespace"), never the full temporary path. */
export function shortFolder(path: string): string {
  const parts = segments(path)
  if (parts.length <= 2) return parts.join('/') || path
  return `…/${parts.slice(-2).join('/')}`
}

const goTo = (name: string): string => `${commandCategoryLabel('Go to')}: ${name}`

export function goToWorkspace(workspace: Workspace): GoToText {
  const name = workspace.name?.trim() || segments(workspace.rootPath).pop() || workspace.rootPath
  return { label: goTo(name), name, detail: shortFolder(workspace.rootPath), path: workspace.rootPath }
}

/** A pane of the active workspace: its agent or terminal name; unnamed terminals are told apart by position. */
export function goToPane(pane: WorkspacePane, siblings: WorkspacePane[] = []): GoToText {
  const named = pane.displayName?.trim() || pane.agentName?.trim()
  let name = named || pane.type
  if (!named && pane.type === 'terminal') {
    const index = siblings.filter(item => item.type === 'terminal').findIndex(item => item.id === pane.id)
    name = index >= 0 ? tCommand('menu.terminalAt', { index: index + 1 }) : tCommand('menu.terminal')
  }
  return { label: goTo(name), name, ...(pane.agentName && pane.displayName ? { detail: pane.agentName } : {}) }
}
