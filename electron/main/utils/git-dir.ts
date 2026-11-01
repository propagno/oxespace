/**
 * A repository's git dirs, found on disk without starting git, and a cheap fingerprint of its config files, so
 * safe-git reads the config with git only when a config file changed (tests/integration/fs-allowlist.test.ts lists why
 * this module may touch fs: it reads `.git` pointers, `commondir`, and stats config files; it writes nothing).
 */
import { readFileSync, statSync } from 'node:fs'
import { dirname, isAbsolute, join, resolve as resolvePath } from 'node:path'

export interface GitDirs { gitDir: string; commonDir: string }

/** The git dir and the common git dir of the checkout holding `cwd`, or null outside one. */
export function gitDirsOf(cwd: string): GitDirs | null {
  let dir = resolvePath(cwd)
  for (let depth = 0; depth < 64; depth++) {
    const dotGit = join(dir, '.git')
    let isFile: boolean | null = null
    try { isFile = statSync(dotGit).isFile() } catch { /* no .git here */ }
    if (isFile !== null) {
      let gitDir = dotGit
      if (isFile) {
        let pointer: RegExpExecArray | null = null
        try { pointer = /^gitdir:\s*(.+?)\s*$/m.exec(readFileSync(dotGit, 'utf8')) } catch { return null }
        if (!pointer) return null
        gitDir = isAbsolute(pointer[1]) ? pointer[1] : resolvePath(dir, pointer[1])
      }
      let commonDir = gitDir
      try {
        const common = readFileSync(join(gitDir, 'commondir'), 'utf8').trim()
        if (common) commonDir = resolvePath(gitDir, common)
      } catch { /* a main checkout: its git dir is the common one */ }
      return { gitDir: resolvePath(gitDir), commonDir: resolvePath(commonDir) }
    }
    const parent = dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  return null
}

/** The common git dir of `cwd`, or `cwd` itself outside a repository. */
export function commonGitDir(cwd: string): string {
  return gitDirsOf(cwd)?.commonDir ?? resolvePath(cwd)
}

const stamp = (path: string): string => {
  try { const info = statSync(path); return `${info.size}:${info.mtimeMs}:${info.ctimeMs}` } catch { return '-' }
}

/**
 * Size and times of the repository's config files (`config`, `config.worktree`) and of every file they include
 * (`includes`, resolved against the config folder). Any change means the config must be read again.
 */
export function configFingerprint(cwd: string, includes: readonly string[] = []): string {
  const dirs = gitDirsOf(cwd)
  if (!dirs) return `none:${resolvePath(cwd)}`
  const files = [join(dirs.commonDir, 'config'), join(dirs.gitDir, 'config.worktree'), join(dirs.commonDir, 'config.worktree')]
  for (const include of includes) {
    const home = process.env.HOME ?? process.env.USERPROFILE ?? ''
    const path = include.startsWith('~/') ? join(home, include.slice(2)) : isAbsolute(include) ? include : resolvePath(dirs.gitDir, include)
    files.push(path, resolvePath(dirs.commonDir, include))
  }
  return files.map(file => `${file}=${stamp(file)}`).join('|')
}
