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
export function checkWorkspaceRoot(rootPath: string): { ok: true } | WorkspaceCreateRefusal {
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
