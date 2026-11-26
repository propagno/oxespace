/**
 * Per-repository configuration read from `oxe.yaml`, `.oxe/worktree.yaml`,
 * `orca.yaml`, and `.worktreeinclude` at the repository root.
 * Every field is optional; an absent or unreadable file means "no config".
 */
import type { MainMessage } from '../messages'

export type WorktreeTemplateSource = 'oxe.yaml' | '.oxe/worktree.yaml' | 'orca.yaml' | '.worktreeinclude'

export interface RepoConfigTab {
  title: string
  command: string
  /** `#rgb` or `#rrggbb`. */
  color?: string
}

export interface RepoConfig {
  /** Files that contributed to this merged configuration, in precedence order. */
  sources?: WorktreeTemplateSource[]
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
     * B19 / OXE-444 · repo-relative files or glob patterns (`*`, `?`, `**`, `!negation`)
     * copied from the main checkout into a new worktree, typically gitignored ones.
     */
    copyFiles?: string[]
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
export type RepoTrustKind = RepoHookKind | 'sensitive-copy'

export interface RepoConfigSnapshot {
  rootPath: string
  config: RepoConfig | null
  /** Hash of the script text per hook kind; keys the trust decision. */
  hashes: Partial<Record<RepoHookKind, string>>
  trusted: Partial<Record<RepoHookKind, boolean>>
}

export type WorktreeSkipReason =
  | 'tracked-in-git'
  | 'not-ignored'
  | 'excluded-by-negation'
  | 'sensitive-opt-in-required'
  | 'outside-repo'
  | 'too-complex'
  | 'symlink-escape'
  | 'target-exists'
  | 'missing-source'
  | 'over-limit'
  | 'ignore-check-failed'
  | 'copy-failed'
  | 'link-failed'

export interface WorktreeSkippedItem {
  path: string
  kind: 'shared-dir' | 'copy-file' | 'pattern'
  reason: WorktreeSkipReason
}

export type WorktreeHookStatus = 'none' | 'skipped-untrusted' | 'passed' | 'failed' | 'unverifiable'

export interface WorktreeProvisionReport {
  /** Template files that contributed to provisioning. */
  sources: WorktreeTemplateSource[]
  /** Repo-relative shared directories linked via junction/symlink. */
  linked: string[]
  /** Repo-relative files copied from the primary checkout. */
  copied: string[]
  /** Entries refused or skipped with deterministic reasons. */
  skipped: WorktreeSkippedItem[]
  /** Sensitive files blocked pending explicit repository-level opt-in. */
  sensitivePending: string[]
  /** Setup hook execution outcome. */
  hookStatus: WorktreeHookStatus
  /** Redacted, truncated (<= 4 KiB) stdout/stderr tail when setup hook fails or is unverifiable. */
  hookOutputTail?: string
  /** C3 notices emitted during provisioning. */
  notices: MainMessage[]
}

export interface WorktreeTemplateDryRun {
  sources: WorktreeTemplateSource[]
  linked: string[]
  copied: string[]
  skipped: WorktreeSkippedItem[]
  sensitivePending: string[]
  sensitivePatterns: string[]
  sensitiveHash: string | null
  sensitiveApproved: boolean
  hookCommands: Partial<Record<RepoHookKind, string>>
  hookTrusted: Partial<Record<RepoHookKind, boolean>>
  notices: MainMessage[]
}

export interface WorktreeTemplateConfig {
  rootPath: string
  sources: WorktreeTemplateSource[]
  sharedDirectories: string[]
  copyFiles: string[]
  worktreeInclude: string[]
  setupScript: string
  archiveScript: string
  sensitivePatterns: string[]
  sensitiveApproved: boolean
  sensitiveHash: string | null
  setupHash: string | null
  setupTrusted: boolean
}

export interface WorktreeTemplateSaveInput {
  sharedDirectories: string[]
  copyFiles: string[]
  worktreeInclude: string[]
  setupScript?: string
  archiveScript?: string
}

export interface RepositoryWorktreeTemplateApi {
  getWorktreeTemplate(input: { rootPath: string }): Promise<WorktreeTemplateConfig>
  saveWorktreeTemplate(input: { rootPath: string } & WorktreeTemplateSaveInput): Promise<WorktreeTemplateConfig>
  previewWorktreeTemplate(input: { rootPath: string }): Promise<WorktreeTemplateDryRun>
  trustWorktreeSensitiveCopy(input: { rootPath: string; contentHash: string; trusted: boolean }): Promise<WorktreeTemplateConfig>
}
