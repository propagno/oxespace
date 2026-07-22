// Find-in-Files (ripgrep) — shared contract between main and renderer.

export interface SearchInput {
  workspaceId: string
  rootPath: string
  /** The pattern. Literal by default; interpreted as a regex when `isRegex`. */
  query: string
  /** true → regex; false/undefined → fixed-string (`rg -F`). */
  isRegex?: boolean
  /** true → case-sensitive (`rg -s`); false/undefined → smart-case (`rg -S`). */
  caseSensitive?: boolean
  /** true → search ignored + hidden files (`rg --no-ignore --hidden`). */
  includeIgnored?: boolean
  /** ripgrep glob filters (`rg -g <glob>`), include (`src/**`) or exclude (`!*.lock`). */
  globs?: string[]
  /** Lines of surrounding context (`rg -C n`), clamped 0..5. */
  contextLines?: number
}

export interface SearchSubmatch {
  /** The matched substring. */
  text: string
  /** Byte offset of the match within `line` (ripgrep reports bytes, not chars). */
  start: number
  end: number
}

export interface SearchMatch {
  /** 1-based line number in the file. */
  lineNumber: number
  /** Full line text (trailing newline stripped, over-long lines truncated). */
  line: string
  submatches: SearchSubmatch[]
}

export interface SearchFileResult {
  /** Path relative to `rootPath`, forward-slashed. */
  path: string
  matches: SearchMatch[]
  /** true when this file had more matches than the per-file cap. */
  truncated: boolean
}

export interface SearchResult {
  files: SearchFileResult[]
  totalMatches: number
  totalFiles: number
  /** true when an overall cap (files/matches/time) stopped the search early. */
  truncated: boolean
  elapsedMs: number
  /** Present when the search could not run (e.g. ripgrep not found). */
  error?: string
}
