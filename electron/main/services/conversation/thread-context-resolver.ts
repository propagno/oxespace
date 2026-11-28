/**
 * Turns `@path` mentions and context directives (`@changes`, `@terminal`, `@folder:...`, `@thread:...`)
 * in a prompt into attached bounded context.
 *
 * Mentioning a file or context source in the composer is a request to show it to the agent. The
 * provider CLIs do not expand mentions in their headless modes, so the agent would otherwise spend
 * tool calls (or guess) to read it. Only regular text files and directories inside the project are
 * read through the Windows-aware workspace check, with per-item and total budgets; everything else
 * in the prompt is left exactly as typed.
 */
import { realpathSync } from 'node:fs'
import { lstat, open, readdir, realpath } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import type { AppDatabase } from '../../db'
import type { ThreadPane } from '../../../../shared/types/thread-places'
import { checkWorkspacePath } from './path-safety'
import type { ThreadSideTerminalHost } from './side-chat-context'
import {
  MAX_CHANGES_BYTES,
  MAX_TERMINAL_BYTES,
  MAX_THREAD_REF_BYTES,
  resolveGitChangesContext,
  resolveTerminalContext,
  resolveThreadReferenceContext
} from './thread-context-sources'

export const MAX_FILES = 8
export const MAX_FILE_BYTES = 16 * 1024
export const MAX_TOTAL_BYTES = 48 * 1024
export const MAX_FOLDERS = 4
export const MAX_FOLDER_DEPTH = 3
export const MAX_FOLDER_ENTRIES = 120
export const MAX_FOLDER_BYTES = 8 * 1024
export const MAX_TERMINAL_REFS = 2
export const MAX_THREAD_REFS = 4

const EXCLUDED_FOLDER_NAMES = new Set(['node_modules', '.git', 'dist', 'out', 'coverage', '.next', 'build'])

export interface AttachedContextFile {
  path: string
  bytes: number
  truncated?: boolean
}

export interface MentionContext {
  /** Text to append after the prompt; empty when nothing was attached. */
  block: string
  files: AttachedContextFile[]
}

export interface MentionContextOptions {
  threadId?: string
  db?: AppDatabase
  terminal?: ThreadSideTerminalHost
  listThreadPanes?: () => Promise<ThreadPane[]>
  isAllowedPane?: (paneId: string) => boolean
}

export interface ContextDirectives {
  files: string[]
  folders: string[]
  changes: boolean
  terminals: Array<{ paneId?: string }>
  threads: string[]
}

/** `@path` tokens: start of text or after whitespace, then a path without spaces (with dot extension) or quoted path. */
const FILE_MENTION = /(?:^|\s)@(?:(?:"([^"\r\n]+)")|((?:[\w.-]+[\\/])*[\w.-]+\.[\w-]+))(?=$|[\s,;:!?)\]])/g
const FOLDER_MENTION = /(?:^|\s)@folder:(?:"([^"\r\n]+)"|([^\s,;:!?)\]]+))(?=$|[\s,;:!?)\]])/g
const CHANGES_MENTION = /(?:^|\s)@changes(?=$|[\s,;:!?)\]])/
const TERMINAL_MENTION = /(?:^|\s)@terminal(?::([A-Za-z0-9_.:/-]+))?(?=$|[\s,;:!?)\]])/g
const THREAD_MENTION = /(?:^|\s)@thread:([A-Za-z0-9_.:/-]+)(?=$|[\s,;:!?)\]])/g

const normalizeMentionPath = (raw: string): string =>
  raw.trim().replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+$/, '')

export function findMentions(text: string): string[] {
  const seen = new Set<string>()
  for (const match of text.matchAll(FILE_MENTION)) {
    const raw = match[1] ?? match[2] ?? ''
    if (!raw || raw.startsWith('folder:') || raw.startsWith('thread:') || raw.startsWith('terminal:')) continue
    const path = normalizeMentionPath(raw)
    if (path && !seen.has(path)) seen.add(path)
  }
  return [...seen]
}

