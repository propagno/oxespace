import { existsSync } from 'node:fs'
import { isAbsolute, resolve } from 'node:path'
import type { ThreadPaneSource, ThreadPlace, ThreadPlaceDrift, ThreadPlaceHead } from '../../../../shared/types/thread-places'
import { mainMessage, type MainMessage } from '../../../../shared/messages'
import { execGit } from '../../utils/safe-git'
import { isSafeBranchName } from '../../utils/git-ref-name'
import { threadPanes } from './thread-panes'

/**
 * F4 A15 (ccr-t71-task-places.md §2.4): branch drift of one place. Read only at a turn's begin and end and when the
 * places or a place diff are asked for; never a timer or a watcher. SECURITY: Switch back is a git write from the UI,
 * run through GhExec with an argument array (no shell, no stash, no force), the branch name checked first.
 */
const LIMITS = { timeout: 10_000 }

const out = async (cwd: string, args: string[]): Promise<string> => (await execGit(cwd, args, LIMITS)).stdout

export const sameHead = (a: ThreadPlaceHead, b: ThreadPlaceHead): boolean => a.branch === b.branch && a.commit === b.commit

export async function isAncestor(cwd: string, ancestor: string, descendant: string): Promise<boolean> {
  try { await execGit(cwd, ['merge-base', '--is-ancestor', ancestor, descendant], LIMITS); return true } catch { return false }
}

/** `to` is `from` or moved forward on the same branch (a commit, a fast-forward). */
export async function headFollows(cwd: string, from: ThreadPlaceHead, to: ThreadPlaceHead): Promise<boolean> {
  if (from.branch !== to.branch) return false
  if (from.commit === to.commit) return true
  if (!from.commit || !to.commit) return false
  return isAncestor(cwd, from.commit, to.commit)
}

/** A rebase, merge, cherry-pick, revert or bisect in progress: the read waits until it ends (HML 704-4). */
export async function operationInProgress(cwd: string): Promise<boolean> {
  let paths: string
  try {
    paths = await out(cwd, ['rev-parse', '--git-path', 'rebase-merge', '--git-path', 'rebase-apply', '--git-path', 'MERGE_HEAD',
      '--git-path', 'BISECT_LOG', '--git-path', 'CHERRY_PICK_HEAD', '--git-path', 'REVERT_HEAD'])
  } catch { return false }
  return paths.split(/\r?\n/).map(value => value.trim()).filter(Boolean)
    .some(path => existsSync(isAbsolute(path) ? path : resolve(cwd, path)))
}

/** Uncommitted changes, untracked files included; throws when git cannot say. */
async function isDirty(cwd: string): Promise<boolean> {
  return (await out(cwd, ['status', '--porcelain=v1', '-z'])).length > 0
}

async function branchExists(cwd: string, branch: string): Promise<boolean> {
  try { await out(cwd, ['show-ref', '--verify', '--quiet', `refs/heads/${branch}`]); return true } catch { return false }
}

/**
 * The drift a place shows now, or null. Not drift: the same branch with the base an ancestor of HEAD, a HEAD move
 * the conversation made itself (`taskMovedHead`), or an operation in progress. `by` names the panes in the place as
 * a hint; it is never certain.
 */
export async function readPlaceDrift(place: ThreadPlace, context: { taskMovedHead: boolean; panes: ThreadPaneSource[]; now: number }): Promise<ThreadPlaceDrift | null> {
  if (place.kind === 'outside' || !place.base || !place.current) return null
  if (context.taskMovedHead) return null
  if (await operationInProgress(place.path)) return null
  const { base, current } = place
  let moved = base.branch !== current.branch
  if (!moved && base.commit && current.commit && base.commit !== current.commit) moved = !(await isAncestor(place.path, base.commit, current.commit))
  if (!moved) return null
  const by = threadPanes([place], context.panes).map(pane => ({ kind: 'pane' as const, id: pane.paneId, title: pane.title }))
  let dirty = false
  try { dirty = await isDirty(place.path) } catch { dirty = false }
  return {
    from: { branch: base.branch, commit: base.commit }, to: { branch: current.branch, commit: current.commit },
    seenAt: context.now, by, certain: false, dirty, detached: base.branch === null
  }
}

const refuse = (code: 'thread.place.detached' | 'thread.place.dirty' | 'thread.place.noDrift'): { ok: false; refusal: MainMessage } => ({ ok: false, refusal: mainMessage(code, {}) })

/**
 * Switch back: `git switch <base.branch>` on a clean tree. Refused when the base had no branch, the tree is dirty or
 * the branch no longer exists; never stashes, never forces.
 */
export async function switchPlaceBack(place: ThreadPlace): Promise<{ ok: true } | { ok: false; refusal: MainMessage }> {
  if (place.kind === 'outside' || !place.base) return refuse('thread.place.noDrift')
  const branch = place.base.branch
  if (!branch) return refuse('thread.place.detached')
  if (!isSafeBranchName(branch)) throw new Error('Refused an unsafe branch name.')
  let dirty = true
  try { dirty = await isDirty(place.path) } catch { dirty = true }
  if (dirty) return refuse('thread.place.dirty')
  if (!(await branchExists(place.path, branch))) return { ok: false, refusal: mainMessage('thread.place.branchGone', { branch }) }
  const { GhExec } = await import('../github/gh-exec')
  await new GhExec().runGit(['switch', '--no-guess', branch], place.path)
  return { ok: true }
}
