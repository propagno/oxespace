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
    /**
     * B19 · repo-relative files or glob patterns (`*`, `?`, `**`) copied from the main checkout into a new worktree,
     * typically gitignored ones such as `.env`. Kept as written: the copy step refuses, with a code, any pattern that
     * leaves the repository, so the person sees it instead of the entry vanishing.
     */
    include?: string[]
  }
  defaultTabs: RepoConfigTab[]
  /** Thread conversations in this project. */
  thread?: {
    /** Attach the short project brief to a conversation's first message (default true). */
    brief?: boolean
    /** OXESpace tool groups always offered besides the core ones (the 1.3 list form of `thread.tools`). */
    tools?: string[]
    /** The map form of `thread.tools`: group → `always`, `on-demand` or `off` (B7.2). */
    toolModes?: Record<string, string>
  }
}

export type RepoHookKind = 'setup' | 'archive'

export interface RepoConfigSnapshot {
  rootPath: string
  config: RepoConfig | null
  /** Hash of the script text per hook kind; keys the trust decision. */
  hashes: Partial<Record<RepoHookKind, string>>
  trusted: Partial<Record<RepoHookKind, boolean>>
}
