/**
 * Shared directories: gitignored directories (node_modules, caches) that a new
 * worktree links to the main checkout's copy instead of duplicating.
 */
import { lstat, mkdir, rmdir, symlink, unlink } from 'node:fs/promises'
import { dirname, resolve, sep } from 'node:path'

/** A relative path that stays inside `root`, or null. Mirrors the parser's rules. */
export function safeRelativePath(root: string, relative: string): string | null {
  const segments = relative.replace(/\\/g, '/').split('/')
  if (segments.some((s) => !s || s === '.' || s === '..' || s.toLowerCase() === '.git')) return null
  if (/^[a-zA-Z]:/.test(relative) || relative.startsWith('/')) return null
  const full = resolve(root, ...segments)
  return full.startsWith(resolve(root) + sep) ? full : null
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
