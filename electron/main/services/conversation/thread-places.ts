import { createHash } from 'node:crypto'
import { existsSync, lstatSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, delimiter, dirname, isAbsolute, join, parse, relative, resolve, sep } from 'node:path'
import type { AppDatabase } from '../../db'
import type { ConversationThread, ThreadEvent, ThreadFileChange } from '../../../../shared/types/thread'
import { THREAD_PLACE_LIMITS, type ThreadPlace, type ThreadPlaceHead, type ThreadPlaceKind, type ThreadPlaces } from '../../../../shared/types/thread-places'
import { canonicalPath, sameRepository, staysLocal } from '../git-common-dir'
import { execGit } from '../../utils/safe-git'
import type { ThreadCheckpointService } from './thread-checkpoints'

/** One path of evidence: a file a tool wrote, a path it named (previousPath, a request), or a checkout the provider reported. */
export interface PlaceEvidence { path: string; mode: 'write' | 'touch' | 'location'; kind?: ThreadFileChange['kind'] }
/** The turn the evidence arrived in; `running` tells whether it still runs. */
export interface PlaceTurn { turnId: string; running(): boolean }
type PlaceThread = Pick<ConversationThread, 'id' | 'rootPath' | 'ownedWorktree'>
interface PlaceRow {
  id: string; kind: ThreadPlaceKind; path: string; first_seen_at: number; base_commit: string | null; base_branch: string | null
  base_captured_at: number | null; base_turn_id: string | null; drift_json: string | null
}
interface Target { kind: ThreadPlaceKind; path: string; file?: string }

const MAX_PATH = 4096
const MAX_WRITES = 2000
const NUL = String.fromCharCode(0)
const BACKSLASH = String.fromCharCode(92)
const WRITE_KINDS: ReadonlySet<string> = new Set(['add', 'update', 'delete', 'rename'])
const isSlash = (char: string | undefined): boolean => char === '/' || char === BACKSLASH

/**
 * The evidence an event carries (§2.2): tool and turn-diff file paths (previousPath included) and request paths.
 * Message text is never evidence, and the working-tree observation is already about a known place.
 */
export function placeEvidenceOf(event: ThreadEvent): { key: string; items: PlaceEvidence[] } | null {
  const fromFiles = (files: ThreadFileChange[] | undefined): PlaceEvidence[] => (files ?? []).flatMap((file): PlaceEvidence[] => file.source === 'working-tree-observation' ? [] : [
    { path: file.path, mode: 'write', kind: file.kind },
    ...(file.previousPath ? [{ path: file.previousPath, mode: 'touch' as const }] : [])
  ])
  switch (event.type) {
    case 'tool': return event.state === 'completed' && event.files?.length ? { key: `tool:${event.id}`, items: fromFiles(event.files) } : null
    case 'turn-diff': return event.files.length ? { key: `turn-diff:${event.id}`, items: fromFiles(event.files) } : null
    case 'request': return event.request.paths?.length ? { key: `request:${event.id}`, items: event.request.paths.map(path => ({ path, mode: 'touch' as const })) } : null
    default: return null
  }
}

/** Stable per canonical path, so the same folder in two spellings is one place. */
export function placeId(path: string): string {
  return createHash('sha256').update(canonicalPath(path)).digest('hex').slice(0, 24)
}

/**
 * Owns the rows of migration 095 for one database: places per conversation, their writes, refusals and the cap.
 * Evidence is applied in order per conversation; a read waits for what is pending, so it never races a write.
 */
export class ThreadPlaceStore {
  private homeDir: string = homedir()
  private readonly queues = new Map<string, Promise<void>>()
  private readonly seen = new Map<string, Set<string>>()

  constructor(private readonly db: AppDatabase,
    private readonly checkpoints: Pick<ThreadCheckpointService, 'turnBase'>,
    private readonly openCheckpoint: (threadId: string, turnId: string, root: string) => Promise<void>,
    private readonly changed: (threadId: string) => void = () => {}) {}

  configure(options: { homeDir?: string }): void { if (options.homeDir) this.homeDir = options.homeDir }

