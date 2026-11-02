/**
 * Worktree removal as a pipeline of checks, not a bare `git worktree remove`.
 *
 * Order matters: everything that can refuse runs before anything destructive,
 * and the archive hook (which may have side effects of its own) runs only once
 * the cheap structural checks have passed.
 *
 *   1. registered, not the main checkout, not a root/home/ancestor of another
 *   2. not locked (a lock is never overridden by force)
 *   3. archive hook, if approved: a failure blocks unless explicitly waived
 *   4. dirty working tree blocks unless forced (our own shared links excluded)
 *   5. terminals inside the worktree are stopped
 *   6. shared links are unlinked so no delete can follow one into the main tree
 *   7. `git worktree remove`, with Windows recovery when git de-registers it
 *      but the OS keeps the folder
 *   8. optional `git branch -d`; an unmerged branch is kept, never forced
 */
import { rm } from 'node:fs/promises'
import { homedir } from 'node:os'
import { resolve, sep } from 'node:path'
import type { GitHubMessageResult, GitHubRemoveWorktreeInput, GitHubWorktree, WorktreeRemovalCode } from '../../../../shared/types/github'
import { loadRepoConfig } from '../repo-config/loader'
import { runHook } from '../repo-config/hook-runner'
import { findSharedLinks, removeSharedLinks } from '../repo-config/shared-dirs'
import type { RepoHookTrust } from '../repo-config/trust'
import type { GhExec } from './gh-exec'
import { ok, parseWorktreePorcelain, sanitizeError } from './parsers'

export interface WorktreeRemovalDeps {
  gh: GhExec
  trust: RepoHookTrust
  /** Stops terminals whose cwd is inside `dir`; returns the pane ids stopped. */
  stopTerminalsWithin?: (dir: string) => string[]
}

export class WorktreeRemovalError extends Error {
  constructor(readonly code: WorktreeRemovalCode, message: string) {
    super(`[worktree-removal:${code}] ${message}`)
    this.name = 'WorktreeRemovalError'
  }
}

const norm = (p: string): string => resolve(p).replace(/[\\/]+$/, '').toLowerCase()
const within = (child: string, parent: string): boolean => {
  const c = norm(child)
  const p = norm(parent)
  return c === p || c.startsWith(p + sep.toLowerCase()) || c.startsWith(p + '/')
}

/** Paths git reports for entries that are only our own shared links. */
function isOwnedLinkEntry(entry: string, links: string[]): boolean {
  const path = entry.replace(/\\/g, '/').replace(/\/+$/, '')
  return links.some((link) => path === link || path.startsWith(link + '/'))
}

async function listRegistered(deps: WorktreeRemovalDeps, rootPath: string): Promise<GitHubWorktree[]> {
  const raw = await deps.gh.tryGit(['worktree', 'list', '--porcelain'], rootPath)
  const trees = parseWorktreePorcelain(raw, rootPath)
  // The first record is always the primary checkout, even when `rootPath`
  // itself is a linked worktree.
  if (trees[0]) trees[0] = { ...trees[0], isMain: true }
  return trees
}