export function findContextDirectives(text: string): ContextDirectives {
  const files = findMentions(text)

  const folders: string[] = []
  const seenFolders = new Set<string>()
  for (const match of text.matchAll(FOLDER_MENTION)) {
    const raw = match[1] ?? match[2] ?? ''
    const cleaned = raw.trim() === '.' || raw.trim() === './' ? '.' : normalizeMentionPath(raw)
    if (cleaned && !seenFolders.has(cleaned)) {
      seenFolders.add(cleaned)
      folders.push(cleaned)
    }
  }

  const changes = CHANGES_MENTION.test(text)

  const terminals: Array<{ paneId?: string }> = []
  const seenTerminals = new Set<string>()
  for (const match of text.matchAll(TERMINAL_MENTION)) {
    const paneId = match[1]?.trim() || undefined
    const key = paneId ?? '__active__'
    if (!seenTerminals.has(key)) {
      seenTerminals.add(key)
      terminals.push(paneId ? { paneId } : {})
    }
  }

  const threads: string[] = []
  const seenThreads = new Set<string>()
  for (const match of text.matchAll(THREAD_MENTION)) {
    const id = match[1]?.trim()
    if (id && !seenThreads.has(id)) {
      seenThreads.add(id)
      threads.push(id)
    }
  }

  return { files, folders, changes, terminals, threads }
}

async function readHead(path: string, limit: number): Promise<{ data: Buffer; size: number }> {
  const handle = await open(path, 'r')
  try {
    const { size } = await handle.stat()
    const length = Math.min(size, limit)
    const data = Buffer.alloc(length)
    const { bytesRead } = await handle.read(data, 0, length, 0)
    return { data: data.subarray(0, bytesRead), size }
  } finally { await handle.close() }
}

const escapeAttr = (value: string): string => value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')

const nativeRealpath = (path: string): string => {
  try { return realpathSync.native(path) } catch { return path }
}

/**
 * Resolves a bounded directory tree summary inside `root` for `@folder:<path>`.
 * Symlinks/junctions are validated through `checkWorkspacePath` and never traversed outside the workspace.
 */
export async function resolveFolderTree(
  root: string,
  relPath: string,
  maxBytes = MAX_FOLDER_BYTES
): Promise<{ path: string; block: string; bytes: number; truncated: boolean } | null> {
  const target = relPath === '.' ? '.' : relPath
  const verdict = checkWorkspacePath(root, target, { realpath: nativeRealpath })
  if (!verdict.safe) return null

  try {
    const rootStat = await lstat(verdict.resolved)
    if (!rootStat.isDirectory()) return null
  } catch {
    return null
  }

  const lines: string[] = []
  let entriesVisited = 0
  let truncated = false

  const walk = async (dirPath: string, depth: number, indent: string): Promise<void> => {
    let entries
    try {
      entries = await readdir(dirPath, { withFileTypes: true })
    } catch {
      return
    }
    entries.sort((a, b) => {
      const aDir = a.isDirectory() ? 0 : 1
      const bDir = b.isDirectory() ? 0 : 1
      return aDir - bDir || a.name.localeCompare(b.name)
    })

    for (const entry of entries) {
      if (EXCLUDED_FOLDER_NAMES.has(entry.name)) continue
      if (entriesVisited >= MAX_FOLDER_ENTRIES) {
        truncated = true
        return
      }
      const childPath = join(dirPath, entry.name)
      const childVerdict = checkWorkspacePath(root, childPath, { realpath: nativeRealpath })
      if (!childVerdict.safe) continue
      const isDir = entry.isDirectory() && !entry.isSymbolicLink()
      entriesVisited += 1
      lines.push(`${indent}${entry.name}${isDir ? '/' : ''}`)
      if (isDir) {
        if (depth < MAX_FOLDER_DEPTH) {
          await walk(childPath, depth + 1, `${indent}  `)
          if (truncated) return
        } else {
          truncated = true
        }
      }
    }
  }

  await walk(verdict.resolved, 1, '')
  let body = lines.length > 0 ? lines.join('\n') : '(empty directory)'
  if (Buffer.byteLength(body, 'utf8') > maxBytes) {
    const sliced = Buffer.from(body, 'utf8').subarray(0, maxBytes).toString('utf8').replace(/\uFFFD+$/, '')
    body = sliced
    truncated = true
  }
  const bytes = Buffer.byteLength(body, 'utf8')
  const suffix = truncated ? '\n[directory listing truncated]' : ''
  return {
    path: target,
    bytes,
    truncated,
    block: `<attached_folder path="${escapeAttr(target)}"${truncated ? ' truncated="true"' : ''}>\n${body}${suffix}\n</attached_folder>`
  }
}

