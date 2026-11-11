import { existsSync, readFileSync, statSync } from 'node:fs'
import { dirname, isAbsolute, join, resolve } from 'node:path'
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

const OBJECT_ID = /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/

/** The git dir of the checkout holding `placePath`: a `.git` folder, or a `.git` file's `gitdir:` (a worktree). */
function gitDirOf(placePath: string): string | null {
  let dir = resolve(placePath)
  for (;;) {
    const dotGit = join(dir, '.git')
    const stat = statSync(dotGit, { throwIfNoEntry: false })
    if (stat?.isDirectory()) return dotGit
    if (stat?.isFile()) {
      const line = readFileSync(dotGit, 'utf8').split(/\r?\n/).find(entry => entry.startsWith('gitdir:'))
      if (!line) return null
      const target = line.slice('gitdir:'.length).trim()
      return target ? (isAbsolute(target) ? target : resolve(dir, target)) : null
    }
    const parent = dirname(dir)
    if (parent === dir) return null
    dir = parent
  }
}

/** The commit a ref names: its loose file (in the git dir or the common dir), else packed-refs; null when unknown. */
function refCommit(gitDir: string, commonDir: string, ref: string): string | null {
  for (const root of commonDir === gitDir ? [gitDir] : [commonDir, gitDir]) {
    const loose = join(root, ...ref.split('/'))
    if (statSync(loose, { throwIfNoEntry: false })?.isFile()) {
      const value = readFileSync(loose, 'utf8').trim()
      return OBJECT_ID.test(value) ? value : null
    }
  }
  const packed = join(commonDir, 'packed-refs')
  if (!statSync(packed, { throwIfNoEntry: false })?.isFile()) return null
  for (const line of readFileSync(packed, 'utf8').split(/\r?\n/)) {
    if (!line || line.startsWith('#') || line.startsWith('^')) continue
    const space = line.indexOf(' ')
    if (space > 0 && line.slice(space + 1).trim() === ref) {
      const value = line.slice(0, space).trim()
      return OBJECT_ID.test(value) ? value : null
    }
  }
  return null
}

/**
 * CR-F4-2b: a place's HEAD read now, with no subprocess, so an event handler can take it at once. Reads the git dir's
 * HEAD: `ref: refs/heads/<b>` gives { branch, commit } from the loose ref or packed-refs; a commit id is a detached
 * HEAD ({ branch: null, commit }). Null when it cannot say (an unborn branch, another ref, no git dir): the caller
 * falls back to the queued read. Reads only git's own HEAD and ref files, never the working tree.
 */
export function readHeadSync(placePath: string): ThreadPlaceHead | null {
  try {
    const gitDir = gitDirOf(placePath)
    if (!gitDir) return null
    const head = readFileSync(join(gitDir, 'HEAD'), 'utf8').trim()
    if (OBJECT_ID.test(head)) return { branch: null, commit: head }
    const ref = head.match(/^ref:\s*(refs\/heads\/\S+)$/)?.[1]
    if (!ref) return null
    let commonDir = gitDir
    const commonFile = join(gitDir, 'commondir')
    if (statSync(commonFile, { throwIfNoEntry: false })?.isFile()) {
      const value = readFileSync(commonFile, 'utf8').trim()
      if (value) commonDir = isAbsolute(value) ? value : resolve(gitDir, value)
    }
    const commit = refCommit(gitDir, commonDir, ref)
    return commit ? { branch: ref.slice('refs/heads/'.length), commit } : null
  } catch { return null }
}

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
  // --no-optional-locks: a read never takes index.lock to refresh the index, so a person's git command never fails on it.
  return (await out(cwd, ['--no-optional-locks', 'status', '--porcelain=v1', '-z'])).length > 0
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
  let dirty: boolean
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
  let dirty: boolean
  try { dirty = await isDirty(place.path) } catch { dirty = true }
  if (dirty) return refuse('thread.place.dirty')
  if (!(await branchExists(place.path, branch))) return { ok: false, refusal: mainMessage('thread.place.branchGone', { branch }) }
  const { GhExec } = await import('../github/gh-exec')
  await new GhExec().runGit(['switch', '--no-guess', branch], place.path)
  return { ok: true }
}
