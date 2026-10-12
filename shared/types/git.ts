export type GitLineType = 'context' | 'added' | 'removed'

export interface GitDiffLine {
  type: GitLineType
  oldLineNo: number | null
  newLineNo: number | null
  content: string
}

export interface GitDiffHunk {
  header: string
  lines: GitDiffLine[]
}

export interface GitDiffFile {
  path: string
  additions: number
  deletions: number
  hunks: GitDiffHunk[]
  mtime: number | null
}

export interface GitDiff {
  files: GitDiffFile[]
  base: string
  includeUncommitted: boolean
  compiledAt: number
}

export interface GitDiffInput {
  workspaceId: string
  rootPath: string
  base: string
  includeUncommitted: boolean
}

export interface GitBranchInput {
  workspaceId: string
  rootPath: string
}

export interface GitBranchStatus {
  branch: string | null
  detached: boolean
  shortSha: string | null
  error?: string | null
}

export interface GitControlFile {
  path: string
  staged: boolean
  unstaged: boolean
  untracked: boolean
  conflicted: boolean
  status: string
}

export interface GitControlStatus {
  branch: string | null
  upstream?: string | null
  ahead: number
  behind: number
  files: GitControlFile[]
  truncated?: boolean
  checkedAt: number
  error?: string
}

/** One entry of the uncapped change list shown by the Changes panel. */
export type GitSummaryStatus = 'A' | 'M' | 'D' | 'R'

export interface GitDiffSummaryFile {
  path: string
  /** Set for renames: the path on the base side. */
  oldPath?: string
  status: GitSummaryStatus
  additions: number
  deletions: number
  binary: boolean
}

export interface GitDiffSummary {
  files: GitDiffSummaryFile[]
  additions: number
  deletions: number
  /** The ref requested by the caller (for example `origin/main`). */
  base: string
  /** Commit the comparison actually starts from, when it could be resolved. */
  mergeBase: string | null
  includeUncommitted: boolean
  compiledAt: number
  error?: string
}

export interface GitFileOriginalInput extends GitDiffInput {
  path: string
  /** Base-side path for renames. */
  oldPath?: string
}

/** Base-side content of a file; the modified side is read from the work tree. */
export interface GitFileOriginal {
  content: string
  /** The file does not exist on the base side (added file). */
  missing: boolean
  binary: boolean
  size: number
  truncated: boolean
}
