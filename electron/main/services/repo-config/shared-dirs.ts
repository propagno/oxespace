/**
 * Shared directories: gitignored directories (node_modules, caches) that a new
 * worktree links to the main checkout's copy instead of duplicating.
 */
import { lstat, mkdir, realpath, rmdir, symlink, unlink } from 'node:fs/promises'
import { dirname, resolve, sep } from 'node:path'

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
 * Links each shared directory that exists in `primaryRoot` into `worktreePath`.
 * Never clobbers something already there. Windows prefers a junction, which
 * needs no privilege; returns the relative paths actually linked.
 */
export async function createSharedLinks(primaryRoot: string, worktreePath: string, directories: string[]): Promise<string[]> {
  const linked: string[] = []
  for (const relative of directories) {
    const source = safeRelativePath(primaryRoot, relative)
    const target = safeRelativePath(worktreePath, relative)
    if (!source || !target) continue
    if (!(await isDirectory(source)) || (await exists(target))) continue
    try {
      await mkdir(dirname(target), { recursive: true })
      // A parent on either side may itself be a link: both must really be inside their own root (SECURITY #477).
      if (!(await realInside(primaryRoot, dirname(source))) || !(await realInside(worktreePath, dirname(target)))) continue
      await symlink(source, target, process.platform === 'win32' ? 'junction' : 'dir')
      linked.push(relative)
    } catch {
      /* best effort: a failed link must not fail worktree creation */
    }
  }
  return linked
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
