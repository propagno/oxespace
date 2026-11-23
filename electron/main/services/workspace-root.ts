import { opendirSync, statSync } from 'node:fs'
import { posix } from 'node:path'
import { mainMessage } from '../../../shared/messages'
import type { WorkspaceCreateRefusal, WorkspaceRootRefusal } from '../../../shared/types/workspace'
import { normalizeWorkspaceRoot } from '../../../shared/utils/path'

/**
 * The check a workspace root passes before anything is written: an absolute path to a folder that exists and can
 * be listed. A workspace on a missing folder used to be created anyway, with every terminal starting in nothing.
 *
 * Stat and one directory open only; reads, lists and writes nothing. The path is checked as given and stored as
 * given, the way `WorkspaceService.create` already stores it, so an existing workspace on the same folder still
 * matches through `isSameRootPath`.
 */
// The root as the person meant it (a pasted path's surrounding quotes removed) now lives in shared/utils/path.ts, so
// the New workspace dialog compares with what main stores (OXE-367); main's callers keep importing it from here.
export { normalizeWorkspaceRoot }

/**
 * Whether a root names one folder on its own. On Windows `isAbsolute` also takes `\foo` (rooted on whichever drive is
 * current), so only a drive letter with a separator (`C:\`), a UNC share (`\\server\share`) or a device path (`\\?\`)
 * counts; `C:foo` is relative to that drive's current folder and never was absolute.
 */
export function isFullyQualified(rootPath: string, platform: NodeJS.Platform = process.platform): boolean {
  if (platform !== 'win32') return posix.isAbsolute(rootPath)
  return /^[A-Za-z]:[\\/]/.test(rootPath) || /^[\\/]{2}[?.][\\/]/.test(rootPath) || /^[\\/]{2}[^\\/?.][^\\/]*[\\/][^\\/]+/.test(rootPath)
}

/** The two filesystem calls the check makes; tests give their own. */
export interface WorkspaceRootFs {
  statSync(path: string): { isDirectory(): boolean }
  opendirSync(path: string): { closeSync(): void }
}

export function checkWorkspaceRoot(rootPath: string, platform: NodeJS.Platform = process.platform, fs: WorkspaceRootFs = { statSync, opendirSync }): { ok: true } | WorkspaceCreateRefusal {
  if (!rootPath) return { ok: false, refusal: 'empty', message: mainMessage('workspace.root.empty', {}) }
  if (!isFullyQualified(rootPath, platform)) return refuse('notAbsolute', rootPath)
  let isDirectory: boolean
  try {
    isDirectory = fs.statSync(rootPath).isDirectory()
  } catch (error) {
    return refuse(isPermissionError(error) ? 'unreadable' : 'notFound', rootPath)
  }
  if (!isDirectory) return refuse('notDirectory', rootPath)
  try {
    fs.opendirSync(rootPath).closeSync()
  } catch {
    return refuse('unreadable', rootPath)
  }
  return { ok: true }
}

function isPermissionError(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code
  return code === 'EACCES' || code === 'EPERM'
}

function refuse(refusal: Exclude<WorkspaceRootRefusal, 'empty'>, path: string): WorkspaceCreateRefusal {
  return { ok: false, refusal, message: mainMessage(`workspace.root.${refusal}`, { path }) }
}
