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
