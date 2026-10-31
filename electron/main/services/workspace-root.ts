import { opendirSync, statSync } from 'node:fs'
import { isAbsolute } from 'node:path'
import { mainMessage } from '../../../shared/messages'
import type { WorkspaceCreateRefusal, WorkspaceRootRefusal } from '../../../shared/types/workspace'

/**
 * The check a workspace root passes before anything is written: an absolute path to a folder that exists and can
 * be listed. A workspace on a missing folder used to be created anyway, with every terminal starting in nothing.
 *
 * Stat and one directory open only; reads, lists and writes nothing. The path is checked as given and stored as
 * given, the way `WorkspaceService.create` already stores it, so an existing workspace on the same folder still
 * matches through `isSameRootPath`.
 */
/**
 * The root as the person meant it: surrounding spaces trimmed, and one pair of matching quotes removed when they wrap
 * the whole text, as Explorer's "Copy as path" gives it. Quotes inside a name, or unbalanced ones, are kept, so such
 * a path is then refused as it stands.
 */
export function normalizeWorkspaceRoot(rootPath: string): string {
  const trimmed = rootPath.trim()
  const quoted = trimmed.length >= 2 && (trimmed[0] === '"' || trimmed[0] === '\'') && trimmed.at(-1) === trimmed[0]
  return quoted ? trimmed.slice(1, -1).trim() : trimmed
}

export function checkWorkspaceRoot(rootPath: string): { ok: true } | WorkspaceCreateRefusal {
  if (!rootPath) return { ok: false, refusal: 'empty', message: mainMessage('workspace.root.empty', {}) }
  if (!isAbsolute(rootPath)) return refuse('notAbsolute', rootPath)
  let isDirectory: boolean
  try {
    isDirectory = statSync(rootPath).isDirectory()
  } catch (error) {
    return refuse(isPermissionError(error) ? 'unreadable' : 'notFound', rootPath)
  }
  if (!isDirectory) return refuse('notDirectory', rootPath)
  try {
    opendirSync(rootPath).closeSync()
  } catch {
    return refuse('unreadable', rootPath)
  }
  return { ok: true }
}

function isPermissionError(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code
  return code === 'EACCES' || code === 'EPERM'
}

function refuse(refusal: WorkspaceRootRefusal, path: string): WorkspaceCreateRefusal {
  return { ok: false, refusal, message: mainMessage(`workspace.root.${refusal}`, { path }) }
}
