import { randomBytes } from 'node:crypto'
import { lstatSync, statSync, unlinkSync } from 'node:fs'
import { isAbsolute, join, relative, resolve } from 'node:path'
import type { GitDiff } from '../../../../shared/types/git'
import type { ThreadPlace, ThreadPlaceDiff } from '../../../../shared/types/thread-places'
import { mainMessage, type MainMessage } from '../../../../shared/messages'
import { execGit } from '../../utils/safe-git'

/**
 * F4 A14 Undo (ccr-f4-places-pr.md §A14 Undo; SECURITY conditions 1-6 of 08/11). Person-only: never reachable from an
 * agent-facing module or MCP. Undo reverts one file (or one hunk) the task wrote in a git place back to the place's
 * base; Restore puts that change back once; Discard reverts every file the task wrote there. Git runs through safe git:
 * diffs through execGit, the patch through GhExec.runGit (an argument array, no shell, the patch on stdin). Never
 * reset --hard, never clean; the only fs write is the unlink of a file the task created, inside the place.
 */

/** placeDiff's flags (so hunk headers match) plus --binary, so a binary file's patch can be applied too. */
const DIFF_FLAGS = ['--no-pager', 'diff', '--no-ext-diff', '--no-textconv', '--unified=3', '--binary'] as const
const LIMITS = { maxBuffer: 8 * 1024 * 1024, timeout: 15_000 }
/** A restore token lives at most this long (and never past the conversation's next turn). */
export const PLACE_RESTORE_TTL_MS = 10 * 60 * 1000

type UndoCode = 'thread.place.outside' | 'thread.place.notTask' | 'thread.place.stale' | 'thread.place.restoreGone' | 'thread.place.confirm'
export type PlaceRefusal = { ok: false; refusal: MainMessage }
export const refusePlace = (code: UndoCode): PlaceRefusal => ({ ok: false, refusal: mainMessage(code, {}) })

const out = async (cwd: string, args: string[]): Promise<string> => (await execGit(cwd, args, LIMITS)).stdout

/** Exit 1 with output is git's "they differ" (diff --no-index); anything else is a failure. */
async function differing(cwd: string, args: string[]): Promise<string> {
  try { return await out(cwd, args) } catch (error) {
    const failed = error as { code?: unknown; stdout?: unknown }
    if (failed.code === 1 && typeof failed.stdout === 'string') return failed.stdout
    throw error
  }
}

const literal = (path: string): string => `:(literal)${path}`

/** The base the place diffs against, chosen as placeDiff chooses it. */
async function baseOf(place: ThreadPlace): Promise<string> {
  if (place.base?.commit) return place.base.commit
  if (!place.base) {
    try { const head = (await out(place.path, ['rev-parse', '--verify', '-q', 'HEAD'])).trim(); if (head) return head } catch { /* unborn */ }
  }
  return (await out(place.path, ['hash-object', '-t', 'tree', '--stdin'])).trim()
}

/** A relative path with forward slashes that stays in the place, or null. */
function normalPath(raw: unknown): string | null {
  if (typeof raw !== 'string' || !raw || raw.length > 4096 || raw.includes('\u0000')) return null
  const path = raw.replace(/\\/g, '/')
  if (isAbsolute(path) || /^[A-Za-z]:/.test(path) || path.startsWith('/')) return null
  if (path.split('/').some(part => part === '..' || part === '')) return null
  return path
}

async function isUntracked(cwd: string, path: string): Promise<boolean> {
  return (await out(cwd, ['ls-files', '--others', '--exclude-standard', '-z', '--', literal(path)])).split('\u0000').some(Boolean)
}

/** The task's change of one file against the base: `git diff <base> -- <path>`, or against nothing when untracked. */
async function forwardPatch(place: ThreadPlace, base: string, path: string): Promise<string> {
  if (await isUntracked(place.path, path)) return differing(place.path, [...DIFF_FLAGS, '--no-index', '--', '/dev/null', path])
  return out(place.path, [...DIFF_FLAGS, base, '--', literal(path)])
}

