import { open, readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'
import type { SessionMetadata } from './types'
import { emptyTally, foldLines, readSoFar, remember, sessionMetadata, snapshotOf, type SessionFileInfo, type Tally } from './claudeProvider'

/**
 * /resume's session list without blocking the main process (OXE-157). The synchronous list read every Claude transcript
 * of the project in one go on the main thread: 320 MB froze the window for 0.6–0.75 s. Here each file is read in 1 MB
 * async reads; the event loop runs between them, and the main thread only searches each chunk for usage lines (a few
 * ms). Reads share the per-file cache with the synchronous reader (claudeProvider), so the context chip that follows
 * reads only what was appended. Loaded on the first list.
 */
const CHUNK = 1024 * 1024
const NEWLINE = 0x0a
const PREVIEW_BYTES = 65536
const PREVIEW_MAX = 80

/** One read per file at a time: lists opened together (several panels ask on start) wait for the same read. */
const reading = new Map<string, Promise<Tally>>()

export function readTranscriptAsync(filePath: string): Promise<Tally> {
  let pending = reading.get(filePath)
  if (!pending) {
    pending = readAppended(filePath).finally(() => reading.delete(filePath))
    reading.set(filePath, pending)
  }
  return pending
}

async function readAppended(filePath: string): Promise<Tally> {
  const handle = await open(filePath, 'r')
  try {
    const { size } = await handle.stat()
    const known = readSoFar(filePath)
    // A file that got shorter (rewritten) is read again from the start.
    const from = known && size >= known.size ? known : undefined
    let position = from?.size ?? 0
    let carry = from?.carry ?? Buffer.alloc(0)
    const tally = from ? { ...from.tally } : emptyTally()
    let work = Buffer.alloc(0)
    while (position < size) {
      const want = Math.min(CHUNK, size - position)
      if (work.length < carry.length + want) work = Buffer.allocUnsafe(carry.length + CHUNK)
      carry.copy(work, 0)
      const { bytesRead } = await handle.read(work, carry.length, want, position)
      if (bytesRead <= 0) break
      position += bytesRead
      const bytes = work.subarray(0, carry.length + bytesRead)
      const lastNewline = bytes.lastIndexOf(NEWLINE)
      if (lastNewline < 0) { carry = Buffer.from(bytes); continue }
      foldLines(tally, bytes, lastNewline)
      carry = Buffer.from(bytes.subarray(lastNewline + 1))
    }
    // The context chip's synchronous read may have gone further meanwhile: keep the furthest read.
    const now = readSoFar(filePath)
    if (now && now !== from && now.size >= position) return remember(filePath, now)
    return remember(filePath, { size: position, carry, tally })
  } finally {
    await handle.close()
  }
}

/** The sessions of a Claude project folder, newest first, as ClaudeUsageProvider.listSessions plus each first message. */
export async function listClaudeSessions(projectDir: string, onPartial?: (sessions: SessionMetadata[]) => void): Promise<SessionMetadata[]> {
  const sessions: SessionMetadata[] = []
  for (const file of await listSessionFiles(projectDir)) {
    let tally: Tally
    try { tally = await readTranscriptAsync(file.fullPath) } catch { continue }
    const firstMessagePreview = await readFirstMessagePreview(file.fullPath)
    sessions.push({ ...sessionMetadata(file, snapshotOf(tally, file.sessionId, file.mtimeMs, file.birthtimeMs)), firstMessagePreview })
    onPartial?.(sessions.slice())
  }
  return sessions
}

async function listSessionFiles(projectDir: string): Promise<SessionFileInfo[]> {
  let names: string[]
  try { names = await readdir(projectDir) } catch { return [] }
  const files = await Promise.all(names.filter(name => name.endsWith('.jsonl')).map(async (name): Promise<SessionFileInfo | null> => {
    const fullPath = join(projectDir, name)
    try {
      const info = await stat(fullPath)
      return { fullPath, sessionId: name.replace(/\.jsonl$/, ''), mtimeMs: info.mtimeMs, birthtimeMs: info.birthtimeMs || info.ctimeMs }
    } catch {
      return null
    }
  }))
  return files.filter((file): file is SessionFileInfo => file !== null).sort((a, b) => b.mtimeMs - a.mtimeMs)
}

/**
 * A short preview of the first user message: only the first 64 KB are read (transcripts often open with a large
 * system entry). Null when the file is missing, malformed, or has no user message.
 */
export async function readFirstMessagePreview(filePath: string): Promise<string | null> {
  try {
    const handle = await open(filePath, 'r')
    let head: string
    try {
      const bytes = Buffer.alloc(PREVIEW_BYTES)
      const { bytesRead } = await handle.read(bytes, 0, bytes.length, 0)
      head = bytes.toString('utf8', 0, bytesRead)
    } finally {
      await handle.close()
    }
    for (const line of head.split('\n')) {
      if (!line.trim()) continue
      let entry: { type?: string; role?: string; message?: { role?: string; content?: unknown } }
      try { entry = JSON.parse(line) } catch { continue }
      const role = entry.role ?? entry.message?.role
      if (entry.type === 'system' || role === 'system' || role !== 'user') continue
      const text = extractTextContent(entry.message?.content)
      if (!text) continue
      return text.length > PREVIEW_MAX ? `${text.slice(0, PREVIEW_MAX - 1)}…` : text
    }
    return null
  } catch {
    return null
  }
}

function extractTextContent(content: unknown): string {
  if (typeof content === 'string') return content.trim()
  if (Array.isArray(content)) {
    for (const item of content) {
      if (typeof item === 'string') return item.trim()
      if (item && typeof item === 'object') {
        const text = (item as { text?: unknown }).text
        if (typeof text === 'string') return text.trim()
      }
    }
  }
  return ''
}
