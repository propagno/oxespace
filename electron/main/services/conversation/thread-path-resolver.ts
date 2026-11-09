// A16 (1.5.0 F4, ccr-t71-task-places.md §3): one path resolver in main, so the window, MCP and the phone open a path the
// same way. Order: absolute → the turn's cwd → its checkout root → the task's worktrees → the project root → the task's
// other places → sibling worktrees. Only lstat/stat (and `git worktree list`): no file content is read, and nothing
// is written, so resolving never creates a place.
import { lstatSync } from 'node:fs'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'
import type { ConversationThread } from '../../../../shared/types/thread'
import type { ThreadPathResolution, ThreadPathStep, ThreadPlaceKind } from '../../../../shared/types/thread-places'
import { canonicalPath, findCheckoutRoot, staysLocal } from '../git-common-dir'
import { execGit } from '../../utils/safe-git'

/** A place of the conversation as the resolver needs it (migration 095 rows, read-only). */
export interface ThreadPathPlace { id: string; kind: ThreadPlaceKind; path: string; firstSeenAt: number; lastWriteAt: number | null }
/** What one resolution may look at: the conversation, the cwd of the turn asked about, and its places. */
export interface ThreadPathContext {
  thread: Pick<ConversationThread, 'rootPath' | 'ownedWorktree'>
  /** The location the provider reported last up to that turn (thread_turn_cwd); null when it never reported one. */
  turnCwd: string | null
  places: ThreadPathPlace[]
}

export const THREAD_PATH_MAX = 4096
const NUL = String.fromCharCode(0)
const SIBLING_LIMIT = 16
const SIBLING_TTL_MS = 30_000
/** Windows device names: reserved in every folder and with any extension (`aux.txt`). */
const RESERVED = /^(con|prn|aux|nul|clock\$|conin\$|conout\$|com[0-9\u00b9\u00b2\u00b3]|lpt[0-9\u00b9\u00b2\u00b3])$/i

type Probe = { kind: 'hit' | 'miss' | 'refused'; path: string }
type Candidate = { path: string; placeId: string | null; via: ThreadPathStep }

export class ThreadPathInputError extends Error {}

/** The raw text checked and split: at most 4096 characters, no NUL; a trailing `:<line>` becomes the line. */
export function parseThreadPathInput(raw: unknown): { path: string; line?: number } {
  if (typeof raw !== 'string') throw new ThreadPathInputError('A path must be text.')
  if (raw.length > THREAD_PATH_MAX) throw new ThreadPathInputError(`A path is at most ${THREAD_PATH_MAX} characters.`)
  if (raw.includes(NUL)) throw new ThreadPathInputError('A path cannot contain a NUL character.')
  const text = raw.trim()
  if (!text) throw new ThreadPathInputError('A path is required.')
  const match = /^(.+?):(\d{1,9})$/.exec(text)
  // `C:12` is a drive-relative path, not a line.
  if (match && !/^[A-Za-z]$/.test(match[1]) && Number(match[2]) > 0) return { path: match[1], line: Number(match[2]) }
  return { path: text }
}

/**
 * SECURITY S2: device (`\\?\`, `\\.\`), UNC (`\\server`, `//server`), drive-relative (`C:a`), root-relative on Windows,
 * streams and reserved device names never resolve: stat on them may reach a device or the network.
 */
