import type { OpenInRequest } from '../../lib/openIn'
import { parseProjectPath } from '../../lib/projectPath'

/**
 * The menu a conversation's file gets: the full menu for a file of its own project or of a worktree it worked in, rooted
 * at that checkout (main accepts a worktree its repository registered), none outside both.
 */
export function conversationPathMenu(path: string, workspaceId: string | undefined, root: string, others: Array<string | null | undefined>): { request: OpenInRequest; copyOnly: boolean } | null {
  if (!workspaceId) return null
  const own = root ? parseProjectPath(path, root) : null
  if (own) return { request: { workspaceId, rootPath: root, relativePath: own.relativePath }, copyOnly: false }
  for (const other of others) {
    if (!other || other === root) continue
    const found = parseProjectPath(path, other)
    // Main opens it when the repository registered that worktree (registeredWorktree); else it says so.
    if (found) return { request: { workspaceId, rootPath: other, relativePath: found.relativePath }, copyOnly: false }
  }
  return null
}
