import { constants } from 'node:fs'
import { lstat, open, realpath, stat } from 'node:fs/promises'
import { isAbsolute, join, normalize, parse, posix, sep, win32 } from 'node:path'
import type { ThreadPlace, ThreadPlaceReadResult } from '../../../../shared/types/thread-places'
import { mainMessage, type MessageCode } from '../../../../shared/messages'
import { MainMessageError } from '../../ipc/main-message-error'
import { MAX_TEXT_FILE_BYTES } from '../file-system.service'
import { staysLocal } from '../git-common-dir'

/**
 * F4 A17 (ccr-t71-task-places.md §4.1, SECURITY S2): a read-only view of a file in a place outside the thread's
 * project, only when the place came from tool evidence. There is no write twin and nothing here widens the workspace
 * roots that fs:read-file trusts (FileSystemService and workspaceRootResolver are untouched).
 */
const MAX_RELATIVE = 4096
const NUL = String.fromCharCode(0)
/** Windows device names, in any segment, any case, with or without an extension (COM¹²³ included). */
const RESERVED = /^(con|prn|aux|nul|conin\$|conout\$|clock\$|com[0-9\u00b9\u00b2\u00b3]|lpt[0-9\u00b9\u00b2\u00b3])$/i

const refuse = (code: MessageCode & ('thread.place.outside' | 'thread.place.notEvidence'), text: string): MainMessageError =>
  new MainMessageError(mainMessage(code, {}), text)
const outside = (): MainMessageError => refuse('thread.place.outside', 'This path is outside the place.')

/**
 * The segments of a relative path the person asked for, or a refusal. Checked the same on every platform, so a
 * Windows form typed on another machine is refused too: no UNC or `//server`, no `\\?\` or `\\.\`, no drive (absolute
 * or drive-relative `C:foo`), no `:` at all (alternate data streams), no `..` in any spelling, no device name, no
 * segment ending in a dot or a space (Windows strips them, so they alias another name), and never inside `.git`.
 */
export function placeReadSegments(relativePath: unknown): string[] {
  if (typeof relativePath !== 'string') throw outside()
  if (relativePath.length > MAX_RELATIVE) throw new Error(`A place path has at most ${MAX_RELATIVE} characters`)
  if (!relativePath || relativePath.includes(NUL)) throw outside()
  if (/^[\\/]/.test(relativePath) || relativePath.includes(':')) throw outside()
  if (isAbsolute(relativePath) || posix.isAbsolute(relativePath) || win32.isAbsolute(relativePath)) throw outside()
  const segments = relativePath.split(/[\\/]+/).filter(segment => segment && segment !== '.')
  if (!segments.length) throw outside()
  for (const segment of segments) {
    if (segment === '..' || /^\.{2,}$/.test(segment.trim())) throw outside()
    if (/[\u0000-\u001f<>"|?*]/.test(segment)) throw outside()
    if (/[. ]$/.test(segment)) throw outside()
    const stem = segment.split('.')[0].trimEnd()
    if (RESERVED.test(stem)) throw outside()
    if (segment.toLowerCase() === '.git') throw outside()
  }
  return segments
}

/** Whether any component of `path` (from its root) is a link, a junction included, or cannot be checked. */
async function crossesLink(path: string): Promise<boolean> {
  const full = normalize(path)
  const { root } = parse(full)
  let current = root
  for (const part of full.slice(root.length).split(/[\\/]+/).filter(Boolean)) {
    current = join(current, part)
    try { if ((await lstat(current)).isSymbolicLink()) return true } catch { return true }
  }
  return false
}

const insideOf = (root: string, target: string): boolean => {
  // realpath gives the real casing; never fold case (case-sensitive folders exist on Windows too).
  const base = normalize(root)
  const full = normalize(target)
  const prefix = base.endsWith(sep) ? base : `${base}${sep}`
  return full !== base && full.startsWith(prefix)
}

/** Same rule as fs:read-file: no NUL byte and valid UTF-8. */
function ensureText(buffer: Buffer): void {
  if (buffer.includes(0) || buffer.toString('utf8').includes('\uFFFD')) throw new Error('Binary files are not supported')
}

/**
 * Reads one regular text file under an outside or checkout place, in fs:read-file's shape plus `readOnly: true`.
 * `fromEvidence` is whether the place has at least one written file from tool evidence. Refusals carry
 * thread.place.notEvidence (a root, worktree or location-only place) or thread.place.outside (any path that leaves the
 * place, links included, even to another place of the thread); other failures are plain errors.
 */
export async function readPlaceFile(place: ThreadPlace, fromEvidence: boolean, relativePath: string): Promise<ThreadPlaceReadResult> {
  if ((place.kind !== 'outside' && place.kind !== 'checkout') || !fromEvidence) {
    throw refuse('thread.place.notEvidence', 'This place did not come from what a tool wrote.')
  }
  const segments = placeReadSegments(relativePath)
  const base = place.path
  if (/^[\\/]{2}/.test(base) || !isAbsolute(base) || !staysLocal(base) || await crossesLink(base)) throw outside()
  // The walk below the place: every component is lstat'ed before anything follows it; a link is never crossed.
  let current = base
  for (const segment of segments) {
    current = join(current, segment)
    let entry
    try { entry = await lstat(current) } catch { throw new Error('File not found') }
    if (entry.isSymbolicLink()) throw outside()
  }
  if (!staysLocal(current)) throw outside()
  const [realBase, realTarget] = await Promise.all([realpath(base), realpath(current)])
  if (!insideOf(realBase, realTarget)) throw outside()
  // Regular files only, checked before open so a FIFO or a device never blocks the read.
  const before = await stat(realTarget)
  if (!before.isFile()) throw new Error('Path is not a file')
  if (before.size > MAX_TEXT_FILE_BYTES) throw new Error('File is larger than 2 MB')
  const noFollow = process.platform === 'win32' ? 0 : constants.O_NOFOLLOW ?? 0
  const handle = await open(realTarget, constants.O_RDONLY | noFollow)
  try {
    const opened = await handle.stat()
    if (!opened.isFile() || opened.dev !== before.dev || opened.ino !== before.ino) throw outside()
    if (opened.size > MAX_TEXT_FILE_BYTES) throw new Error('File is larger than 2 MB')
    const buffer = Buffer.alloc(opened.size)
    let read = 0
    while (read < buffer.length) {
      const { bytesRead } = await handle.read(buffer, read, buffer.length - read, read)
      if (!bytesRead) break
      read += bytesRead
    }
    const content = buffer.subarray(0, read)
    ensureText(content)
    return { relativePath: segments.join('/'), content: content.toString('utf8'), size: read, mtimeMs: opened.mtimeMs, readOnly: true }
  } finally {
    await handle.close()
  }
}
