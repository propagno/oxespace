/**
 * B19 · `worktree.include` in oxe.yaml: files from the main checkout (usually gitignored ones such as `.env`) copied
 * into a worktree that was just created.
 *
 * Bounds, all checked here and not trusted from the parser:
 * - a pattern is relative to the repository; absolute paths, drive letters, `..`, `.` and any `.git` segment are
 *   refused by name (C3) and copy nothing;
 * - links are never followed, on either side: a matched link is reported, a directory link is not entered, and the
 *   real path of every source must be inside the repository and of every destination folder inside the worktree;
 * - nested repositories and worktrees (a folder holding `.git`) are not searched, so a worktree kept inside the
 *   repository is never copied from;
 * - at most `INCLUDE_LIMITS.files` files and `INCLUDE_LIMITS.bytes` bytes: above that nothing is copied and the
 *   report says so; the worktree exists either way;
 * - an existing destination is never overwritten (`COPYFILE_EXCL`).
 *
 * Nothing here throws: the worktree is already real when this runs, so every problem becomes a notice.
 */
import { constants, type Dirent } from 'node:fs'
import { copyFile, lstat, mkdir, readdir, realpath } from 'node:fs/promises'
import { join, sep } from 'node:path'
import { MAIN_MESSAGE_PARAM_LIMITS, mainMessage, type MainMessage } from '../../../../shared/messages'

export const INCLUDE_LIMITS = { files: 200, bytes: 50 * 1024 * 1024, entries: 20_000 } as const

export interface WorktreeIncludeReport {
  /** Repo-relative paths (with `/`) copied into the worktree. */
  copied: string[]
  /** What the person should read, in order: refused patterns, limits, the count copied, then skipped files. */
  notices: MainMessage[]
}

type Segment = RegExp | '**'

const DRIVE = /^[a-zA-Z]:/
const GLOB = /[*?]/

/** The pattern's segments, or null when it may not be used (absolute, drive, `..`, `.`, empty or `.git`). */
export function includeSegments(pattern: string): string[] | null {
  let text = pattern.trim().replace(/\\/g, '/')
  if (text.startsWith('/') || DRIVE.test(text)) return null
  if (text.startsWith('./')) text = text.slice(2)
  text = text.replace(/\/+$/, '')
  if (!text) return null
  const segments = text.split('/')
  if (segments.some((s) => s === '' || s === '.' || s === '..' || s.toLowerCase() === '.git')) return null
  return segments
}

function segmentMatcher(segment: string): Segment {
  if (segment === '**') return '**'
  const body = [...segment].map((c) => (c === '*' ? '[^/]*' : c === '?' ? '[^/]' : c.replace(/[.+^${}()|[\]\\]/g, '\\$&'))).join('')
  return new RegExp(`^${body}$`)
}

function matchesAll(pattern: Segment[], path: string[], p = 0, s = 0): boolean {
  if (p === pattern.length) return s === path.length
  const head = pattern[p]
  if (head === '**') return matchesAll(pattern, path, p + 1, s) || (s < path.length && matchesAll(pattern, path, p, s + 1))
  return s < path.length && head.test(path[s]) && matchesAll(pattern, path, p + 1, s + 1)
}

/** Whether some path below `dir` could still match: decides if a folder is worth entering. */
function couldMatchBelow(pattern: Segment[], dir: string[], p = 0, s = 0): boolean {
  if (s === dir.length) return p < pattern.length
  if (p === pattern.length) return false
  const head = pattern[p]
  if (head === '**') return true
  return head.test(dir[s]) && couldMatchBelow(pattern, dir, p + 1, s + 1)
}

function inside(parent: string, child: string): boolean {
  const base = parent.endsWith(sep) ? parent : parent + sep
  return process.platform === 'win32' ? child.toLowerCase().startsWith(base.toLowerCase()) : child.startsWith(base)
}

function same(a: string, b: string): boolean {
  return process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b
}

async function tryLstat(path: string) {
  try { return await lstat(path) } catch { return null }
}

async function tryReaddir(path: string): Promise<Dirent[]> {
  try { return await readdir(path, { withFileTypes: true }) } catch { return [] }
}

/** Caps a list to what a C3 parameter may carry. */
function capped(paths: string[]): string[] {
  const { listLength, textLength } = MAIN_MESSAGE_PARAM_LIMITS
  return paths.slice(0, listLength).map((p) => (p.length > textLength ? `…${p.slice(-(textLength - 1))}` : p))
}

interface Found {
  files: Map<string, { source: string; size: number }>
  links: Set<string>
  entries: number
  tooLarge: boolean
}

