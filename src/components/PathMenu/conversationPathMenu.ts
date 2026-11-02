import type { OpenInRequest } from '../../lib/openIn'
import { parseProjectPath } from '../../lib/projectPath'

/**
 * The menu a conversation's file gets: the full menu for a file of its own project, the copy items only for one in
 * another checkout it worked in (a worktree main can't open from this scope; DESIGN #470), none outside both.
 */
export function conversationPathMenu(path: string, workspaceId: string | undefined, root: string, others: Array<string | null | undefined>): { request: OpenInRequest; copyOnly: boolean } | null {
  if (!workspaceId) return null
  const own = root ? parseProjectPath(path, root) : null
  if (own) return { request: { workspaceId, rootPath: root, relativePath: own.relativePath }, copyOnly: false }
  for (const other of others) {
    if (!other || other === root) continue
    const found = parseProjectPath(path, other)
    if (found) return { request: { workspaceId, rootPath: other, relativePath: found.relativePath }, copyOnly: true }
  }
  return null
}