export async function removeWorktreeSafely(
  deps: WorktreeRemovalDeps,
  input: GitHubRemoveWorktreeInput
): Promise<GitHubMessageResult> {
  const notes: string[] = []
  const trees = await listRegistered(deps, input.rootPath)
  const target = trees.find((t) => norm(t.path) === norm(input.path))
  const primary = trees[0]?.path ?? input.rootPath

  // 1 — structure
  if (!target) {
    throw new WorktreeRemovalError('protected', `${input.path} is not a registered worktree of this repository.`)
  }
  if (target.isMain) throw new WorktreeRemovalError('protected', 'The main checkout cannot be removed.')
  if (norm(target.path) === norm(homedir()) || within(primary, target.path)) {
    throw new WorktreeRemovalError('protected', 'This path contains the main repository or the home folder.')
  }
  if (trees.some((t) => t !== target && within(t.path, target.path))) {
    throw new WorktreeRemovalError('protected', 'This worktree contains another registered worktree.')
  }

  // 2 — lock
  if (target.locked) {
    throw new WorktreeRemovalError('locked', 'The worktree is locked (git worktree lock). Unlock it before removing.')
  }

  // The config comes from the worktree itself so a branch-specific oxe.yaml
  // wins; a worktree that is already gone falls back to the primary checkout.
  const config = (await loadRepoConfig(target.path)) ?? (await loadRepoConfig(primary))

  // 3 — archive hook
  const archive = config?.scripts.archive
  if (archive && !target.prunable) {
    if (!deps.trust.isTrusted(primary, 'archive', archive)) {
      notes.push('The archive hook was not approved and was skipped.')
    } else {
      const outcome = await runHook(archive, {
        cwd: target.path,
        env: {
          OXE_ROOT_PATH: primary,
          OXE_WORKTREE_PATH: target.path,
          OXE_WORKSPACE_NAME: target.path.replace(/\\/g, '/').split('/').pop() ?? ''
        }
      })
      if (outcome.status !== 'passed' && !input.allowFailedArchiveHook) {
        const why =
          outcome.status === 'failed'
            ? `exited with code ${outcome.exitCode}`
            : outcome.reason === 'timeout'
              ? 'excedeu o tempo limite'
              : 'ended without a verifiable result'
        throw new WorktreeRemovalError('archive-failed', `O hook archive ${why}. ${outcome.output.trim().slice(-400)}`.trim())
      }
      if (outcome.status !== 'passed') notes.push('The archive hook failed and was dismissed.')
    }
  }

  const sharedDirs = config?.worktree.sharedDirectories ?? []

  // 4 — dirty check
  if (!input.force && !target.prunable) {
    const links = await findSharedLinks(target.path, sharedDirs)
    const status = await deps.gh.git(['status', '--porcelain=v1', '-z', '--untracked-files=all'], target.path, undefined, 20_000)
    if (status.status === 0 && !status.error) {
      const blocking = (status.stdout ?? '')
        .split('\0')
        .filter((entry) => entry.length > 3)
        .filter((entry) => !(entry.startsWith('?? ') && isOwnedLinkEntry(entry.slice(3), links)))
      if (blocking.length > 0) {
        throw new WorktreeRemovalError(
          'dirty',
          `The worktree has ${blocking.length} uncommitted change(s). Use force to discard them.`
        )
      }
    }
    // A status failure is not proof of cleanliness, but git's own refusal in
    // step 7 is the backstop, so it is deliberately not escalated here.
  }

  // 5 — terminals
  if (deps.stopTerminalsWithin) {
    const stopped = deps.stopTerminalsWithin(target.path)
    // Windows holds a directory open while a shell has it as cwd; give the OS a
    // beat to release the handle before asking git to delete.
    if (stopped.length > 0) await new Promise((r) => setTimeout(r, process.platform === 'win32' ? 450 : 100))
  }

  // 6 — shared links
  await removeSharedLinks(target.path, sharedDirs)

  // 7 — git
  const args = ['worktree', 'remove']
  if (input.force) args.push('--force')
  args.push(target.path)
  try {
    await deps.gh.runGit(args, input.rootPath)
  } catch (error) {
    const stillRegistered = (await listRegistered(deps, input.rootPath)).some((t) => norm(t.path) === norm(target.path))
    if (stillRegistered) {
      throw new WorktreeRemovalError('git-failed', sanitizeError(error instanceof Error ? error.message : String(error)))
    }
    // Git de-registered it but the folder survived (Windows handle, long path).
    // The registry is the only trusted proof, so finish the delete ourselves.
    try {
      await rm(target.path, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
    } catch (rmError) {
      throw new WorktreeRemovalError(
        'git-failed',
        `Worktree unregistered, but the folder could not be deleted: ${rmError instanceof Error ? rmError.message : String(rmError)}`
      )
    }
    await deps.gh.tryGit(['worktree', 'prune'], input.rootPath)
  }

  // 8 — branch
  if (input.deleteBranch && target.branch) {
    try {
      await deps.gh.runGit(['branch', '-d', '--', target.branch], input.rootPath)
      notes.push(`Branch ${target.branch} removido.`)
    } catch {
      notes.push(`Branch ${target.branch} kept: it has unmerged commits.`)
    }
  }

  return ok([`Worktree em ${input.path} removido.`, ...notes].join(' '))
}
