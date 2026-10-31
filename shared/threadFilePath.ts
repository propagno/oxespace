/** How a file a turn changed is named on screen: relative to its checkout, never a long absolute path. */
export interface TurnPathLabel {
  /** Path relative to the checkout, or the end of the path when no known checkout contains it. */
  label: string
  /** Folder name of the checkout, when it is not the conversation's own root (a worktree, for example). */
  checkout?: string
  /** The path as given, for the tooltip. */
  full: string
}

const TAIL_SEGMENTS = 3

const normalize = (path: string): string => path.replace(/\\/g, '/').replace(/\/+$/, '')
// Windows drive and UNC paths compare without case; POSIX paths with it.
const key = (path: string): string => /^[a-z]:\//i.test(path) || path.startsWith('//') ? path.toLowerCase() : path
const absolute = (path: string): boolean => /^(?:[a-z]:)?\//i.test(path)

/**
 * Names `path` relative to the longest of `roots` that contains it. `roots[0]` is the
 * conversation's root; a match on any other root also names that checkout. A path
 * outside every root keeps only its last segments, prefixed with "…/".
 */
export function relativeTurnPath(path: string, roots: Array<string | null | undefined>): TurnPathLabel {
  const full = path, normalized = normalize(path)
  if (!absolute(normalized)) return { label: normalized.replace(/^\.\//, ''), full }
  const candidates = roots.map((root, index) => root ? { root: normalize(root), index } : null).filter(value => value !== null)
    .filter(({ root }) => key(normalized).startsWith(key(root) + '/'))
    .sort((a, b) => b.root.length - a.root.length)
  const match = candidates[0]
  if (match) {
    const label = normalized.slice(match.root.length + 1)
    // The sort is stable, so a root listed twice resolves to its first position.
    return match.index === 0 ? { label, full } : { label, checkout: match.root.split('/').at(-1), full }
  }
  const segments = normalized.split('/').filter(Boolean)
  return { label: segments.length > TAIL_SEGMENTS ? `…/${segments.slice(-TAIL_SEGMENTS).join('/')}` : normalized, full }
}