  /** Queues evidence; `key` makes a repeated event a no-op. */
  record(thread: PlaceThread, key: string, items: PlaceEvidence[], turn: PlaceTurn | null): void {
    if (!items.length) return
    let seen = this.seen.get(thread.id)
    if (!seen) { seen = new Set(); this.seen.set(thread.id, seen) }
    if (seen.has(key)) return
    if (seen.size > 10_000) seen.clear()
    seen.add(key)
    const context: PlaceThread = { id: thread.id, rootPath: thread.rootPath, ownedWorktree: thread.ownedWorktree }
    this.enqueue(thread.id, () => this.apply(context, items, turn))
  }

  /** The places, root first; the root is made here the first time. `current` is read now. */
  async list(thread: PlaceThread): Promise<ThreadPlaces> {
    await this.idle(thread.id)
    this.ensureRoot(thread)
    const rows = this.db.prepare(`SELECT * FROM thread_places WHERE thread_id = ?
      ORDER BY CASE kind WHEN 'root' THEN 0 ELSE 1 END, first_seen_at, rowid`).all(thread.id) as PlaceRow[]
    const filesOf = this.db.prepare('SELECT path FROM thread_place_writes WHERE thread_id = ? AND place_id = ? ORDER BY at DESC, rowid DESC')
    const places = await Promise.all(rows.map(async (row): Promise<ThreadPlace> => {
      const files = (filesOf.all(thread.id, row.id) as Array<{ path: string }>).map(value => value.path)
      return {
        id: row.id, kind: row.kind, path: row.path, firstSeenAt: row.first_seen_at,
        base: row.kind === 'outside' || row.base_captured_at === null ? null : { commit: row.base_commit, branch: row.base_branch, capturedAt: row.base_captured_at, turnId: row.base_turn_id },
        current: row.kind === 'outside' ? null : await currentOf(row.path),
        drift: row.drift_json ? JSON.parse(row.drift_json) : null,
        writes: files.length, files
      }
    }))
    const counters = this.db.prepare('SELECT refused, capped FROM thread_place_counters WHERE thread_id = ?').get(thread.id) as { refused: number; capped: number } | undefined
    return { places, capped: Boolean(counters?.capped), refused: counters?.refused ?? 0 }
  }

  /** Waits for the evidence already queued for a conversation. */
  async idle(threadId: string): Promise<void> {
    let last: Promise<void> | undefined
    for (let pending = this.queues.get(threadId); pending && pending !== last; pending = this.queues.get(threadId)) { last = pending; await pending }
  }

  forget(threadId: string): void { this.seen.delete(threadId) }

  private enqueue(threadId: string, work: () => Promise<void>): void {
    const next = (this.queues.get(threadId) ?? Promise.resolve()).then(work).catch(() => undefined)
    this.queues.set(threadId, next)
    void next.then(() => { if (this.queues.get(threadId) === next) this.queues.delete(threadId) })
  }

  private async apply(thread: PlaceThread, items: PlaceEvidence[], turn: PlaceTurn | null): Promise<void> {
    try { this.ensureRoot(thread) } catch { return }
    for (const item of items) {
      try { await this.applyOne(thread, item, turn) } catch { /* The conversation may have been deleted meanwhile. */ }
    }
  }

  private ensureRoot(thread: PlaceThread): void {
    const id = placeId(thread.rootPath)
    if (this.row(thread.id, id)) return
    // A conversation started in its own worktree: that worktree is the root and its base is already known.
    const owned = thread.ownedWorktree
    const branch = owned && typeof (owned as { branch?: unknown }).branch === 'string' ? (owned as { branch: string }).branch : null
    const now = Date.now()
    if (this.db.prepare(`INSERT OR IGNORE INTO thread_places (thread_id, id, kind, path, first_seen_at, base_commit, base_branch, base_captured_at, base_turn_id)
      VALUES (?, ?, 'root', ?, ?, ?, ?, ?, NULL)`).run(thread.id, id, thread.rootPath, now, owned?.baseSha || null, branch, owned ? now : null).changes) this.changed(thread.id)
  }