/** The one-file patch cut to the file header and the hunk with this header; null when the header is not in it. */
function oneHunk(patch: string, header: string): string | null {
  const lines = patch.split('\n')
  const first = lines.findIndex(line => line.startsWith('@@ '))
  const at = lines.findIndex(line => line.startsWith('@@ ') && line === header)
  if (first < 0 || at < 0) return null
  let end = at + 1
  while (end < lines.length && !lines[end].startsWith('@@ ') && !lines[end].startsWith('diff --git ')) end++
  const body = [...lines.slice(0, first), ...lines.slice(at, end)]
  while (body.length && body[body.length - 1] === '') body.pop()
  return `${body.join('\n')}\n`
}

/**
 * True when git sees this working-tree file with LF (or no) line endings. Then apply runs with core.autocrlf off, so a
 * machine-wide autocrlf=true never rewrites an LF file as CRLF; a CRLF or missing file keeps git's own conversion.
 */
async function keepsLf(cwd: string, path: string): Promise<boolean> {
  try {
    const line = await out(cwd, ['ls-files', '--eol', '--cached', '--others', '--', literal(path)])
    const eol = /\bw\/(\S*)/.exec(line)?.[1] ?? ''
    return eol === 'lf' || eol === 'none'
  } catch { return false }
}

/** git apply (reverse for Undo and Discard, forward for Restore) through GhExec: argument array, patch on stdin. */
async function applyPatch(cwd: string, patch: string, reverse: boolean, lf: boolean): Promise<void> {
  const { GhExec } = await import('../github/gh-exec')
  const eol = lf ? ['-c', 'core.autocrlf=false'] : []
  await new GhExec().runGit([...eol, 'apply', ...(reverse ? ['--reverse'] : []), '--whitespace=nowarn'], cwd, patch)
}

/** The working-tree file's mtime, or null when it is not a file (deleted, say). */
function mtimeOf(placePath: string, path: string): number | null {
  try {
    const stat = statSync(join(placePath, path), { throwIfNoEntry: false })
    return stat?.isFile() ? stat.mtimeMs : null
  } catch { return null }
}

/** A14: the place diff with each file's working-tree mtime, the `seenMtime` Undo checks against. */
export function withPlaceMtimes(diff: ThreadPlaceDiff): ThreadPlaceDiff {
  if (!('task' in diff.groups)) return diff
  const fill = (group: GitDiff): GitDiff => ({ ...group, files: group.files.map(file => ({ ...file, mtime: mtimeOf(diff.place.path, file.path) })) })
  const { task, branchSwitch } = diff.groups
  return { ...diff, groups: branchSwitch ? { task: fill(task), branchSwitch: fill(branchSwitch) } : { task: fill(task) } }
}

/**
 * Undo one file, or one hunk of it, the task wrote in a git place. Refused: an outside place (thread.place.outside); a
 * file the task did not write or that no longer differs from the base (thread.place.notTask); a file whose mtime is not
 * `seenMtime`, or a hunk header no longer in its diff (thread.place.stale). A refusal changes nothing. `forward` is the
 * patch that was reverted, for Restore; it is held in memory only.
 */
export async function undoPlaceChange(place: ThreadPlace, input: { path: string; hunk?: string; seenMtime: number | null; written: string[] }): Promise<{ ok: true; forward: string } | { ok: false; refusal: MainMessage }> {
  if (place.kind === 'outside') return refusePlace('thread.place.outside')
  const path = normalPath(input.path)
  if (!path || !input.written.includes(path)) return refusePlace('thread.place.notTask')
  const patch = await forwardPatch(place, await baseOf(place), path)
  if (!patch.trim()) return refusePlace('thread.place.notTask')
  if (mtimeOf(place.path, path) !== input.seenMtime) return refusePlace('thread.place.stale')
  const forward = input.hunk === undefined ? patch : oneHunk(patch, input.hunk)
  if (!forward) return refusePlace('thread.place.stale')
  try { await applyPatch(place.path, forward, true, await keepsLf(place.path, path)) } catch { return refusePlace('thread.place.stale') }
  return { ok: true, forward }
}

