import type { ReactElement } from 'react'
import { WorktreesPanel } from './WorktreesPanel'

export { relativeAge } from './WorktreesPanel'

/**
 * The cleanup view of the Worktree dock. Since 1.5.0 (A63, DESIGN U4.7) its body is the Worktrees panel: one guarded
 * Remove per worktree, refused by main when it would lose work, instead of the old batch removal.
 */
export function WorktreeCleanupPanel({ rootPath }: { workspaceId: string; rootPath: string }): ReactElement {
  return <WorktreesPanel rootPath={rootPath} />
}
