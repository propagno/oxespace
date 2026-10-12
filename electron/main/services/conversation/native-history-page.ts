import { open } from 'node:fs/promises'
import { createHash } from 'node:crypto'

/** Server-owned byte cursor. No filesystem path or public text crosses the IPC boundary. */
export interface NativeHistoryCursor {
  before: number
  size: number
  identity: string
  skipSuffix?: boolean
  fingerprint?: string
  modifiedAt?: number
  claudeLineage?: 'linked' | 'legacy'
  claudeParent?: string
}

const BLOCK = 64 * 1024
const MAX_LINE = 2 * 1024 * 1024
const PAGE_IO = 8 * 1024 * 1024
const PAGE_PAYLOAD = 2 * 1024 * 1024

/** Reverse JSONL reader with a bounded working set, including giant single-line tool results. */
export async function readNativeHistoryPage<T>(path: string, accept: (value: Record<string, unknown>, offset: number) => T | undefined,
  cursor?: NativeHistoryCursor, limit = 250, signal?: AbortSignal): Promise<{ items: T[]; cursor?: NativeHistoryCursor; bytesRead: number }> {
  if (!Number.isInteger(limit) || limit < 1 || limit > 1000) throw Error('Invalid native history page size')
  const file = await open(path, 'r')
  try {
    const stats = await file.stat()
    const identity = `${stats.dev}:${stats.ino}:${stats.birthtimeMs}`
    if (cursor && (cursor.identity !== identity || stats.size < cursor.size || !Number.isSafeInteger(cursor.before) || cursor.before < 0 || cursor.before > cursor.size)) throw Error('Native history changed; reopen the session history before loading earlier messages')
    const size = cursor?.size ?? stats.size
    const digest = createHash('sha256')
    for (const start of [0, Math.max(0, size - BLOCK)]) {
      const sample = Buffer.alloc(Math.min(BLOCK, size - start))
      const read = await file.read(sample, 0, sample.length, start)
      if (read.bytesRead !== sample.length) throw Error('Native history changed while reading')
      digest.update(sample)
    }
    const fingerprint = digest.digest('hex')
    if (cursor && (cursor.fingerprint && cursor.fingerprint !== fingerprint || cursor.modifiedAt !== undefined && stats.size === size && cursor.modifiedAt !== stats.mtimeMs)) throw Error('Native history changed; reopen the session history before loading earlier messages')
    let position = cursor?.before ?? size, bytesRead = 0, pending = Buffer.alloc(0), skipping = cursor?.skipSuffix ?? false
    const items: T[] = []
    let retainedBytes = 2
    const next = (before: number, skipSuffix = false) => before > 0 ? { before, size, identity, fingerprint, modifiedAt: stats.mtimeMs, ...(skipSuffix ? { skipSuffix: true } : {}) } : undefined
    const consume = (bytes: Buffer, offset: number) => {
      if (!bytes.length || bytes.length > MAX_LINE) return true
      let value: unknown
      try { value = JSON.parse(bytes.toString('utf8')) } catch { return true }
      if (!value || typeof value !== 'object' || Array.isArray(value)) return true
      const item = accept(value as Record<string, unknown>, offset)
      if (item !== undefined) {
        const bytes = Buffer.byteLength(JSON.stringify(item)) + 1
        if (items.length && retainedBytes + bytes > PAGE_PAYLOAD) return false
        retainedBytes += bytes
        items.push(item)
      }
      return true
    }
    while (position > 0 && bytesRead < PAGE_IO) {
      signal?.throwIfAborted()
      const start = Math.max(0, position - BLOCK)
      const buffer = Buffer.allocUnsafe(position - start)
      const read = await file.read(buffer, 0, buffer.length, start)
      if (read.bytesRead !== buffer.length) throw Error('Native history changed while reading')
      bytesRead += read.bytesRead
      let end = buffer.length
      for (let index = buffer.lastIndexOf(10); index >= 0; index = buffer.lastIndexOf(10, index - 1)) {
        const suffix = buffer.subarray(index + 1, end)
        if (!skipping && suffix.length + pending.length <= MAX_LINE && !consume(pending.length ? Buffer.concat([suffix, pending]) : suffix, start + index + 1)) {
          return { items: items.reverse(), cursor: next(start + index + 1 + suffix.length + pending.length), bytesRead }
        }
        pending = Buffer.alloc(0); skipping = false; end = index
        if (items.length >= limit) return { items: items.reverse(), cursor: next(start + index + 1), bytesRead }
        if (index === 0) break
      }
      if (!skipping) {
        if (end + pending.length > MAX_LINE) { pending = Buffer.alloc(0); skipping = true }
        else pending = Buffer.concat([buffer.subarray(0, end), pending])
      }
      position = start
    }
    if (position === 0) {
      if (!skipping && !consume(pending, 0)) return { items: items.reverse(), cursor: next(pending.length), bytesRead }
      return { items: items.reverse(), bytesRead }
    }
    // Re-read at most one bounded partial line. Oversized lines advance by bytes
    // and retain their skip state, so a page with no messages still makes progress.
    return { items: items.reverse(), cursor: next(position + pending.length, skipping), bytesRead }
  } finally { await file.close() }
}
