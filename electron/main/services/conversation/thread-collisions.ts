import { isAbsolute, join, relative, sep } from 'node:path'
import type { AppDatabase } from '../../db'
import type { ThreadCollision, ThreadDirtyWrites } from '../../../../shared/types/thread-places'
import { canonicalPath } from '../git-common-dir'
import { execGit } from '../../utils/safe-git'
import { placeId } from './thread-places'

export type { ThreadCollision, ThreadDirtyWrites } from '../../../../shared/types/thread-places'

const NUL = String.fromCharCode(0)

/**
 * A54: the files `threadId` wrote and left dirty that another conversation also wrote and left dirty in the same
 * checkout. Pure: the entries already hold only written-and-dirty files. Sorted by file.
 */
export function findCollisions(threadId: string, entries: ThreadDirtyWrites[]): ThreadCollision[] {
  const result: ThreadCollision[] = []
  const seen = new Set<string>()
  for (const own of entries) {
    if (own.conversationId !== threadId) continue
    for (const file of own.files) {
      const key = `${own.checkoutId}\n${file}`
      if (seen.has(key)) continue
      seen.add(key)
      const others: ThreadCollision['others'] = []
      const named = new Set<string>()
      for (const other of entries) {
        if (other.conversationId === threadId || other.checkoutId !== own.checkoutId || named.has(other.conversationId)) continue
        if (!other.files.includes(file)) continue
        named.add(other.conversationId)
        others.push({ conversationId: other.conversationId, title: other.title })
      }
      if (others.length) result.push({ file, checkoutId: own.checkoutId, others })
    }
  }
  return result.sort((a, b) => a.file < b.file ? -1 : a.file > b.file ? 1 : a.checkoutId < b.checkoutId ? -1 : a.checkoutId > b.checkoutId ? 1 : 0)
}

/** A conversation that takes part in the check: the asking one and every other non-archived one. */
export interface CollisionThread { id: string; title: string }

interface WriteRow { thread_id: string; place_path: string; file: string }

/**
 * Reads every git place's written files for these conversations, resolves each place to its checkout root, runs one
 * `git status` per checkout the asking conversation wrote in, and intersects. Never reads file content.
 */
export async function threadCollisions(db: AppDatabase, threadId: string, threads: CollisionThread[]): Promise<ThreadCollision[]> {
  const titles = new Map(threads.map(thread => [thread.id, thread.title]))
  const rows = (db.prepare(`SELECT w.thread_id AS thread_id, p.path AS place_path, w.path AS file
    FROM thread_place_writes w JOIN thread_places p ON p.thread_id = w.thread_id AND p.id = w.place_id
    WHERE p.kind <> 'outside'`).all() as WriteRow[]).filter(row => titles.has(row.thread_id))
  if (!rows.some(row => row.thread_id === threadId)) return []

  const tops = new Map<string, Promise<string | null>>()
  const topOf = (path: string): Promise<string | null> => {
    let found = tops.get(path)
    if (!found) { found = checkoutTop(path); tops.set(path, found) }
    return found
  }
  const located = await Promise.all(rows.map(async row => {
    const top = await topOf(row.place_path)
    if (!top) return null
    const file = insideCheckout(top, row.place_path, row.file)
    return file ? { threadId: row.thread_id, top, checkoutId: placeId(top), file } : null
  }))
  const writes = located.filter((value): value is NonNullable<typeof value> => value !== null)

  // One status per checkout the asking conversation wrote in, per call.
  const checkouts = new Map<string, string>()
  for (const write of writes) if (write.threadId === threadId) checkouts.set(write.checkoutId, write.top)
  const dirty = new Map<string, Set<string> | null>()
  await Promise.all([...checkouts].map(async ([checkoutId, top]) => { dirty.set(checkoutId, await dirtyFiles(top)) }))

  const entries = new Map<string, ThreadDirtyWrites>()
  for (const write of writes) {
    const files = dirty.get(write.checkoutId)
    if (!files || !files.has(write.file)) continue
    const key = `${write.threadId}\n${write.checkoutId}`
    let entry = entries.get(key)
    if (!entry) { entry = { conversationId: write.threadId, title: titles.get(write.threadId) ?? '', checkoutId: write.checkoutId, files: [] }; entries.set(key, entry) }
    if (!entry.files.includes(write.file)) entry.files.push(write.file)
  }
  return findCollisions(threadId, [...entries.values()])
}

/** The canonical root of the checkout holding `path`, or null when it is no git checkout (or gone). */
async function checkoutTop(path: string): Promise<string | null> {
  try {
    const top = (await execGit(path, ['rev-parse', '--show-toplevel'], { timeout: 10_000 })).stdout.trim()
    return top ? canonicalPath(top) : null
  } catch { return null }
}

/** A place's written file relative to its checkout root with forward slashes, or null when it falls outside. */
function insideCheckout(top: string, placePath: string, file: string): string | null {
  let base: string
  try { base = canonicalPath(placePath) } catch { return null }
  const rel = relative(top, join(base, file))
  if (!rel || rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) return null
  return rel.split(sep).join('/')
}

/** The checkout's changed and untracked files, relative to its root; null when git fails (nothing collides then). */
async function dirtyFiles(top: string): Promise<Set<string> | null> {
  try {
    const { stdout } = await execGit(top, ['status', '--porcelain', '-z', '--no-renames', '--untracked-files=all'], { timeout: 15_000 })
    const files = new Set<string>()
    for (const record of stdout.split(NUL)) {
      if (record.length < 4) continue
      files.add(record.slice(3).replace(/\/+$/, ''))
    }
    return files
  } catch { return null }
}
