import { normalizeRootPath } from '../../shared/utils/path'
import type { Workspace } from '../../shared/types/workspace'

/**
 * Which directory the workspace-level side panels (GitHub, Review, Editor)
 * should read.
 *
 * A pane can be moved into a git worktree — `pane.rootPath` overrides the
 * workspace root for that pane's terminal. Before this existed the side panels
 * always read `workspace.rootPath`, so an agent working a hotfix in a worktree
 * had its diff, git status and file tree silently showing the *main* checkout.
 * The panels now follow the active pane, and say so.
 */
export interface WorkspaceScope {
  /** Directory the panels should read. */
  rootPath: string
  /** True when the scope came from a pane sitting in a worktree. */
  isWorktree: boolean
  /** Last path segment, for labelling. */
  folderName: string
  /** Pane the scope was derived from, or null when pinned / no pane active. */
  paneId: string | null
  /** True when the user pinned the panels to the workspace root. */
  pinned: boolean
}

/**
 * Resolves the scope for a workspace.
 *
 * `pinned` is the user's escape hatch: someone reviewing the main checkout
 * while a hotfix pane is focused would otherwise have no way to keep the
 * panels still.
 */
export function resolveWorkspaceScope(
  workspace: Pick<Workspace, 'rootPath' | 'panes'>,
  activePaneId: string | null,
  pinned = false
): WorkspaceScope {
  const pane = activePaneId ? workspace.panes.find((item) => item.id === activePaneId) ?? null : null
  const paneRoot = pinned ? null : pane?.rootPath ?? null
  const rootPath = paneRoot ?? workspace.rootPath
  return {
    rootPath,
    isWorktree: paneRoot !== null && !isSamePath(paneRoot, workspace.rootPath),
    folderName: folderNameOf(rootPath),
    paneId: paneRoot !== null ? pane?.id ?? null : null,
    pinned
  }
}

/**
 * Separator- and case-insensitive path equality. A pane's rootPath is stored
 * as the user's OS wrote it (`C:\repo`) while git echoes `C:/repo`, so a strict
 * comparison would report the main worktree as a worktree.
 *
 * Case is folded on every platform, unlike `isSameRootPath` in shared/utils/path,
 * which respects Linux's case sensitivity. The asymmetry is deliberate: this
 * compares a pane root against its own workspace root, both written by the same
 * app, so the only realistic difference is spelling. Over-matching keeps a pane
 * that has not moved from lighting up the worktree badge; under-matching would
 * be the visible bug.
 */
export function isSamePath(a: string, b: string): boolean {
  return normalizeRootPath(a).toLowerCase() === normalizeRootPath(b).toLowerCase()
}

function folderNameOf(path: string): string {
  const segments = path.replace(/[\\/]+$/, '').split(/[\\/]/)
  return segments[segments.length - 1] || path
}
