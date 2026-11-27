/**
 * Shared directories: gitignored directories (node_modules, caches) that a new
 * worktree links to the main checkout's copy instead of duplicating.
 *
 * OXE-444: validates every candidate against Git (`git check-ignore` + no tracked
 * files) before creating any link so tracked source folders are never symlinked.
 */
import { lstat, mkdir, realpath, rmdir, symlink, unlink } from 'node:fs/promises'
import { dirname, resolve, sep } from 'node:path'
import { MAIN_MESSAGE_PARAM_LIMITS, mainMessage, type MainMessage } from '../../../../shared/messages'
import type { WorktreeSkippedItem } from '../../../../shared/types/repo-config'

export interface SharedLinksOptions {
  /**
   * Returns the subset of candidate repo-relative directory paths that are confirmed
   * gitignored (and contain no tracked files), or `null` when git could not tell.
   */
  isIgnored?: (directories: string[]) => Promise<Set<string> | null>
  /** Read-only dry-run: computes exact linked/skipped/notices without creating directories or links. */
  dryRun?: boolean
}

export interface SharedLinksReport {
  linked: string[]
  skipped: WorktreeSkippedItem[]
  notices: MainMessage[]
}

function capped(paths: string[]): string[] {
  const { listLength, textLength } = MAIN_MESSAGE_PARAM_LIMITS
  return paths.slice(0, listLength).map((p) => (p.length > textLength ? `…${p.slice(-(textLength - 1))}` : p))
}

/** A relative path that stays inside `root`, or null. Mirrors the parser's rules. */
export function safeRelativePath(root: string, relative: string): string | null {
  const segments = relative.replace(/\\/g, '/').split('/')
  // Also the Windows spellings that can name another entry: a `:` stream, a trailing dot or space, an 8.3 `GIT~1`.
  if (segments.some((s) => !s || s === '.' || s === '..' || s.toLowerCase() === '.git' || s.includes(':') || /[. ]$/.test(s) || /^git~\d+$/i.test(s))) return null
  if (/^[a-zA-Z]:/.test(relative) || relative.startsWith('/')) return null
  const full = resolve(root, ...segments)
  return full.startsWith(resolve(root) + sep) ? full : null
}

/** Whether `path`'s real place is `root`'s real place or inside it. */
async function realInside(root: string, path: string): Promise<boolean> {
  try {
    const [base, real] = [await realpath(root), await realpath(path)]
    const fold = (p: string) => (process.platform === 'win32' ? p.toLowerCase() : p)
    return fold(real) === fold(base) || fold(real).startsWith(fold(base.endsWith(sep) ? base : base + sep))
  } catch {
    return false
  }
}

async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await lstat(path)).isDirectory()
  } catch {
    return false
  }
}

async function exists(path: string): Promise<boolean> {
  try {
    await lstat(path)
    return true
  } catch {
    return false
  }
}

/**
 * Links each gitignored shared directory that exists in `primaryRoot` into `worktreePath`
 * (or plans the links in `dryRun` mode) and returns a structured report with skipped reasons
 * and localized C3 notices. Never clobbers something already there, and never links tracked dirs.
 */
