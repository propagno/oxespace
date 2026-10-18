import { Activity, Code2, FileCode2, FolderTree, GitCompareArrows, GitPullRequest, Globe, Search, TerminalSquare, type LucideIcon } from 'lucide-react'

/** The side panels Code and Thread share. One name, icon and shortcut for each, whichever mode opens it. */
export type WorkbenchPanelId = 'terminal' | 'changes' | 'browser' | 'git' | 'files' | 'search' | 'scripts' | 'worktrees' | 'background'

export interface WorkbenchPanelMeta {
  label: string
  icon: LucideIcon
  shortcut?: string
}

export const WORKBENCH_PANELS: Record<WorkbenchPanelId, WorkbenchPanelMeta> = {
  terminal: { label: 'Terminal', icon: TerminalSquare, shortcut: 'Ctrl+`' },
  changes: { label: 'Changes', icon: GitCompareArrows, shortcut: 'Ctrl+Shift+D' },
  browser: { label: 'Browser', icon: Globe, shortcut: 'Ctrl+Shift+B' },
  git: { label: 'Commit & pull request', icon: GitPullRequest },
  files: { label: 'Files', icon: FileCode2, shortcut: 'Ctrl+E' },
  search: { label: 'Find in files', icon: Search, shortcut: 'Ctrl+Shift+F' },
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
  return panel.shortcut ? `${panel.label} · ${panel.shortcut}` : panel.label
}
