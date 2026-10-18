/**
 * Turns `@path` mentions in a prompt into attached file content.
 *
 * Mentioning a file in the composer is a request to show it to the agent. The
 * provider CLIs do not expand mentions in their headless modes, so the agent
 * would otherwise spend a tool call (or guess) to read it. Only regular text
 * files inside the project are attached, each read through the Windows-aware
 * workspace check, with per-file and total budgets; everything else in the
 * prompt is left exactly as typed.
 */
import { realpathSync } from 'node:fs'
import { lstat, open, realpath } from 'node:fs/promises'
import { resolve } from 'node:path'
import { checkWorkspacePath } from './path-safety'

export const MAX_FILES = 8
export const MAX_FILE_BYTES = 64 * 1024
export const MAX_TOTAL_BYTES = 256 * 1024

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

/** `@path` tokens: start of text or after whitespace, then a path without spaces. */
const MENTION = /(?:^|\s)@((?:[\w.-]+[\\/])*[\w.-]+\.[\w-]+)(?=$|[\s,;:!?)\]])/g

export function findMentions(text: string): string[] {
  const seen = new Set<string>()
  for (const match of text.matchAll(MENTION)) {
    const path = match[1].replace(/\\/g, '/').replace(/^\.\//, '')
    if (!seen.has(path)) seen.add(path)
  }
  return [...seen]
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

export async function resolveMentionContext(rootPath: string, text: string): Promise<MentionContext> {
  const mentions = findMentions(text).slice(0, MAX_FILES)
  if (!mentions.length) return { block: '', files: [] }
  const root = await realpath(resolve(rootPath)).catch(() => resolve(rootPath))
  const files: AttachedContextFile[] = []
  const parts: string[] = []
  let total = 0
  for (const mention of mentions) {
    const verdict = checkWorkspacePath(root, mention, {
      // Follow links for existing paths so a junction cannot smuggle an outside file in.
      realpath: path => { try { return realpathSync.native(path) } catch { return path } }
    })
    if (!verdict.safe) continue
    try {
      const stat = await lstat(verdict.resolved)
      if (!stat.isFile()) continue
      const room = Math.min(MAX_FILE_BYTES, MAX_TOTAL_BYTES - total)
      if (room <= 0) break
      const { data, size } = await readHead(verdict.resolved, room)
      // Binary files are not useful as prompt text.
      if (data.includes(0)) continue
      const truncated = size > data.length
      const content = data.toString('utf8')
      total += data.length
      files.push({ path: mention, bytes: data.length, ...(truncated ? { truncated: true } : {}) })
      parts.push(`<attached_file path="${escapeAttr(mention)}"${truncated ? ` truncated="true" total_bytes="${size}"` : ''}>\n${content}\n</attached_file>`)
    } catch { /* Missing or unreadable: the mention stays plain text. */ }
  }
  if (!files.length) return { block: '', files: [] }
  return {
    block: `\n\n<attached_files note="Files the user mentioned with @, attached by OXESpace.">\n${parts.join('\n')}\n</attached_files>`,
    files
  }
}
