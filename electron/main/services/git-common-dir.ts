import { existsSync, readFileSync, realpathSync, statSync } from 'node:fs'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import type { SessionLocation } from '../../../shared/types/agent-hooks'

/**
 * The shared git directory of a checkout, read from disk without spawning git: `<root>/.git` when it is a
 * directory, or, for a linked worktree, the `commondir` named by the `gitdir:` file. Null when the
 * directory is not the top of a checkout. Synchronous so it can sit in the file-system authorization path.
 */
export function gitCommonDir(root: string): string | null {
  try {
    const dotGit = join(root, '.git')
    const stat = statSync(dotGit)
    if (stat.isDirectory()) return normalize(realpathSync.native(dotGit))
    if (!stat.isFile()) return null
    const match = /^gitdir:\s*(.+)$/m.exec(readFileSync(dotGit, 'utf8'))
    // A pointer to a network share or a device is never followed: reading it would reach the network (and on
    // Windows hand the share the person's credentials) because of a file anyone can write.
    if (!match || !localPointer(match[1].trim())) return null
    const gitDir = resolve(root, match[1].trim())
    let common = gitDir
    try {
      const named = readFileSync(join(gitDir, 'commondir'), 'utf8').trim()
      if (!localPointer(named)) return null
      common = resolve(gitDir, named)
    } catch { /* not a linked worktree */ }
    return normalize(realpathSync.native(common))
  } catch {
    return null
  }
}

/**
 * One spelling per directory, for comparing paths. The native realpath expands Windows 8.3 short names
 * (`C:\Users\RUNNER~1`), which the JavaScript one keeps, while git always writes the long form; without it
 * the same folder compares unequal. Falls back to the resolved path when the folder does not exist.
 */
export function canonicalPath(path: string): string {
  try { return normalize(realpathSync.native(path)) } catch { return normalize(resolve(path)).replace(/\/+$/, '') }
}

/** A path a `.git` pointer may name: never a UNC share or a device path (`\\server\…`, `//server/…`, `\\?\…`). */
const localPointer = (pointer: string): boolean => !/^[\\/]{2}/.test(pointer)

/** The real path of `path` in compare form, or null when it does not exist. */
function realOf(path: string): string | null {
  try { return normalize(realpathSync.native(path)) } catch { return null }
}

/**
 * Whether `root` is a checkout of the repository whose shared git directory is `common`, checked both ways, so that
 * a `.git` file anyone can write in any folder does not make that folder part of the repository (SECURITY, #507 review):
 * - the main checkout: its `.git` is a directory, and is `common` itself;
 * - a linked worktree: its `.git` file points into `common/worktrees/<name>`, and that folder's `gitdir` points back at
 *   this `.git`. Only the repository's own `git worktree add` writes both.
 * A main checkout made with `--separate-git-dir` (a `.git` file naming `common` itself) looks exactly like a forgery,
 * so it is accepted only as the same folder (see `sameRepository`), never as another checkout.
 */
function checkoutOf(root: string, common: string): boolean {
  try {
    const dotGit = join(root, '.git')
    const info = statSync(dotGit)
    if (info.isDirectory()) return realOf(dotGit) === common
    if (!info.isFile()) return false
    const pointer = /^gitdir:\s*(.+)$/m.exec(readFileSync(dotGit, 'utf8'))?.[1].trim()
    if (!pointer || !localPointer(pointer)) return false
    const admin = realOf(resolve(root, pointer))
    if (!admin || normalize(dirname(admin)) !== `${common}/worktrees`) return false
    const back = readFileSync(join(admin, 'gitdir'), 'utf8').trim()
    if (!back || !localPointer(back)) return false
    return realOf(resolve(admin, back)) === realOf(dotGit)
  } catch {
    return false
  }
}

/**
 * True when both directories are checkouts (main or linked worktrees) of the same repository, each verified against
 * that repository's own records (`checkoutOf`). The same folder in two spellings is always the same repository.
 */
export function sameRepository(a: string, b: string): boolean {
  const left = gitCommonDir(a)
  if (left === null) return false
  if (canonicalPath(a) === canonicalPath(b)) return true
  return left === gitCommonDir(b) && checkoutOf(a, left) && checkoutOf(b, left)
}

/** Top of the checkout containing `dir`: the nearest ancestor with a `.git` entry, or null. */
export function findCheckoutRoot(dir: string): string | null {
  let current = resolve(dir)
  for (let depth = 0; depth < 64; depth++) {
    if (existsSync(join(current, '.git'))) return current
    const parent = dirname(current)
    if (parent === current) return null
    current = parent
  }
  return null
}

/**
 * Where an agent says it is working, relative to the directory its pane was launched in. Only an absolute,
 * existing directory is accepted: the value comes from the agent's hook payload.
 */
export function resolveSessionLocation(cwd: string, launchRoot: string): SessionLocation | null {
  if (!cwd || cwd.length > 4096 || cwd.includes('\0') || !isAbsolute(cwd)) return null
  try { if (!statSync(cwd).isDirectory()) return null } catch { return null }
  const found = findCheckoutRoot(cwd)
  const launchCheckout = findCheckoutRoot(launchRoot) ?? launchRoot
  // The launch checkout itself is reported in the spelling the pane already uses, so a short or long form
  // of the same folder never reads as a move into another worktree.
  const checkoutRoot = found !== null && canonicalPath(found) === canonicalPath(launchCheckout) ? launchCheckout : found
  return { cwd, checkoutRoot, sameRepository: checkoutRoot !== null && sameRepository(checkoutRoot, launchCheckout) }
}

function normalize(path: string): string {
  const slashed = path.replace(/\\/g, '/')
  return process.platform === 'win32' ? slashed.toLowerCase() : slashed
}
