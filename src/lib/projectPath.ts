/**
 * F33 · which text names a file of the project, for the path menu and links (docs/design/f33-open-in.md §3).
 *
 * Display only: it decides what looks like a link. Main decides what opens (B18 checks the real path inside the
 * workspace), so a link this helper offers can still be refused there.
 */

export interface ProjectPath {
  /** Relative to the root, with "/" separators and no "." or ".." segments. "" is the root itself. */
  relativePath: string
  /** 1-based. */
  line?: number
  /** 1-based; only with a line. */
  column?: number
}

/** The largest line or column passed on; main refuses anything past it. */
const MAX_POSITION = 10_000_000

const slashes = (path: string): string => path.replace(/\\/g, '/')
const isAbsolute = (path: string): boolean => /^(?:[a-z]:)?\//i.test(path) || path.startsWith('//')
// Windows drive and UNC paths compare without case; POSIX paths with it.
const comparable = (path: string): string => /^[a-z]:\//i.test(path) || path.startsWith('//') ? path.toLowerCase() : path

function positionOf(value: string | undefined): number | undefined | null {
  if (value === undefined) return undefined
  const number = Number(value)
  return Number.isInteger(number) && number >= 1 && number <= MAX_POSITION ? number : null
}

/** Splits `src/a.ts:12:3`, `src/a.ts:12` or `src/a.ts(12,3)` into the path and its position. */
export function splitPosition(text: string): { path: string; line?: number; column?: number } | null {
  const match = /^(.*?)(?::(\d+)(?::(\d+))?|\((\d+)\s*,\s*(\d+)\))$/.exec(text)
  if (!match || !match[1]) return { path: text }
  const line = positionOf(match[2] ?? match[4])
  const column = positionOf(match[3] ?? match[5])
  if (line === null || column === null) return null
  return { path: match[1], line, column }
}

/** Removes "." and resolves ".." lexically; null when it climbs above the start. */
function collapse(segments: string[]): string[] | null {
  const out: string[] = []
  for (const segment of segments) {
    if (!segment || segment === '.') continue
    if (segment === '..') { if (!out.length) return null; out.pop() } else out.push(segment)
  }
  return out
}

/**
 * Strips Markdown inline wrappers (`**...**`, `__...__`, `*...*`, `_..._`, `` `...` ``)
 * around a path token while returning how many leading characters were removed so
 * terminal link providers can underline the exact path span.
 */
export function trimMarkdownPathToken(text: string): { cleaned: string; leadTrimmed: number } {
  let start = 0
  let end = text.length
  while (start < end && /\s/.test(text[start])) start += 1
  while (end > start && /\s/.test(text[end - 1])) end -= 1

  let changed = true
  while (changed && end - start >= 2) {
    changed = false
    const slice = text.slice(start, end)
    if (slice.startsWith('**') && slice.endsWith('**') && slice.length > 4) {
      start += 2
      end -= 2
      changed = true
    } else if (slice.startsWith('__') && slice.endsWith('__') && slice.length > 4) {
      start += 2
      end -= 2
      changed = true
    } else if (slice.startsWith('`') && slice.endsWith('`') && slice.length > 2) {
      start += 1
      end -= 1
      changed = true
    } else if (slice.startsWith('*') && slice.endsWith('*') && slice.length > 2) {
      start += 1
      end -= 1
      changed = true
    } else if (slice.startsWith('_') && slice.endsWith('_') && slice.length > 2) {
      start += 1
      end -= 1
      changed = true
    }
  }

  // Strip stray unpaired leading/trailing backticks or Markdown bold/italic stars
  // (e.g. `**~/foo/bar.ts` split across punctuation or line wraps), while preserving
  // glob prefixes like `**/*.ts` or `*.ts` so they are rejected as wildcards.
  while (start < end && text[start] === '`') start += 1
  while (end > start && text[end - 1] === '`') end -= 1

  const current = text.slice(start, end)
  const isGlobPrefix = current.startsWith('**/') || current.startsWith('*./') || current.startsWith('*.')
  if (!isGlobPrefix) {
    while (start < end && text[start] === '*') start += 1
    while (end > start && text[end - 1] === '*') end -= 1
  }

  return { cleaned: text.slice(start, end), leadTrimmed: start }
}

export function stripMarkdownPathWrappers(text: string): string {
  return trimMarkdownPathToken(text).cleaned
}

/**
 * The project file `text` names, relative to `root`, or null when it isn't one: a URL, a command, an option, a path
 * outside the root, or text that doesn't look like a file (no folder and no extension).
 */
export function parseProjectPath(text: string, root: string): ProjectPath | null {
  const trimmed = stripMarkdownPathWrappers(text)
  if (!trimmed || trimmed.length > 4096 || /\s/.test(trimmed) || trimmed.includes('://') || /[*`]/.test(trimmed) || /^[-~$%@]/.test(trimmed)) return null
  const split = splitPosition(trimmed)
  if (!split) return null
  const path = slashes(split.path)
  let relative: string[] | null
  if (isAbsolute(path)) {
    const base = slashes(root).replace(/\/+$/, '')
    if (!base || !comparable(path).startsWith(`${comparable(base)}/`)) return null
    relative = collapse(path.slice(base.length + 1).split('/'))
  } else {
    relative = collapse(path.split('/'))
  }
  if (!relative || !relative.length) return null
  // A bare word ("build", "README") reads as prose: a file needs a folder or an extension.
  if (relative.length === 1 && !/\.[A-Za-z0-9]+$/.test(relative[0]) && !path.startsWith('./')) return null
  return { relativePath: relative.join('/'), ...(split.line ? { line: split.line } : {}), ...(split.line && split.column ? { column: split.column } : {}) }
}