  private async applyOne(thread: PlaceThread, item: PlaceEvidence, turn: PlaceTurn | null): Promise<void> {
    const target = this.locate(thread, item)
    if (target === 'refused') { this.count(thread.id, 1, false); return }
    if (!target) return
    const id = placeId(target.path)
    let row = this.row(thread.id, id)
    if (!row) {
      if (!this.hasRoom(thread.id, target.kind)) { this.count(thread.id, 0, true); return }
      if (this.db.prepare('INSERT OR IGNORE INTO thread_places (thread_id, id, kind, path, first_seen_at) VALUES (?, ?, ?, ?, ?)').run(thread.id, id, target.kind, target.path, Date.now()).changes) this.changed(thread.id)
      row = this.row(thread.id, id)
      if (!row) return
    }
    if (turn && row.kind !== 'outside' && row.base_captured_at === null) await this.captureBase(thread.id, row, turn)
    if (item.mode === 'write' && target.file) this.write(thread.id, id, target.file, item.kind, turn?.turnId ?? null)
  }

  /**
   * The base at first touch (§2.3): the checkpoint this turn opened for that checkout, else one opened now while the
   * turn still runs; the branch from symbolic-ref (null when detached); an unborn branch has a null commit.
   */
  private async captureBase(threadId: string, row: PlaceRow, turn: PlaceTurn): Promise<void> {
    const own = Promise.all([headCommit(row.path), headBranch(row.path)])
    let opened = this.checkpoints.turnBase(threadId, turn.turnId, row.path)
    if (!opened && turn.running()) {
      await this.openCheckpoint(threadId, turn.turnId, row.path).catch(() => undefined)
      opened = this.checkpoints.turnBase(threadId, turn.turnId, row.path)
    }
    const [commit, branch] = await own
    this.db.prepare(`UPDATE thread_places SET base_commit = ?, base_branch = ?, base_captured_at = ?, base_turn_id = ?
      WHERE thread_id = ? AND id = ? AND base_captured_at IS NULL`).run(opened ? opened.commit : commit, branch, Date.now(), turn.turnId, threadId, row.id)
  }

  private write(threadId: string, placeId: string, path: string, kind: string | undefined, turnId: string | null): void {
    this.db.transaction(() => {
      this.db.prepare(`INSERT INTO thread_place_writes (thread_id, place_id, path, kind, turn_id, at) VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(thread_id, place_id, path) DO UPDATE SET kind = excluded.kind, turn_id = excluded.turn_id, at = excluded.at`)
        .run(threadId, placeId, path, kind && WRITE_KINDS.has(kind) ? kind : 'update', turnId, Date.now())
      this.db.prepare(`DELETE FROM thread_place_writes WHERE thread_id = ? AND rowid NOT IN
        (SELECT rowid FROM thread_place_writes WHERE thread_id = ? ORDER BY at DESC, rowid DESC LIMIT ?)`).run(threadId, threadId, MAX_WRITES)
      this.db.prepare(`UPDATE thread_places SET writes = (SELECT COUNT(*) FROM thread_place_writes w WHERE w.thread_id = thread_places.thread_id AND w.place_id = thread_places.id)
        WHERE thread_id = ?`).run(threadId)
    })()
  }

  /** Where a path of evidence belongs, or 'refused' when the path fails a check; null when it names no place. */
  private locate(thread: PlaceThread, item: PlaceEvidence): Target | 'refused' | null {
    const full = evidencePath(item.path)
    if (!full) return 'refused'
    const dir = item.mode === 'location' ? full : dirname(full)
    // Walked before stat, so a link out of the folder is never followed.
    if (crossesLink(dir) || !isDirectory(dir)) return 'refused'
    const ceilings = ceilingDirs()
    const top = checkoutRootOf(dir, ceilings)
    const rootTop = checkoutRootOf(thread.rootPath, ceilings) ?? thread.rootPath
    const file = (base: string): string | undefined => item.mode === 'write' ? inside(base, full) : undefined
    if (top !== null && canonicalPath(top) === canonicalPath(rootTop)) return { kind: 'root', path: thread.rootPath, file: file(thread.rootPath) }
    // No git above, or a repository whose top is the home folder or a drive root (A13 v2): outside, at the file's folder.
    if (top === null || this.outsideTop(top)) return item.mode === 'location' ? null : { kind: 'outside', path: dir, file: item.mode === 'write' ? basename(full) : undefined }
    return { kind: sameRepository(top, rootTop) ? 'worktree' : 'checkout', path: top, file: file(top) }
  }

