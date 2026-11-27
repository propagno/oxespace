/**
 * Pure, read-only dry-run planner for declarative worktree templates (OXE-444).
 * Uses the exact same loader, `createSharedLinksDetailed(..., { dryRun: true })`,
 * `copyIncludedFiles(..., { dryRun: true })`, and `RepoHookTrust` checks as real
 * worktree creation — without creating files, symlinks, or executing hooks.
 */
import { mainMessage, type MainMessage } from '../../../../shared/messages'
import type { RepoHookKind, WorktreeTemplateDryRun } from '../../../../shared/types/repo-config'
import { loadWorktreeTemplate } from './loader'
import { createSharedLinksDetailed } from './shared-dirs'
import { hashSensitivePatterns, type RepoHookTrust } from './trust'
import { copyIncludedFiles, extractSensitivePatterns, type IgnoredFilter } from './worktree-include'

export interface PlanWorktreeTemplateOptions {
  /** Canonical primary repository root. */
  primaryRoot: string
  /** Optional trust store evaluated against `primaryRoot`. */
  trust?: RepoHookTrust | null
  /** Git check-ignore + tracked-files filter for sharedDirectories. */
  isSharedDirIgnored?: (directories: string[]) => Promise<Set<string> | null>
  /** Git check-ignore filter for copyFiles / .worktreeinclude. */
  isFileIgnored?: IgnoredFilter
}

export async function planWorktreeTemplate(options: PlanWorktreeTemplateOptions): Promise<WorktreeTemplateDryRun> {
  const { primaryRoot, trust, isSharedDirIgnored, isFileIgnored } = options
  const loaded = await loadWorktreeTemplate(primaryRoot)
  const config = loaded.config
  if (!config) {
    return {
      sources: [],
      linked: [],
      copied: [],
      skipped: [],
      sensitivePending: [],
      sensitivePatterns: [],
      sensitiveHash: null,
      sensitiveApproved: true,
      hookCommands: {},
      hookTrusted: {},
      notices: []
    }
  }

  const sharedReport = await createSharedLinksDetailed(
    primaryRoot,
    primaryRoot,
    config.worktree.sharedDirectories,
    { isIgnored: isSharedDirIgnored, dryRun: true }
  )

  const copyPatterns = config.worktree.copyFiles ?? []
  const sensitivePatterns = extractSensitivePatterns(copyPatterns)
  const sensitiveHash = sensitivePatterns.length > 0 ? hashSensitivePatterns(sensitivePatterns) : null
  const sensitiveApproved = sensitivePatterns.length === 0
    ? false
    : Boolean(trust?.isSensitiveCopyTrusted(primaryRoot, sensitivePatterns))

  const copyReport = await copyIncludedFiles(
    primaryRoot,
    primaryRoot,
    copyPatterns,
    isFileIgnored,
    { sensitiveApproved, dryRun: true }
  )

  const hookCommands: Partial<Record<RepoHookKind, string>> = {}
  const hookTrusted: Partial<Record<RepoHookKind, boolean>> = {}
  const hookNotices: MainMessage[] = []
  for (const kind of ['setup', 'archive'] as RepoHookKind[]) {
    const script = config.scripts[kind]
    if (!script) continue
    hookCommands[kind] = script
    const isOk = Boolean(trust?.isTrusted(primaryRoot, kind, script))
    hookTrusted[kind] = isOk
    if (kind === 'setup' && !isOk) {
      hookNotices.push(mainMessage('worktree.setup.notApproved', {}))
    }
  }

  return {
    sources: loaded.sources,
    linked: sharedReport.linked,
    copied: copyReport.copied,
    skipped: [...sharedReport.skipped, ...copyReport.skipped],
    sensitivePending: copyReport.sensitivePending,
    sensitivePatterns,
    sensitiveHash,
    sensitiveApproved: sensitivePatterns.length === 0 ? true : sensitiveApproved,
    hookCommands,
    hookTrusted,
    notices: [...sharedReport.notices, ...copyReport.notices, ...hookNotices]
  }
}
