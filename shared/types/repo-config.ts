/**
 * Per-repository configuration read from `oxe.yaml` at the repository root.
 * Every field is optional; an absent or unreadable file means "no config".
 */
export interface RepoConfigTab {
  title: string
  command: string
  /** `#rgb` or `#rrggbb`. */
  color?: string
}

export interface RepoConfig {
  scripts: {
    /** Runs once in a freshly created worktree. */
    setup?: string
    /** Runs before a worktree is removed; a failure blocks removal. */
    archive?: string
  }
  worktree: {
    /** Repo-relative, gitignored directories symlinked from the main checkout. */
    sharedDirectories: string[]
  }
  defaultTabs: RepoConfigTab[]
}

export type RepoHookKind = 'setup' | 'archive'

export interface RepoConfigSnapshot {
  rootPath: string
  config: RepoConfig | null
  /** Hash of the script text per hook kind; keys the trust decision. */
  hashes: Partial<Record<RepoHookKind, string>>
  trusted: Partial<Record<RepoHookKind, boolean>>
}
