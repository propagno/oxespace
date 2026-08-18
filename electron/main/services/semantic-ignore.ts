import path from 'node:path'

/**
 * Path segments the semantic indexer never descends into. chokidar v4+ removed
 * glob support from its `ignored` option, so filtering is done with the
 * root-scoped predicate below instead of `**​/node_modules/**`-style globs
 * (which silently match nothing on chokidar 5 and would let the indexer crawl
 * node_modules).
 */
export const IGNORED_SEGMENTS: ReadonlySet<string> = new Set([
  'node_modules', '.git', 'dist', 'build', 'out', '.next', '.cache', '.turbo', 'coverage'
])

/** Dot-directories whose configuration materially affects build/runtime. */
export const INDEXED_DOT_DIRECTORIES: ReadonlySet<string> = new Set([
  '.github', '.vscode', '.devcontainer', '.husky'
])
export const INDEXED_DOT_FILES: ReadonlySet<string> = new Set([
  '.env', '.env.local', '.env.development', '.env.production', '.npmrc',
  '.eslintrc', '.prettierrc', '.babelrc'
])

/**
 * Build a root-scoped ignore predicate for chokidar. Returns true for any path
 * under `rootPath` whose relative path contains an ignored segment or a
 * dotfile/dot-directory. The root itself and anything outside it are never
 * ignored, so the watch never self-excludes (e.g. when the project lives under
 * a dotted parent directory like `~/.config/app`).
 */
export function makeIgnoreFilter(
  rootPath: string,
  ignoredSegments: ReadonlySet<string> = IGNORED_SEGMENTS
): (filePath: string) => boolean {
  const normRoot = path.resolve(rootPath)
  return (filePath: string): boolean => {
    const rel = path.relative(normRoot, path.resolve(filePath))
    if (!rel || rel.startsWith('..')) return false
    return rel
      .split(/[\\/]/)
      .some((seg, index, segments) => {
        if (ignoredSegments.has(seg)) return true
        if (seg.length <= 1 || !seg.startsWith('.')) return false
        if (INDEXED_DOT_DIRECTORIES.has(seg)) return false
        if (index === segments.length - 1) return !INDEXED_DOT_FILES.has(seg) && !seg.startsWith('.env.')
        return true
      })
  }
}
