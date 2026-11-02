import { existsSync } from 'node:fs'
import { basename, dirname } from 'node:path'
import type { GitHubMessageResult, GitHubRemoveWorktreeInput } from '../../../../shared/types/github'
import type { OwnedThreadWorktree } from '../../../../shared/types/thread'
import { decideThreadWorktreeFinish, planThreadWorktreeFinish, type ThreadWorktreeChoice, type ThreadWorktreeFinishResult, type ThreadWorktreeInspection, type ThreadWorktreeState } from '../../../../shared/threadWorktree'
import { canonicalPath } from '../git-common-dir'
import { git, worktreeFolderOf } from './thread-worktree'

/** What cleaning up needs from the Git service: the same guarded removal the Worktrees panel runs. */
export interface ThreadWorktreeRemover {
  removeWorktree(input: GitHubRemoveWorktreeInput): Promise<GitHubMessageResult>
}

/**
 * The record is written by the app, but it is checked again before anything is removed: the worktree must be a
 * direct child of the project's worktree folder. A record that points anywhere else is refused, never followed.
 */
export function isOwnedWorktreePath(owned: Pick<OwnedThreadWorktree, 'path' | 'projectRoot'>): boolean {
  if (!owned.path || !owned.projectRoot || basename(owned.path) === '..' || basename(owned.path) === '.') return false
  return canonicalPath(dirname(owned.path)) === canonicalPath(worktreeFolderOf(owned.projectRoot))
}

const count = (text: string): number => text.split('\n').filter(line => line.trim()).length

/** Reads what Git says about the worktree: uncommitted edits, new files, and commits that exist nowhere else. */
export async function readThreadWorktreeState(owned: OwnedThreadWorktree): Promise<ThreadWorktreeState> {
  if (!existsSync(owned.path)) return { missing: true, uncommitted: 0, untracked: 0, unpushed: 0 }
  const status = await git(['status', '--porcelain=v1', '--untracked-files=all'], owned.path)
  if (!status.ok) return { missing: false, unreadable: true, uncommitted: 0, untracked: 0, unpushed: 0 }
  const lines = status.stdout.split('\n').filter(line => line.trim())
  const untracked = lines.filter(line => line.startsWith('??')).length
  // With an upstream, "unpushed" is what it lacks; without one, everything the branch added since it started.
  const upstream = await git(['rev-list', '--count', '@{u}..HEAD'], owned.path)
  const sinceBase = upstream.ok ? upstream : await git(['rev-list', '--count', `${owned.baseSha}..HEAD`], owned.path)
  const unpushed = sinceBase.ok ? Number.parseInt(sinceBase.stdout.trim(), 10) || 0 : 0
  return { missing: false, ...(sinceBase.ok ? {} : { unreadable: true }), uncommitted: lines.length - untracked, untracked, unpushed }
}

export async function inspectThreadWorktree(owned: OwnedThreadWorktree): Promise<ThreadWorktreeInspection> {
  const state = await readThreadWorktreeState(owned)
  return { owned, state, decision: decideThreadWorktreeFinish(state) }
}

/** What ending a conversation touches: the conversation, its project's folder list, and the guarded removal. */
export interface ThreadWorktreeEndDeps {
  read(threadId: string): { thread: { projectId: string; ownedWorktree?: OwnedThreadWorktree } }
  command(threadId: string, text: string): Promise<unknown>
  /** Absent when the session has no Git service; the conversation still ends, the worktree stays. */
  remover?: ThreadWorktreeRemover
  removeContext(projectId: string, path: string): void
  /** Other unarchived conversations that work inside the folder. */
  otherThreadsInside(path: string, exceptThreadId: string): number
}

/**
 * Archives or deletes a conversation, then deals with its own worktree as the person chose. The conversation
 * ends first, which stops its agent (that would hold the folder open); if that fails nothing is removed.
 */
export async function endThreadWithWorktree(deps: ThreadWorktreeEndDeps, threadId: string, action: 'archive' | 'delete', choice: ThreadWorktreeChoice): Promise<ThreadWorktreeFinishResult> {
  const { thread } = deps.read(threadId)
  const owned = thread.ownedWorktree
  await deps.command(threadId, `/${action} confirm`)
  if (!owned) return { removed: false, left: 'missing' }
  if (choice === 'keep') return { removed: false, left: 'chosen' }
  if (!deps.remover) return { removed: false, left: 'refused', detail: 'Worktrees are unavailable in this session.' }
  const result = await finishThreadWorktree(deps.remover, owned, choice, () => deps.otherThreadsInside(owned.path, threadId))
  if (result.removed) deps.removeContext(thread.projectId, owned.path)
  return result
}

/**
 * Removes the conversation's worktree after the conversation stopped, as far as the person's choice allows.
 * The state is read again here: "auto" removes only a worktree that is still empty, and work written since the
 * question is asked about again instead of lost. `discard` is the only path that forces, and it keeps a branch
 * that has commits (the removal deletes a branch only when merged), so even discarding never drops commits.
 */
export async function finishThreadWorktree(remover: ThreadWorktreeRemover, owned: OwnedThreadWorktree, choice: ThreadWorktreeChoice, otherThreadsInside: () => number = () => 0): Promise<ThreadWorktreeFinishResult> {
  if (!isOwnedWorktreePath(owned)) return { removed: false, left: 'refused', detail: 'This folder is not inside the project\'s worktree folder.' }
  const plan = planThreadWorktreeFinish(choice, await readThreadWorktreeState(owned))
  if (plan.kind === 'leave') return { removed: false, left: plan.reason }
  if (otherThreadsInside() > 0) return { removed: false, left: 'refused', detail: 'Another conversation still works in this worktree.' }
  try {
    await remover.removeWorktree({ rootPath: owned.projectRoot, path: owned.path, force: plan.force, deleteBranch: true })
    return { removed: true }
  } catch (error) {
    return { removed: false, left: 'refused', detail: error instanceof Error ? error.message : String(error) }
  }
}
