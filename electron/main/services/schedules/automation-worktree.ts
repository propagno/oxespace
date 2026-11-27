import type { ReviewDiffFile } from '../../../../shared/schedule'
import type { WorktreeProvisionReport } from '../../../../shared/types/repo-config'
import { createThreadWorktree, type ThreadWorktreeHost } from '../conversation/thread-worktree'
import { runGit } from '../../utils/safe-git'

const MAX_UNTRACKED_FILES = 200
const MAX_DIFF_BYTES = 512 * 1024

export interface AutomationWorktreeHost extends ThreadWorktreeHost {
  removeWorktree: NonNullable<ThreadWorktreeHost['removeWorktree']>
  pushBranch?: (input: { rootPath: string; branch: string }) => Promise<void>
  createPullRequest?: (input: { rootPath: string; title: string; body: string; head: string; base?: string }) => Promise<{ url: string }>
}

export interface AutomationWorktreeProvision {
  worktreePath: string
  branchName: string
  baseSha: string
  report?: WorktreeProvisionReport
}

export interface AutomationDiffResult {
  filesChanged: number
  additions: number
  deletions: number
  files: ReviewDiffFile[]
  unifiedDiff: string
}

export interface CreatePrAutomationInput {
  projectRoot: string
  worktreePath: string
  branchName: string
  baseSha?: string | null
  title: string
  body: string
}

export interface ApplyAutomationInput {
  projectRoot: string
  worktreePath: string
  branchName: string
  baseSha?: string | null
}

export interface DiscardAutomationInput {
  projectRoot: string
  worktreePath: string
  branchName: string
}

export function slugifyAutomationName(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32)
    .replace(/-+$/g, '')
  return slug || 'run'
}

export function automationBranchName(name: string, runId: string): string {
  const shortId = runId.replace(/[^a-zA-Z0-9]/g, '').toLowerCase().slice(0, 8) || 'run'
  return `automation/${slugifyAutomationName(name)}-${shortId}`
}

/**
 * Provisions a mandatory isolated git worktree on `automation/<slug>-<shortRunId>` via OXE-444's `createWorktree`,
 * inheriting `.worktreeinclude`, `oxe.yaml`, and `sharedDirectories` without modifying the main checkout.
 */
export async function provisionAutomationWorktree(
  host: AutomationWorktreeHost,
  projectRoot: string,
  scheduleName: string,
  runId: string
): Promise<AutomationWorktreeProvision> {
  const branch = automationBranchName(scheduleName, runId)
  const created = await createThreadWorktree(host, projectRoot, {
    branch,
    allowDirtyBase: true
  })
  return {
    worktreePath: created.rootPath,
    branchName: created.branch,
    baseSha: created.baseSha,
    ...(created.report ? { report: created.report } : {})
  }
}

function parseNumstatLine(line: string, fallbackPath?: string): ReviewDiffFile | null {
  if (!line.trim()) return null
  const [addRaw, delRaw, ...pathParts] = line.split('\t')
  const parsedPath = pathParts.join('\t').trim()
  const path = fallbackPath ?? parsedPath
  if (!path) return null
  const binary = addRaw === '-' || delRaw === '-'
  return {
    path,
    additions: binary ? 0 : Number.parseInt(addRaw ?? '0', 10) || 0,
    deletions: binary ? 0 : Number.parseInt(delRaw ?? '0', 10) || 0,
    ...(binary ? { binary: true } : {})
  }
}

function truncateDiff(text: string): string {
  if (Buffer.byteLength(text, 'utf8') <= MAX_DIFF_BYTES) return text
  return `${text.slice(0, MAX_DIFF_BYTES)}\n... (diff truncated)`
}

/**
 * Collects real git diff statistics (`filesChanged`, `additions`, `deletions`) and a readable unified diff
 * across tracked edits (committed, staged, unstaged since `baseSha`) plus untracked files inside `worktreePath`.
 */
