import type { ConversationThread, ThreadEvent } from '../../../shared/types/thread'
import { parseProjectPath, splitPosition } from '../../lib/projectPath'
import { threadWorkingRoot } from './threadChanges'

/**
 * T70 · where an inline code path in the agent's text points (F33 §3). The agent writes a path relative to the
 * folder it worked in, which is not always the project root: a file written in a subfolder or in a worktree opened
 * from the project root and was "missing". The path is looked for, in order:
 *   1. an absolute path, as is;
 *   2. the turn's working directory, when its events name one;
 *   3. the checkout the conversation works in (`threadWorkingRoot`: the worktree it moved into);
 *   4. the conversation's project root.
 * The first place that has the file opens. Sibling worktrees and a picker for several matches are T71 (1.5.0).
 */

/** A place a path may be, and how the editor reaches it: a root main accepts plus the path below it. */
export interface InlinePathPlace {
  /** Where the file would be, with "/" separators: what a not-found message names. */
  fullPath: string
  /** The root it opens from (the working checkout or the project root), or null when it is under neither. */
  root: string | null
  relativePath: string
}

export interface InlinePathContext {
  /** The turn's working directory, when known. */
  cwd?: string
  thread: Pick<ConversationThread, 'rootPath' | 'observedLocation'>
}

const slashes = (path: string): string => path.replace(/\\/g, '/')
const trimEnd = (path: string): string => slashes(path).replace(/(?<=.)\/+$/, '')
const isAbsolute = (path: string): boolean => /^(?:[a-z]:)?\//i.test(path) || path.startsWith('//')
const comparable = (path: string): string => /^[a-z]:\//i.test(path) || path.startsWith('//') ? path.toLowerCase() : path

/** The working directory a turn's events name: its last request with one (an approval's `cwd`). */
export function turnWorkingDirectory(events: readonly ThreadEvent[]): string | undefined {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]
    if (event.type === 'request' && event.request.cwd?.trim()) return event.request.cwd.trim()
  }
  return undefined
}

/** The roots the editor may open from, most specific first: the working checkout, then the project root. */
export function inlinePathRoots(thread: InlinePathContext['thread']): string[] {
  return unique([threadWorkingRoot(thread), thread.rootPath])
}

function unique(paths: Array<string | undefined>): string[] {
  const seen = new Set<string>(), out: string[] = []
  for (const path of paths) {
    if (!path?.trim()) continue
    const clean = trimEnd(path.trim())
    if (seen.has(comparable(clean))) continue
    seen.add(comparable(clean))
    out.push(clean)
  }
  return out
}

/** The places `text` may name, in the order they are tried. Empty when it is not a path at all. */
export function inlinePathPlaces(text: string, context: InlinePathContext): InlinePathPlace[] {
  const split = splitPosition(text.trim())
  if (!split) return []
  const path = slashes(split.path)
  const roots = inlinePathRoots(context.thread)
  const fulls = isAbsolute(path)
    ? [path]
    : unique([context.cwd, threadWorkingRoot(context.thread), context.thread.rootPath]).map(folder => `${folder.replace(/\/$/, '')}/${path.replace(/^\.\//, '')}`)
  const places: InlinePathPlace[] = []
  for (const full of fulls) {
    const root = roots.find(candidate => parseProjectPath(full, candidate)) ?? null
    const parsed = root ? parseProjectPath(full, root) : null
    const place = root && parsed ? { fullPath: `${root}/${parsed.relativePath}`, root, relativePath: parsed.relativePath } : { fullPath: full, root: null, relativePath: '' }
    if (!places.some(found => comparable(found.fullPath) === comparable(place.fullPath))) places.push(place)
  }
  return places
}

export type InlinePathResolution = { found: InlinePathPlace & { root: string } } | { looked: string[] }

/**
 * The first place that has the file, or every place looked in. `exists` asks main; a place outside both roots
 * can't be opened, so it is only named.
 */
export async function resolveInlinePath(text: string, context: InlinePathContext, exists: (place: InlinePathPlace & { root: string }) => Promise<boolean>): Promise<InlinePathResolution> {
  const places = inlinePathPlaces(text, context)
  for (const place of places) {
    if (place.root === null) continue
    const openable = place as InlinePathPlace & { root: string }
    if (await exists(openable).catch(() => false)) return { found: openable }
  }
  return { looked: places.map(place => place.fullPath) }
}

/** Whether a file is at `place`, from its folder's listing (the same root checks as opening it). */
export async function inlinePathExists(workspaceId: string, place: { root: string; relativePath: string }): Promise<boolean> {
  const list = window.oxe?.fs?.listTree
  if (!list) return false
  const parent = place.relativePath.includes('/') ? place.relativePath.slice(0, place.relativePath.lastIndexOf('/')) : undefined
  const nodes = await list({ workspaceId, rootPath: place.root, ...(parent ? { relativePath: parent } : {}) })
  // Windows drive and UNC roots name files without case; POSIX ones with it.
  const caseless = comparable(place.root) !== place.root || /^[a-z]:\//i.test(place.root)
  const key = (path: string): string => caseless ? slashes(path).toLowerCase() : slashes(path)
  return nodes.some(node => node.type === 'file' && key(node.relativePath) === key(place.relativePath))
}
