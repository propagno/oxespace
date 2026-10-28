import { withShortcut, type KeybindingId } from '../../keyboard/keybindings'
import { Activity, Code2, FileCode2, FolderTree, GitCompareArrows, GitPullRequest, Globe, Search, TerminalSquare, type LucideIcon } from 'lucide-react'

/** The side panels Code and Thread share. One name, icon and shortcut for each, whichever mode opens it. */
export type WorkbenchPanelId = 'terminal' | 'changes' | 'browser' | 'git' | 'files' | 'search' | 'scripts' | 'worktrees' | 'background'

export interface WorkbenchPanelMeta {
  label: string
  icon: LucideIcon
  keybinding?: KeybindingId
}

export const WORKBENCH_PANELS: Record<WorkbenchPanelId, WorkbenchPanelMeta> = {
  terminal: { label: 'Terminal', icon: TerminalSquare, keybinding: 'thread.terminal' },
  changes: { label: 'Changes', icon: GitCompareArrows, keybinding: 'code.changes' },
  browser: { label: 'Browser', icon: Globe, keybinding: 'code.browser' },
  git: { label: 'Commit & pull request', icon: GitPullRequest },
  files: { label: 'Files', icon: FileCode2, keybinding: 'code.files' },
  search: { label: 'Find in files', icon: Search, keybinding: 'code.search' },
  scripts: { label: 'Scripts', icon: Code2 },
  worktrees: { label: 'Worktrees', icon: FolderTree },
  background: { label: 'Background activity', icon: Activity }
}

/** Panels shown as buttons in the bar; the rest live in the Panels menu. */
export const CODE_BAR_PANELS: WorkbenchPanelId[] = ['changes', 'browser']
export const CODE_MENU_PANELS: WorkbenchPanelId[] = ['git', 'files', 'search', 'scripts', 'worktrees']
export const THREAD_BAR_PANELS: WorkbenchPanelId[] = ['terminal', 'changes', 'browser']
export const THREAD_MENU_PANELS: WorkbenchPanelId[] = ['git', 'files', 'search', 'scripts', 'background']

export function panelTitle(id: WorkbenchPanelId): string {
  const panel = WORKBENCH_PANELS[id]
  return withShortcut(panel.label, panel.keybinding)
}