export async function createSharedLinksDetailed(
  primaryRoot: string,
  worktreePath: string,
  directories: string[],
  options: SharedLinksOptions = {}
): Promise<SharedLinksReport> {
  const report: SharedLinksReport = { linked: [], skipped: [], notices: [] }
  if (directories.length === 0) return report

  const dryRun = options.dryRun === true
  const validCandidates: Array<{ relative: string; source: string; target: string }> = []

  for (const relative of directories) {
    const source = safeRelativePath(primaryRoot, relative)
    const target = safeRelativePath(worktreePath, relative)
    if (!source || !target) {
      report.skipped.push({ path: relative, kind: 'shared-dir', reason: 'outside-repo' })
      continue
    }
    if (!(await isDirectory(source))) {
      report.skipped.push({ path: relative, kind: 'shared-dir', reason: 'missing-source' })
      continue
    }
    validCandidates.push({ relative, source, target })
  }

  if (validCandidates.length === 0) return report

  // Git check-ignore guard runs BEFORE target-exists so tracked folders checked out in the worktree
  // are accurately reported as `tracked-in-git` rather than `target-exists`.
  let ignoredCandidates = validCandidates
  const trackedInGit: string[] = []
  if (options.isIgnored) {
    const allowed = await options.isIgnored(validCandidates.map((c) => c.relative)).catch(() => null)
    if (!allowed) {
      for (const candidate of validCandidates) {
        report.skipped.push({ path: candidate.relative, kind: 'shared-dir', reason: 'ignore-check-failed' })
      }
      report.notices.push(mainMessage('worktree.sharedDirs.ignoreCheckFailed', {}))
      return report
    }
    ignoredCandidates = []
    for (const candidate of validCandidates) {
      if (allowed.has(candidate.relative)) {
        ignoredCandidates.push(candidate)
      } else {
        trackedInGit.push(candidate.relative)
        report.skipped.push({ path: candidate.relative, kind: 'shared-dir', reason: 'tracked-in-git' })
      }
    }
  }

  for (const { relative, source, target } of ignoredCandidates) {
    if (!(await realInside(primaryRoot, dirname(source)))) {
      report.skipped.push({ path: relative, kind: 'shared-dir', reason: 'symlink-escape' })
      continue
    }
    if (dryRun) {
      report.linked.push(relative)
      continue
    }
    if (await exists(target)) {
      report.skipped.push({ path: relative, kind: 'shared-dir', reason: 'target-exists' })
      continue
    }
    try {
      await mkdir(dirname(target), { recursive: true })
      // A parent on either side may itself be a link: both must really be inside their own root (SECURITY #477).
      if (!(await realInside(worktreePath, dirname(target)))) {
        report.skipped.push({ path: relative, kind: 'shared-dir', reason: 'symlink-escape' })
        continue
      }
      await symlink(source, target, process.platform === 'win32' ? 'junction' : 'dir')
      report.linked.push(relative)
    } catch {
      /* best effort: a failed link must not fail worktree creation */
      report.skipped.push({ path: relative, kind: 'shared-dir', reason: 'link-failed' })
    }
  }

  if (trackedInGit.length) {
    report.notices.push(mainMessage('worktree.sharedDirs.trackedInGit', { paths: capped(trackedInGit) }))
  }
  if (report.linked.length) {
    report.notices.push(mainMessage('worktree.sharedDirs.linked', { count: report.linked.length }))
  }
  return report
}

/**
 * Links each shared directory that exists in `primaryRoot` into `worktreePath`.
 * Never clobbers something already there. Windows prefers a junction, which
 * needs no privilege; returns the relative paths actually linked.
 */
export async function createSharedLinks(
  primaryRoot: string,
  worktreePath: string,
  directories: string[],
  options: SharedLinksOptions = {}
): Promise<string[]> {
  return (await createSharedLinksDetailed(primaryRoot, worktreePath, directories, options)).linked
}

/** True only for an actual symlink/junction; a real directory of the same name is user data. */
export async function isLink(path: string): Promise<boolean> {
  try {
    return (await lstat(path)).isSymbolicLink()
  } catch {
    return false
  }
}

/** Existing shared links inside a worktree, as relative paths. */
export async function findSharedLinks(worktreePath: string, directories: string[]): Promise<string[]> {
  const found: string[] = []
  for (const relative of directories) {
    const target = safeRelativePath(worktreePath, relative)
    if (target && (await isLink(target))) found.push(relative)
  }
  return found
}

/**
 * Removes the links (never their targets). Must run before the worktree is
 * deleted so a recursive delete cannot follow a link into the primary checkout.
 */
export async function removeSharedLinks(worktreePath: string, directories: string[]): Promise<void> {
  for (const relative of await findSharedLinks(worktreePath, directories)) {
    const target = safeRelativePath(worktreePath, relative)
    if (!target) continue
    try {
      await unlink(target)
    } catch {
      /* On Windows a junction to a directory may need rmdir semantics; unlink covers symlinks. */
      try {
        await rmdir(target)
      } catch {
        /* leave it; the dirty check already treated it as ours */
      }
    }
  }
}
