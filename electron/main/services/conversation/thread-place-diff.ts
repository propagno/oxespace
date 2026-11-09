import type { GitDiff, GitDiffFile } from '../../../../shared/types/git'
import type { ThreadPlace, ThreadPlaceDiff, ThreadPlaceDrift, ThreadPlaceWrite } from '../../../../shared/types/thread-places'
import { execGit } from '../../utils/safe-git'

/** projectDiff's flags and limits (2 MiB, 15 s). */
const DIFF_FLAGS = ['--no-pager', 'diff', '--no-ext-diff', '--no-textconv', '--unified=3'] as const
const LIMITS = { maxBuffer: 2 * 1024 * 1024, timeout: 15_000 }

async function run(cwd: string, args: string[]): Promise<string> {
  return (await execGit(cwd, args, LIMITS)).stdout
}

/** Exit 1 with output is git's "they differ" (diff --no-index); anything else is a failure. */
async function runDiffering(cwd: string, args: string[]): Promise<string> {
  try { return await run(cwd, args) } catch (error) {
    const failed = error as { code?: unknown; stdout?: unknown }
    if (failed.code === 1 && typeof failed.stdout === 'string') return failed.stdout
    throw error
  }
}

async function emptyTree(cwd: string): Promise<string> {
  return (await run(cwd, ['hash-object', '-t', 'tree', '--stdin'])).trim()
}

const diffOf = (files: GitDiffFile[], base: string): GitDiff => ({ files, base, includeUncommitted: true, compiledAt: Date.now() })

/**
 * The drift a place shows now when none is recorded (§2.4): its branch is not the base's, or the base is no longer an
 * ancestor of HEAD. A commit by the task on the same branch moves HEAD forward and is not drift.
 */
export async function observedDrift(place: ThreadPlace): Promise<ThreadPlaceDrift | null> {
  if (place.drift) return place.drift
  if (place.kind === 'outside' || !place.base || !place.current) return null
  const { base, current } = place
  let moved = base.branch !== current.branch
  if (!moved && base.commit && current.commit && base.commit !== current.commit) {
    try { await run(place.path, ['merge-base', '--is-ancestor', base.commit, current.commit]) } catch { moved = true }
  }
  if (!moved && !base.commit && current.commit && base.branch === current.branch) moved = false
  if (!moved) return null
  return { from: { branch: base.branch, commit: base.commit }, to: { branch: current.branch, commit: current.commit }, seenAt: Date.now(), by: [], certain: false }
}

/**
 * Changes of one place against its own base (§2.6): `git diff <base>` (the empty tree when unborn) plus the untracked
 * files the task wrote. With drift not followed, files the branch switch changed that the task did not write go to
 * `branchSwitch`. An outside place lists the written rows.
 */
export async function placeDiff(place: ThreadPlace, written: ThreadPlaceWrite[]): Promise<ThreadPlaceDiff> {
  if (place.kind === 'outside') return { place, groups: { written: written.map(row => ({ ...row })) } }
  const { parseDiffOutput } = await import('../git.service')
  const cwd = place.path
  const baseCommit = place.base?.commit ?? null
  let base: string
  let label: string
  if (baseCommit) { base = baseCommit; label = baseCommit }
  else if (place.base) { base = await emptyTree(cwd); label = 'Unborn branch' }
  else {
    // Never touched inside a running turn: no base was captured, so HEAD (or the empty tree) stands in.
    let head: string | null = null
    try { head = (await run(cwd, ['rev-parse', '--verify', '-q', 'HEAD'])).trim() || null } catch { head = null }
    base = head ?? await emptyTree(cwd); label = head ? 'HEAD' : 'Unborn branch'
  }
  const files = parseDiffOutput(await run(cwd, [...DIFF_FLAGS, base, '--']))

  // Untracked files the task wrote are not in `git diff <base>`; each is diffed against nothing.
  const writtenPaths = written.filter(row => row.kind !== 'delete').map(row => row.path)
  if (writtenPaths.length) {
    const untracked = (await run(cwd, ['ls-files', '--others', '--exclude-standard', '-z', '--', ...writtenPaths])).split('\u0000').filter(Boolean)
    for (const path of untracked) {
      const raw = await runDiffering(cwd, [...DIFF_FLAGS, '--no-index', '--', '/dev/null', path]).catch(() => '')
      for (const file of parseDiffOutput(raw)) if (!files.some(known => known.path === file.path)) files.push({ ...file, path })
    }
  }

  const drift = await observedDrift(place)
  const followed = drift?.answer === 'followed'
  if (!drift || followed || !baseCommit || !drift.to.commit) return { place: { ...place, drift }, groups: { task: diffOf(files, label) } }
  const switched = new Set((await run(cwd, ['diff', '--name-only', '-z', baseCommit, drift.to.commit, '--'])).split('\u0000').filter(Boolean))
  const own = new Set(written.map(row => row.path))
  const bySwitch = (file: GitDiffFile): boolean => switched.has(file.path) && !own.has(file.path)
  const task = diffOf(files.filter(file => !bySwitch(file)), label)
  const moved = files.filter(bySwitch)
  return { place: { ...place, drift }, groups: moved.length ? { task, branchSwitch: diffOf(moved, label) } : { task } }
}
