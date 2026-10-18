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
    if (!match) return null
    const gitDir = resolve(root, match[1].trim())
    let common = gitDir
    try { common = resolve(gitDir, readFileSync(join(gitDir, 'commondir'), 'utf8').trim()) } catch { /* not a linked worktree */ }
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

/** True when both directories are checkouts (main or linked worktrees) of the same repository. */
export function sameRepository(a: string, b: string): boolean {
  const left = gitCommonDir(a)
  return left !== null && left === gitCommonDir(b)
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