/** Adds what one pattern matches under `rootReal`. Directory links are never entered; matched links are recorded. */
async function search(rootReal: string, segments: string[], found: Found): Promise<void> {
  const firstGlob = segments.findIndex((s) => s === '**' || GLOB.test(s))
  const literal = firstGlob < 0 ? segments : segments.slice(0, firstGlob)
  let pattern = segments.map(segmentMatcher)

  const start = join(rootReal, ...literal)
  const startInfo = await tryLstat(start)
  if (literal.length > 0) {
    if (!startInfo) return
    // A literal prefix may run through a link the walk would never enter: its real place must stay in the repository.
    const real = await realpath(start).catch(() => null)
    if (startInfo.isSymbolicLink() || !real || !inside(rootReal, real)) { found.links.add(literal.join('/')); return }
    if (firstGlob < 0) {
      if (startInfo.isFile()) { found.files.set(literal.join('/'), { source: start, size: startInfo.size }); return }
      if (!startInfo.isDirectory()) return
      // A folder named on its own stands for everything under it.
      pattern = [...pattern, '**']
    }
  }

  const stack: string[][] = [literal]
  while (stack.length) {
    const dir = stack.pop()!
    for (const entry of await tryReaddir(join(rootReal, ...dir))) {
      if (++found.entries > INCLUDE_LIMITS.entries) { found.tooLarge = true; return }
      if (entry.name.toLowerCase() === '.git') continue
      const path = [...dir, entry.name]
      const rel = path.join('/')
      if (entry.isSymbolicLink()) {
        if (matchesAll(pattern, path)) found.links.add(rel)
        continue
      }
      if (entry.isDirectory()) {
        if (!couldMatchBelow(pattern, path)) continue
        // Another repository, a submodule or a worktree kept inside this one: not ours to copy from.
        if (await tryLstat(join(rootReal, ...path, '.git'))) continue
        stack.push(path)
      } else if (entry.isFile() && matchesAll(pattern, path) && !found.files.has(rel)) {
        const info = await tryLstat(join(rootReal, ...path))
        if (info?.isFile()) found.files.set(rel, { source: join(rootReal, ...path), size: info.size })
      }
    }
  }
}

/**
 * Creates each folder of `rel`'s parent under `worktreeReal` one level at a time, refusing a level that is a link or
 * whose real place has left the worktree. `null` when the file may not be written there.
 */
async function destinationFolder(worktreeReal: string, parents: string[]): Promise<string | null> {
  let current = worktreeReal
  for (const name of parents) {
    const next = join(current, name)
    const info = await tryLstat(next)
    if (!info) {
      try { await mkdir(next) } catch { if (!(await tryLstat(next))?.isDirectory()) return null }
    } else if (info.isSymbolicLink() || !info.isDirectory()) {
      return null
    }
    const real = await realpath(next).catch(() => null)
    if (!real || !inside(worktreeReal, real)) return null
    current = real
  }
  return current
}

export async function copyIncludedFiles(rootPath: string, worktreePath: string, patterns: readonly string[]): Promise<WorktreeIncludeReport> {
  const report: WorktreeIncludeReport = { copied: [], notices: [] }
  if (patterns.length === 0) return report

  const accepted: string[][] = []
  for (const pattern of patterns) {
    const segments = includeSegments(pattern)
    if (segments) accepted.push(segments)
    else report.notices.push(mainMessage('worktree.include.outsideRepo', { pattern: capped([pattern])[0] }))
  }
  if (accepted.length === 0) return report

  const rootReal = await realpath(rootPath).catch(() => null)
  const worktreeReal = await realpath(worktreePath).catch(() => null)
  if (!rootReal || !worktreeReal || same(rootReal, worktreeReal)) return report

  const found: Found = { files: new Map(), links: new Set(), entries: 0, tooLarge: false }
  for (const segments of accepted) {
    await search(rootReal, segments, found)
    if (found.tooLarge) {
      report.notices.push(mainMessage('worktree.include.searchTooLarge', { limit: INCLUDE_LIMITS.entries }))
      return report
    }
  }

  const bytes = [...found.files.values()].reduce((sum, file) => sum + file.size, 0)
  if (found.files.size > INCLUDE_LIMITS.files || bytes > INCLUDE_LIMITS.bytes) {
    report.notices.push(mainMessage('worktree.include.overLimit', {
      files: found.files.size,
      megabytes: Math.ceil(bytes / (1024 * 1024)),
      maxFiles: INCLUDE_LIMITS.files,
      maxMegabytes: INCLUDE_LIMITS.bytes / (1024 * 1024)
    }))
    return report
  }

  const kept: string[] = []
  const notFollowed: string[] = [...found.links]
  const failed: string[] = []
  for (const [rel, file] of [...found.files].sort(([a], [b]) => a.localeCompare(b))) {
    const real = await realpath(file.source).catch(() => null)
    const info = await tryLstat(file.source)
    if (!real || !info?.isFile() || !inside(rootReal, real)) { notFollowed.push(rel); continue }
    const parts = rel.split('/')
    const folder = await destinationFolder(worktreeReal, parts.slice(0, -1))
    if (!folder) { notFollowed.push(rel); continue }
    const target = join(folder, parts[parts.length - 1])
    if (await tryLstat(target)) { kept.push(rel); continue }
    try {
      await copyFile(real, target, constants.COPYFILE_EXCL)
      report.copied.push(rel)
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code === 'EEXIST') kept.push(rel)
      else failed.push(rel)
    }
  }

  if (report.copied.length) report.notices.push(mainMessage('worktree.include.copied', { count: report.copied.length }))
  if (kept.length) report.notices.push(mainMessage('worktree.include.notOverwritten', { paths: capped(kept) }))
  if (notFollowed.length) report.notices.push(mainMessage('worktree.include.notFollowed', { paths: capped(notFollowed.sort()) }))
  if (failed.length) report.notices.push(mainMessage('worktree.include.failed', { paths: capped(failed) }))
  return report
}