/** Restore: the reverted patch applied forward again; a place that moved on since is thread.place.stale. */
export async function restorePlaceChange(place: ThreadPlace, forward: string, path: string): Promise<{ ok: true } | PlaceRefusal> {
  if (place.kind === 'outside') return refusePlace('thread.place.outside')
  const relativePath = normalPath(path)
  const lf = relativePath ? await keepsLf(place.path, relativePath) : false
  try { await applyPatch(place.path, forward, false, lf) } catch { return refusePlace('thread.place.stale') }
  return { ok: true }
}

/** Unlink one file the task created, only when it resolves inside the place and is a file or a link. */
function unlinkInside(placePath: string, path: string): void {
  const root = resolve(placePath)
  const target = resolve(root, path)
  const rel = relative(root, target)
  if (!rel || rel.startsWith('..') || isAbsolute(rel)) return
  const stat = lstatSync(target, { throwIfNoEntry: false })
  if (stat && (stat.isFile() || stat.isSymbolicLink())) unlinkSync(target)
}

/**
 * Discard: every file the task wrote in the place goes back to the base (a file it deleted is restored); a file it
 * created is unlinked. Files the task did not write are never named, so they are never touched.
 */
export async function discardPlace(place: ThreadPlace, written: string[]): Promise<{ ok: true } | PlaceRefusal> {
  if (place.kind === 'outside') return refusePlace('thread.place.outside')
  const base = await baseOf(place)
  const tracked: string[] = []
  const created: string[] = []
  for (const raw of new Set(written)) {
    const path = normalPath(raw)
    if (!path) continue
    if (await isUntracked(place.path, path)) created.push(path)
    else tracked.push(path)
  }
  // Split by line endings so each file keeps its own (see keepsLf).
  const lfFiles: string[] = []
  const other: string[] = []
  for (const path of tracked) (await keepsLf(place.path, path) ? lfFiles : other).push(path)
  for (const [group, lf] of [[lfFiles, true], [other, false]] as const) {
    if (!group.length) continue
    const patch = await out(place.path, [...DIFF_FLAGS, base, '--', ...group.map(literal)])
    if (patch.trim()) await applyPatch(place.path, patch, true, lf)
  }
  for (const path of created) unlinkInside(place.path, path)
  return { ok: true }
}

interface HeldRestore { threadId: string; placeId: string; path: string; forward: string; at: number }

/**
 * Restore data, in memory only (never the DB, never the audit): a 43-character base64url token bound to its thread and
 * place, single use, dropped at the thread's next turn and after ten minutes.
 */
export class PlaceRestoreTokens {
  private readonly held = new Map<string, HeldRestore>()

  issue(entry: Omit<HeldRestore, 'at'>): string {
    this.sweep()
    const token = randomBytes(32).toString('base64url')
    this.held.set(token, { ...entry, at: Date.now() })
    return token
  }

  /** The held restore for this thread, taken out (single use); null when unknown, another thread's or expired. */
  take(threadId: string, token: unknown): HeldRestore | null {
    if (typeof token !== 'string') return null
    const held = this.held.get(token)
    if (!held || held.threadId !== threadId) return null
    this.held.delete(token)
    return Date.now() - held.at > PLACE_RESTORE_TTL_MS ? null : held
  }

  dropThread(threadId: string): void {
    for (const [token, held] of this.held) if (held.threadId === threadId) this.held.delete(token)
  }

  private sweep(): void {
    const now = Date.now()
    for (const [token, held] of this.held) if (now - held.at > PLACE_RESTORE_TTL_MS) this.held.delete(token)
  }
}
