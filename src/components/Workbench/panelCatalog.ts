import { withShortcut, type KeybindingId } from '../../keyboard/keybindings'
import { Activity, Code2, Info, FileCode2, FolderTree, GitCompareArrows, GitPullRequest, Globe, Search, TerminalSquare, type LucideIcon } from 'lucide-react'
import { i18n } from '../../i18n'

/** The side panels Code and Thread share. One name, icon and shortcut for each, whichever mode opens it. */
export type WorkbenchPanelId = 'session' | 'terminal' | 'changes' | 'browser' | 'git' | 'files' | 'search' | 'scripts' | 'worktrees' | 'background'

export interface WorkbenchPanelMeta {
  /** Read in the interface language each time it is used; do not keep a copy. */
  readonly label: string
  icon: LucideIcon
  keybinding?: KeybindingId
}

function panel(id: WorkbenchPanelId, icon: LucideIcon, keybinding?: KeybindingId): WorkbenchPanelMeta {
  return { get label() { return i18n.t(`panels.${id}`, { ns: 'code' }) }, icon, keybinding }
}

export const WORKBENCH_PANELS: Record<WorkbenchPanelId, WorkbenchPanelMeta> = {
  /** Thread only: everything about the conversation (environment, context, tools, outputs, background). */
  session: panel('session', Info),
  terminal: panel('terminal', TerminalSquare, 'thread.terminal'),
  changes: panel('changes', GitCompareArrows, 'code.changes'),
  browser: panel('browser', Globe, 'code.browser'),
  git: panel('git', GitPullRequest),
  files: panel('files', FileCode2, 'code.files'),
  search: panel('search', Search, 'code.search'),
  scripts: panel('scripts', Code2),
  worktrees: panel('worktrees', FolderTree),
  background: panel('background', Activity)
}

/** Panels shown as buttons in the bar; the rest live in the Panels menu. */
export const CODE_BAR_PANELS: WorkbenchPanelId[] = ['changes', 'browser']
export const CODE_MENU_PANELS: WorkbenchPanelId[] = ['git', 'files', 'search', 'scripts', 'worktrees']
export const THREAD_BAR_PANELS: WorkbenchPanelId[] = ['terminal', 'changes', 'browser', 'session']
export const THREAD_MENU_PANELS: WorkbenchPanelId[] = ['git', 'files', 'search', 'scripts', 'background']

export function panelTitle(id: WorkbenchPanelId): string {
  const panel = WORKBENCH_PANELS[id]
  return withShortcut(panel.label, panel.keybinding)
}
