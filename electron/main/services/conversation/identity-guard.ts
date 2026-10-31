import { execFile } from 'node:child_process'
import { realpath } from 'node:fs/promises'
import { homedir } from 'node:os'
import { isAbsolute, relative } from 'node:path'
import { promisify } from 'node:util'

const exec = promisify(execFile)

/**
 * Whether a project root's Git identity can be trusted for the coordinator (B1.4 · S7.5, SECURITY M-1). Two cases
 * make projectIdentity() put unrelated folders under one identity, so they would share one coordinator and Team:
 * - a repository at the home folder, or above it, that holds the root without being the root (any folder under a
 *   home that is itself a Git repository);
 * - a work tree Git does not list: a `.git` file that points at another repository's Git directory (a folder from
 *   an archive, say).
 * `ambiguous` is refused (thread.coordinator.identityAmbiguous); a Git that does not answer throws, and the caller
 * refuses with identityUnavailable. A folder outside any repository is `ok`: its identity is its own path.
 * projectIdentity() itself is unchanged (B22), so Team, memory and delegation identities do not move.
 */
export type IdentityGuard = (root: string) => Promise<'ok' | 'ambiguous'>

const same = (a: string, b: string) => process.platform === 'win32' ? a.replace(/\\/g, '/').toLowerCase() === b.replace(/\\/g, '/').toLowerCase() : a === b
/** `outer` is `inner` or one of its parents. */
const holds = (outer: string, inner: string) => { const path = relative(outer, inner); return path === '' || (!path.startsWith('..') && !isAbsolute(path)) }
const git = (args: string[], cwd: string) => exec('git', args, { cwd, timeout: 2000, windowsHide: true })

export function createIdentityGuard(home: () => string = homedir): IdentityGuard {
  return async root => {
    const canonical = await realpath(root)
    let top: string
    try {
      top = await realpath((await git(['rev-parse', '--path-format=absolute', '--show-toplevel'], canonical)).stdout.trim())
    } catch (error) {
      if (String((error as { stderr?: string }).stderr).includes('not a git repository')) return 'ok'
      throw error
    }
    const homeFolder = await realpath(home()).catch(() => home())
    if (holds(top, homeFolder) && !same(top, canonical)) return 'ambiguous'
    const listed = (await git(['worktree', 'list', '--porcelain'], canonical)).stdout.split(/\r?\n/)
      .filter(line => line.startsWith('worktree ')).map(line => line.slice('worktree '.length).trim())
    const trees = await Promise.all(listed.map(tree => realpath(tree).catch(() => tree)))
    return trees.some(tree => same(tree, top)) ? 'ok' : 'ambiguous'
  }
}

/** The guard the app uses: the real home folder. */
export const identityGuard: IdentityGuard = createIdentityGuard()