  private outsideTop(top: string): boolean {
    const full = resolve(top)
    return dirname(full) === full || parse(full).root === full || canonicalPath(full) === canonicalPath(this.homeDir)
  }

  private hasRoom(threadId: string, kind: ThreadPlaceKind): boolean {
    const outside = kind === 'outside'
    const { n } = this.db.prepare(`SELECT COUNT(*) AS n FROM thread_places WHERE thread_id = ? AND ${outside ? "kind = 'outside'" : "kind <> 'outside'"}`).get(threadId) as { n: number }
    return n < (outside ? THREAD_PLACE_LIMITS.outside : THREAD_PLACE_LIMITS.places)
  }

  private count(threadId: string, refused: number, capped: boolean): void {
    this.db.prepare(`INSERT INTO thread_place_counters (thread_id, refused, capped) VALUES (?, ?, ?)
      ON CONFLICT(thread_id) DO UPDATE SET refused = refused + excluded.refused, capped = max(capped, excluded.capped)`).run(threadId, refused, capped ? 1 : 0)
  }

  private row(threadId: string, id: string): PlaceRow | undefined {
    return this.db.prepare('SELECT * FROM thread_places WHERE thread_id = ? AND id = ?').get(threadId, id) as PlaceRow | undefined
  }
}

/** Absolute, no NUL, at most 4096 characters, never a share or a device path, and reached without leaving the machine. */
function evidencePath(raw: unknown): string | null {
  if (typeof raw !== 'string' || !raw || raw.length > MAX_PATH || raw.includes(NUL)) return null
  if (isSlash(raw[0]) && isSlash(raw[1])) return null
  if (!isAbsolute(raw)) return null
  if (process.platform === 'win32' && !(/^[A-Za-z]:/.test(raw) && isSlash(raw[2]))) return null
  if (!staysLocal(raw)) return null
  return resolve(raw)
}

/** Whether any component of the folder is a link (a junction included), or cannot be read. */
function crossesLink(dir: string): boolean {
  const full = resolve(dir)
  const { root } = parse(full)
  let current = root
  for (const part of full.slice(root.length).split(sep).filter(Boolean)) {
    current = join(current, part)
    try { if (lstatSync(current).isSymbolicLink()) return true } catch { return true }
  }
  return false
}

function isDirectory(path: string): boolean {
  try { return statSync(path).isDirectory() } catch { return false }
}

function entryExists(path: string): boolean {
  try { lstatSync(path); return true } catch { return false }
}

/** The folders git never looks into from below (GIT_CEILING_DIRECTORIES), so the answer matches git's. */
function ceilingDirs(): Set<string> {
  return new Set((process.env.GIT_CEILING_DIRECTORIES ?? '').split(delimiter).filter(value => value && isAbsolute(value)).map(value => canonicalPath(value)))
}

/** Top of the checkout containing `dir`: the nearest folder with a `.git` entry, below any ceiling; null when none. */
function checkoutRootOf(dir: string, ceilings: Set<string>): string | null {
  let current = resolve(dir)
  for (let depth = 0; depth < 64; depth++) {
    if (entryExists(join(current, '.git'))) return current
    const parent = dirname(current)
    if (parent === current || ceilings.has(canonicalPath(parent))) return null
    current = parent
  }
  return null
}

/** `full` relative to `base` with forward slashes, or undefined when it is not inside. */
function inside(base: string, full: string): string | undefined {
  const rel = relative(base, full)
  if (!rel || rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) return undefined
  return rel.split(sep).join('/')
}

async function gitLine(cwd: string, args: string[]): Promise<string | null> {
  try { return (await execGit(cwd, args, { timeout: 10_000 })).stdout.trim() || null } catch { return null }
}
const headCommit = (path: string): Promise<string | null> => gitLine(path, ['rev-parse', '--verify', '-q', 'HEAD'])
const headBranch = (path: string): Promise<string | null> => gitLine(path, ['symbolic-ref', '--short', '-q', 'HEAD'])

async function currentOf(path: string): Promise<ThreadPlaceHead | null> {
  if (!existsSync(path)) return null
  const [commit, branch] = await Promise.all([headCommit(path), headBranch(path)])
  return { branch, commit }
}
