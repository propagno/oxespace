/**
 * A repository's git dirs as git itself finds them, and cheap stamps of files, so safe-git starts git to find the dirs
 * or to read the config only when a stamped file changed (tests/integration/fs-allowlist.test.ts lists why this module
 * may touch fs: it stats files and resolves the cwd's real path; it reads and writes nothing).
 *
 * The dirs come from `git rev-parse` (runs nothing), never from a walk up by hand: git honours
 * `GIT_CEILING_DIRECTORIES`, treats a bare repository's folder as its git dir, and never adopts a parent repository it
 * would not use itself (SECURITY #387 re-check 3, F3). The answer is kept per cwd while the files that could change it
 * keep their stamp: every `.git` and `HEAD` from the cwd up to the work tree's top (or the git dir), and `commondir`.
 */
import { realpathSync, statSync } from 'node:fs'
import { dirname, join, resolve as resolvePath } from 'node:path'

export interface GitDirs { gitDir: string; commonDir: string; topLevel: string | null }

/** The one rev-parse that resolves a cwd. Exported so a test's fake spawner can tell it from a service's own call. */
export const GIT_DIRS_ARGS: readonly string[] = ['rev-parse', '--path-format=absolute', '--git-dir', '--git-common-dir', '--is-inside-work-tree', '--show-cdup']

/** Whether `args` (with safe-git's options in front) is the rev-parse above. */
export function isGitDirsRead(args: readonly string[]): boolean {
  const at = args.indexOf('rev-parse')
  return at >= 0 && GIT_DIRS_ARGS.every((arg, index) => args[at + index] === arg)
}

const fold = (path: string): string => process.platform === 'win32' ? path.replace(/\//g, '\\').toLowerCase() : path

/** `cwd` with links and junctions resolved, as git reports paths; `cwd` as given when it cannot be resolved. */
export function realCwd(cwd: string): string {
  try { return realpathSync.native(resolvePath(cwd)) } catch { return resolvePath(cwd) }
}

/** The rev-parse output for `cwd`, or null when git found no repository. */
export function parseGitDirs(cwd: string, stdout: string): GitDirs | null {
  const [gitDir, commonDir, inside, cdup = ''] = stdout.split(/\r?\n/)
  if (!gitDir || !commonDir || (inside !== 'true' && inside !== 'false')) return null
  return { gitDir: resolvePath(gitDir), commonDir: resolvePath(commonDir), topLevel: inside === 'true' ? resolvePath(cwd, cdup) : null }
}

/**
 * Size, inode and both times in nanoseconds: a rewrite inside one mtime tick, or with the mtime set back (`utimes`),
 * still moves ctime (or the inode, for a write-and-rename), so a stale answer never outlives the next call.
 */
export function stamp(path: string): string {
  try {
    const info = statSync(path, { bigint: true })
    return `${info.size}:${info.ino}:${info.mtimeNs}:${info.ctimeNs}`
  } catch { return '-' }
}

export const stampOf = (files: readonly string[]): string => files.map(file => `${file}=${stamp(file)}`).join('|')

export const sameFiles = (a: readonly string[], b: readonly string[]): boolean => a.length === b.length && a.every((file, index) => file === b[index])

/**
 * The files whose change could make git find other dirs for `cwd`, or null when the cwd is not under the folder git
 * stopped at (a `core.worktree` elsewhere): then the answer is never kept.
 */
export function guardFiles(cwd: string, dirs: GitDirs): string[] | null {
  const stop = fold(dirs.topLevel ?? dirs.gitDir)
  const files = [join(dirs.gitDir, 'commondir')]
  for (let dir = cwd; ; dir = dirname(dir)) {
    files.push(join(dir, '.git'), join(dir, 'HEAD'))
    if (fold(dir) === stop) return files
    if (dirname(dir) === dir) return null
  }
}

interface Resolution { dirs: GitDirs; guards: string[]; taken: string; valid: boolean }
const resolutions = new Map<string, Resolution>()
const resolutionKey = (cwd: string, env: NodeJS.ProcessEnv): string => `${fold(cwd)}\0${env.GIT_CEILING_DIRECTORIES ?? ''}`

/** Runs the rev-parse in the cwd: through the caller's spawner, so a test's fake sees it. */
export type GitDirsRun<R> = (args: string[]) => R

interface Lookup { key: string; real: string; hit?: GitDirs; guards: string[]; taken: string }

/** The step before running rev-parse: the kept answer when its guards are unchanged, else what to stamp. */
function lookup(cwd: string, env: NodeJS.ProcessEnv): Lookup {
  const real = realCwd(cwd)
  const key = resolutionKey(real, env)
  const before = resolutions.get(key)
  const guards = before?.guards ?? []
  // Stamped before git runs: a change while it runs is seen on the next call.
  const taken = stampOf(guards)
  return { key, real, guards, taken, ...(before?.valid && before.taken === taken ? { hit: before.dirs } : {}) }
}

function store(step: Lookup, result: { code: number | null; stdout: string }): GitDirs | null {
  const dirs = result.code === 0 ? parseGitDirs(step.real, result.stdout) : null
  if (!dirs) { resolutions.delete(step.key); return null }
  const guards = guardFiles(step.real, dirs)
  // Valid only when the files stamped before this run are the ones that guard its answer; else the next call stamps
  // them first and runs once more.
  resolutions.set(step.key, { dirs, guards: guards ?? [], taken: step.taken, valid: guards !== null && sameFiles(guards, step.guards) })
  return dirs
}

/** The git dirs of `cwd` as git finds them, or null outside a repository (never kept: asked again each time). */
export async function gitDirsOf(cwd: string, env: NodeJS.ProcessEnv, run: GitDirsRun<Promise<{ code: number | null; stdout: string }>>): Promise<GitDirs | null> {
  const step = lookup(cwd, env)
  if (step.hit) return step.hit
  return store(step, await run([...GIT_DIRS_ARGS]))
}

export function gitDirsOfSync(cwd: string, env: NodeJS.ProcessEnv, run: GitDirsRun<{ code: number | null; stdout: string }>): GitDirs | null {
  const step = lookup(cwd, env)
  if (step.hit) return step.hit
  return store(step, run([...GIT_DIRS_ARGS]))
}

/** The common git dir last found for `cwd` (no process), or `cwd` itself before any was found or outside a repository. */
export function commonGitDir(cwd: string, env: NodeJS.ProcessEnv = process.env): string {
  return resolutions.get(resolutionKey(realCwd(cwd), env))?.dirs.commonDir ?? resolvePath(cwd)
}

/** The files every config read stamps: the repository's config files, and HEAD, which `includeIf "onbranch:"` reads. */
export function baseConfigFiles(dirs: GitDirs): string[] {
  return [...new Set([
    join(dirs.commonDir, 'config'), join(dirs.commonDir, 'config.worktree'), join(dirs.gitDir, 'config.worktree'),
    join(dirs.gitDir, 'HEAD'), join(dirs.commonDir, 'HEAD')
  ])].sort()
}

/** Test-only: forget the kept answers. */
export function __forgetGitDirsForTests(): void { resolutions.clear() }