export async function collectAutomationDiff(
  worktreePath: string,
  baseSha?: string | null
): Promise<AutomationDiffResult> {
  const ref = baseSha?.trim() || 'HEAD'
  const files: ReviewDiffFile[] = []
  const diffParts: string[] = []

  const trackedStat = await runGit(worktreePath, ['diff', '--numstat', ref], { timeout: 20_000 })
  if (trackedStat.ok && trackedStat.stdout.trim()) {
    for (const line of trackedStat.stdout.split(/\r?\n/)) {
      const parsed = parseNumstatLine(line)
      if (parsed) files.push({ ...parsed, status: 'modified' })
    }
    const trackedPatch = await runGit(worktreePath, ['diff', '--no-color', ref], { timeout: 20_000 })
    if (trackedPatch.ok && trackedPatch.stdout) diffParts.push(trackedPatch.stdout.trimEnd())
  }

  const untrackedList = await runGit(worktreePath, ['ls-files', '--others', '--exclude-standard', '-z'], { timeout: 20_000 })
  if (untrackedList.ok && untrackedList.stdout) {
    const untrackedPaths = untrackedList.stdout.split('\0').filter(Boolean).slice(0, MAX_UNTRACKED_FILES)
    for (const relPath of untrackedPaths) {
      const statRes = await runGit(worktreePath, ['diff', '--no-index', '--numstat', '--', '/dev/null', relPath], { timeout: 15_000 })
      const firstLine = (statRes.stdout ?? '').split(/\r?\n/).find(line => line.trim().length > 0) ?? ''
      const parsed = parseNumstatLine(firstLine, relPath)
      if (parsed) {
        files.push({ ...parsed, status: 'added' })
      } else {
        files.push({ path: relPath, additions: 0, deletions: 0, status: 'added' })
      }
      if (Buffer.byteLength(diffParts.join('\n'), 'utf8') < MAX_DIFF_BYTES) {
        const patchRes = await runGit(worktreePath, ['diff', '--no-index', '--no-color', '--', '/dev/null', relPath], { timeout: 15_000 })
        if (patchRes.stdout) diffParts.push(patchRes.stdout.trimEnd())
      }
    }
  }

  const additions = files.reduce((sum, file) => sum + file.additions, 0)
  const deletions = files.reduce((sum, file) => sum + file.deletions, 0)
  return {
    filesChanged: files.length,
    additions,
    deletions,
    files,
    unifiedDiff: truncateDiff(diffParts.filter(Boolean).join('\n\n'))
  }
}

async function commitWorktreeChangesIfDirty(worktreePath: string, message: string): Promise<void> {
  const status = await runGit(worktreePath, ['status', '--porcelain=v1'], { timeout: 20_000 })
  if (!status.ok || !status.stdout.trim()) return
  const added = await runGit(worktreePath, ['add', '-A'], { timeout: 20_000 })
  if (!added.ok) throw new Error(added.stderr || 'Failed to stage automation changes.')
  const committed = await runGit(worktreePath, ['commit', '-m', message], { timeout: 20_000 })
  if (!committed.ok) throw new Error(committed.stderr || 'Failed to commit automation changes.')
}

/**
 * Commits uncommitted worktree edits onto the automation branch, pushes it, and creates a Pull Request.
 */
export async function createPrForAutomationRun(
  host: AutomationWorktreeHost,
  input: CreatePrAutomationInput
): Promise<{ prUrl: string }> {
  await commitWorktreeChangesIfDirty(input.worktreePath, input.title)
  if (!host.pushBranch || !host.createPullRequest) {
    throw new Error('Pull request integration is not configured.')
  }
  await host.pushBranch({ rootPath: input.worktreePath, branch: input.branchName })
  const created = await host.createPullRequest({
    rootPath: input.worktreePath,
    title: input.title,
    body: input.body,
    head: input.branchName
  })
  return { prUrl: created.url }
}

/**
 * Safely applies an automation worktree's changes into a clean main checkout via `git merge --squash`.
 * Refuses with `DIRTY_CHECKOUT` when the main checkout has uncommitted tracked modifications.
 */
export async function applyAutomationRunToCheckout(input: ApplyAutomationInput): Promise<{ applied: true }> {
  const dirty = await runGit(input.projectRoot, ['status', '--porcelain=v1', '--untracked-files=no'], { timeout: 20_000 })
  if (!dirty.ok || dirty.stdout.trim()) {
    throw Object.assign(new Error('Main checkout has uncommitted changes.'), { code: 'DIRTY_CHECKOUT' })
  }

  await commitWorktreeChangesIfDirty(input.worktreePath, `automation: ${input.branchName}`)
  const merged = await runGit(input.projectRoot, ['merge', '--squash', input.branchName], { timeout: 30_000 })
  if (!merged.ok) {
    await runGit(input.projectRoot, ['reset', '--merge'], { timeout: 20_000 }).catch(() => undefined)
    throw Object.assign(new Error(merged.stderr || 'Could not apply automation changes cleanly.'), { code: 'DIRTY_CHECKOUT' })
  }
  return { applied: true }
}

/**
 * Safely discards an automation run's isolated worktree and local `automation/*` branch.
 * Delegates worktree removal to `host.removeWorktree` (which calls `removeSharedLinks` + `unlinkLinksWithin`
 * before deleting the folder) so main checkout files and shared link targets are never touched.
 */
export async function discardAutomationWorktree(
  host: AutomationWorktreeHost,
  input: DiscardAutomationInput
): Promise<{ removedWorktree: boolean; deletedBranch: boolean }> {
  let removedWorktree = false
  if (input.worktreePath) {
    await host.removeWorktree({
      rootPath: input.projectRoot,
      path: input.worktreePath,
      force: true,
      deleteBranch: false
    })
    removedWorktree = true
  }

  let deletedBranch = false
  if (input.branchName && input.branchName.startsWith('automation/')) {
    const res = await runGit(input.projectRoot, ['branch', '-D', '--', input.branchName], { timeout: 20_000 })
    deletedBranch = res.ok
  }

  return { removedWorktree, deletedBranch }
}