export async function resolveMentionContext(
  rootPath: string,
  text: string,
  options: MentionContextOptions = {}
): Promise<MentionContext> {
  const directives = findContextDirectives(text)
  const hasAny =
    directives.files.length > 0 ||
    directives.folders.length > 0 ||
    directives.changes ||
    directives.terminals.length > 0 ||
    directives.threads.length > 0
  if (!hasAny) return { block: '', files: [] }

  const root = await realpath(resolve(rootPath)).catch(() => resolve(rootPath))
  const files: AttachedContextFile[] = []
  const fileParts: string[] = []
  const contextParts: string[] = []
  let totalFileBytes = 0

  for (const mention of directives.files.slice(0, MAX_FILES)) {
    const verdict = checkWorkspacePath(root, mention, {
      // Follow links for existing paths so a junction cannot smuggle an outside file in.
      realpath: nativeRealpath
    })
    if (!verdict.safe) continue
    try {
      const stat = await lstat(verdict.resolved)
      if (!stat.isFile()) continue
      const room = Math.min(MAX_FILE_BYTES, MAX_TOTAL_BYTES - totalFileBytes)
      if (room <= 0) break
      const { data, size } = await readHead(verdict.resolved, room)
      // Binary files are not useful as prompt text.
      if (data.includes(0)) continue
      const truncated = size > data.length
      const content = data.toString('utf8')
      totalFileBytes += data.length
      files.push({ path: mention, bytes: data.length, ...(truncated ? { truncated: true } : {}) })
      // Only the head is attached; the agent reads the rest itself if the task needs it.
      fileParts.push(`<attached_file path="${escapeAttr(mention)}"${truncated ? ` truncated="true" total_bytes="${size}" note="First ${data.length} bytes only; read the rest of the file with your tools if you need it."` : ''}>\n${content}\n</attached_file>`)
    } catch { /* Missing or unreadable: the mention stays plain text. */ }
  }

  for (const folder of directives.folders.slice(0, MAX_FOLDERS)) {
    const resolved = await resolveFolderTree(root, folder, MAX_FOLDER_BYTES).catch(() => null)
    if (!resolved) continue
    files.push({ path: `@folder:${resolved.path}`, bytes: resolved.bytes, ...(resolved.truncated ? { truncated: true } : {}) })
    contextParts.push(resolved.block)
  }

  if (directives.changes) {
    const resolved = await resolveGitChangesContext(root, MAX_CHANGES_BYTES).catch(() => null)
    if (resolved) {
      files.push({ path: resolved.label, bytes: resolved.bytes, ...(resolved.truncated ? { truncated: true } : {}) })
      contextParts.push(resolved.block)
    }
  }

  for (const term of directives.terminals.slice(0, MAX_TERMINAL_REFS)) {
    const resolved = await resolveTerminalContext({
      threadId: options.threadId,
      paneId: term.paneId,
      terminal: options.terminal,
      listThreadPanes: options.listThreadPanes,
      isAllowedPane: options.isAllowedPane,
      maxBytes: MAX_TERMINAL_BYTES
    }).catch(() => null)
    if (!resolved) continue
    files.push({ path: resolved.label, bytes: resolved.bytes, ...(resolved.truncated ? { truncated: true } : {}) })
    contextParts.push(resolved.block)
  }

  for (const targetThreadId of directives.threads.slice(0, MAX_THREAD_REFS)) {
    const resolved = resolveThreadReferenceContext({
      db: options.db,
      targetThreadId,
      maxBytes: MAX_THREAD_REF_BYTES
    })
    if (!resolved) continue
    files.push({ path: resolved.label, bytes: resolved.bytes, ...(resolved.truncated ? { truncated: true } : {}) })
    contextParts.push(resolved.block)
  }

  if (!files.length) return { block: '', files: [] }

  const blocks: string[] = []
  if (fileParts.length > 0) {
    blocks.push(`<attached_files note="Files the user mentioned with @, attached by OXESpace.">\n${fileParts.join('\n')}\n</attached_files>`)
  }
  if (contextParts.length > 0) {
    blocks.push(`<attached_context note="Context sources (@changes, @terminal, @folder, @thread) attached by OXESpace.">\n${contextParts.join('\n')}\n</attached_context>`)
  }
  return {
    block: `\n\n${blocks.join('\n\n')}`,
    files
  }
}