function refusedForm(path: string): boolean {
  if (/^[\\/]{2}/.test(path)) return true
  if (/^[A-Za-z]:(?![\\/])/.test(path)) return true
  if (process.platform === 'win32' && /^[\\/]/.test(path)) return true
  const parts = path.split(/[\\/]+/).filter(Boolean)
  return parts.some((part, index) => {
    if (index === 0 && /^[A-Za-z]:$/.test(part)) return false
    if (/[:<>"|?*]/.test(part)) return true
    return RESERVED.test(part.replace(/[. ]+$/, '').split('.')[0].trim())
  })
}

/** `rel` under `base`: refused when it walks out (`..`) or crosses a link; never follows one. */
function probe(base: string, rel: string): Probe {
  const root = resolve(base)
  const target = resolve(root, rel)
  const inner = relative(root, target)
  if (!inner || inner === '..' || inner.startsWith(`..${sep}`) || isAbsolute(inner)) return { kind: 'refused', path: target }
  if (refusedForm(root) || !staysLocal(root)) return { kind: 'refused', path: target }
  let current = root
  for (const part of inner.split(sep)) {
    current = join(current, part)
    try { if (lstatSync(current).isSymbolicLink()) return { kind: 'refused', path: target } } catch { return { kind: 'miss', path: target } }
  }
  return { kind: 'hit', path: target }
}

function probeAbsolute(path: string): Probe {
  const target = resolve(path)
  if (!staysLocal(target)) return { kind: 'refused', path: target }
  try { lstatSync(target); return { kind: 'hit', path: target } } catch { return { kind: 'miss', path: target } }
}

const siblingCache = new Map<string, { at: number; paths: Promise<string[]> }>()

/** `git worktree list --porcelain` of the repository: at most 16 entries, cached 30 s per repository. */
function siblingWorktrees(repository: string): Promise<string[]> {
  const key = canonicalPath(repository)
  const now = Date.now()
  const cached = siblingCache.get(key)
  if (cached && now - cached.at < SIBLING_TTL_MS) return cached.paths
  const paths = execGit(repository, ['worktree', 'list', '--porcelain'], { timeout: 10_000 })
    .then(result => result.stdout.split(/\r?\n/)
      .filter(line => line.startsWith('worktree '))
      .map(line => line.slice('worktree '.length).trim())
      .filter(path => path && isAbsolute(path) && !refusedForm(path))
      .slice(0, SIBLING_LIMIT)
      .map(path => resolve(path)))
    .catch(() => [] as string[])
  for (const [entry, value] of siblingCache) if (now - value.at >= SIBLING_TTL_MS) siblingCache.delete(entry)
  siblingCache.set(key, { at: now, paths })
  return paths
}

/**
 * Where a path a conversation named opens: found (with the step and the place it is in), ambiguous (two places or
 * two sibling worktrees have it; the window asks) or missing (every step it tried, and where).
 */
export async function resolveThreadPath(input: ThreadPathContext, raw: string): Promise<ThreadPathResolution> {
  const { path, line } = parseThreadPathInput(raw)
  const looked: { step: ThreadPathStep; path: string }[] = []
  const placeOf = (target: string): string | null => {
    const full = canonicalPath(target)
    let best: { id: string; length: number } | null = null
    for (const place of input.places) {
      const base = canonicalPath(place.path)
      if (full !== base && !full.startsWith(`${base}/`)) continue
      if (!best || base.length > best.length) best = { id: place.id, length: base.length }
    }
    return best?.id ?? null
  }
  const found = (candidate: Candidate): ThreadPathResolution => ({ kind: 'found', ...candidate, ...(line !== undefined ? { line } : {}) })
  const answer = (hits: Candidate[]): ThreadPathResolution => hits.length === 1 ? found(hits[0]) : { kind: 'ambiguous', candidates: hits }

  if (refusedForm(path)) return { kind: 'missing', looked: [{ step: 'absolute', path }] }
  if (isAbsolute(path)) {
    const result = probeAbsolute(path)
    if (result.kind === 'hit') return found({ path: result.path, placeId: placeOf(result.path), via: 'absolute' })
    return { kind: 'missing', looked: [{ step: 'absolute', path: result.path }] }
  }

  const attempt = (step: ThreadPathStep, base: string, placeId?: string | null): Candidate | null => {
    const result = probe(base, path)
    if (result.kind === 'hit') return { path: result.path, placeId: placeId !== undefined ? placeId : placeOf(result.path), via: step }
    looked.push({ step, path: result.path })
    return null
  }
  const collect = (bases: [ThreadPathStep, string, string | null | undefined][]): Candidate[] => {
    const hits: Candidate[] = []
    const seen = new Set<string>()
    for (const [step, base, placeId] of bases) {
      const hit = attempt(step, base, placeId)
      if (!hit) continue
      const key = canonicalPath(hit.path)
      if (seen.has(key)) continue
      seen.add(key); hits.push(hit)
    }
    return hits
  }

  // Steps 2 to 5 stop at the first hit.
  const first: [ThreadPathStep, string, string | null | undefined][] = []
  const cwd = input.turnCwd && isAbsolute(input.turnCwd) && !refusedForm(input.turnCwd) ? input.turnCwd : null
  if (cwd) {
    first.push(['turn-cwd', cwd, undefined])
    const top = staysLocal(cwd) ? findCheckoutRoot(cwd) : null
    if (top) first.push(['checkout-root', top, undefined])
  }
  for (const place of input.places.filter(entry => entry.kind === 'worktree').sort((a, b) => b.firstSeenAt - a.firstSeenAt)) first.push(['task-worktree', place.path, place.id])
  first.push(['project-root', input.thread.rootPath, undefined])
  const projectRoot = input.thread.ownedWorktree?.projectRoot
  if (projectRoot) first.push(['project-root', projectRoot, undefined])
  for (const [step, base, placeId] of first) {
    const hit = attempt(step, base, placeId)
    if (hit) return found(hit)
  }

  // Step 6: the task's checkout and outside places, newest write first; two hits are ambiguous.
  const others = input.places.filter(entry => entry.kind === 'checkout' || entry.kind === 'outside')
    .sort((a, b) => (b.lastWriteAt ?? -1) - (a.lastWriteAt ?? -1) || b.firstSeenAt - a.firstSeenAt)
  const placeHits = collect(others.map(place => ['task-place', place.path, place.id]))
  if (placeHits.length) return answer(placeHits)

  // Step 7, only after 1 to 6 missed: the project's sibling worktrees.
  const repository = projectRoot ?? input.thread.rootPath
  const siblings = await siblingWorktrees(repository)
  if (!siblings.length) looked.push({ step: 'sibling-worktree', path: resolve(repository) })
  const siblingHits = collect(siblings.map(sibling => ['sibling-worktree', sibling, undefined]))
  if (siblingHits.length) return answer(siblingHits)
  return { kind: 'missing', looked }
}
