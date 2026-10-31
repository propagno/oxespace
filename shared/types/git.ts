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

/**
 * How side A is chosen: `merge-base` compares from the common ancestor of A and B (three dots, what a pull
 * request shows); `direct` compares A itself with B (two dots).
 */
export type GitCompareMode = 'merge-base' | 'direct'

export interface GitDiffInput {
  workspaceId: string
  rootPath: string
  base: string
  includeUncommitted: boolean
  /**
   * Side B as a ref (branch, tag or SHA). When set, the committed state of that ref is compared and the work
   * tree is ignored. When absent, side B is the work tree (or HEAD) of `rootPath`.
   */
  head?: string
  mode?: GitCompareMode
}

/** Content of one file at a ref, for side B when it is a ref. */
export interface GitFileAtRefInput {
  workspaceId: string
  rootPath: string
  ref: string
  path: string
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
  /** The sentence above as a message code the window translates (C3); the text stays for logs and older clients. */
  messageCode?: import('../messages').MainMessage
  files: GitDiffSummaryFile[]
  additions: number
  deletions: number
  /** The ref requested by the caller (for example `origin/main`). */
  base: string
  /** Commit the comparison actually starts from, when it could be resolved. */
  mergeBase: string | null
  includeUncommitted: boolean
  /** Side B when it is a ref; absent when side B is the work tree. */
  head?: string
  mode?: GitCompareMode
  compiledAt: number
  error?: string
}

export interface GitFileOriginalInput extends GitDiffInput {
  path: string
  /** Base-side path for renames. */
  oldPath?: string
}

/** Content of a file on one side; the work-tree side is read from disk instead. */
export interface GitFileOriginal {
  content: string
  /** The file does not exist on the base side (added file). */
  missing: boolean
  binary: boolean
  size: number
  truncated: boolean
}
