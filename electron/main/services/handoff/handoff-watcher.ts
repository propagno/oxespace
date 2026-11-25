import { createHash, randomUUID } from 'node:crypto'
import { watch, type FSWatcher } from 'node:fs'
import { readFile, realpath, stat } from 'node:fs/promises'
import { basename, dirname, normalize, relative, resolve, sep } from 'node:path'
import type { HandoffInboundNotice, HandoffNoticeOrigin } from '../../../../shared/types/handoff-notice'
import { safeJoin } from '../../utils/safe-join'

export interface WatchHandoffFileInput {
  consumerPaneId: string
  rootPath: string
  relativePath: string
  origin: HandoffNoticeOrigin
  debounceMs?: number
}

export interface HandoffWatchHandle {
  watchId: string
  filePath: string
  relativePath: string
  stop: () => void
}

export interface PartnerPaneLinkInput {
  consumerPaneId: string
  partnerPaneId: string
  originLabel: string
  originProvider?: string | null
  filePath?: string | null
  relativePath?: string | null
}

export interface PeerReplyInput {
  fromPaneId: string
  fromProvider?: string | null
  fromLabel?: string
  consumerPaneId?: string
  filePath?: string | null
  relativePath?: string | null
  summary?: string | null
}

interface WatchRecord {
  watchId: string
  consumerPaneId: string
  canonicalRoot: string
  filePath: string
  relativePath: string
  targetName: string
  origin: HandoffNoticeOrigin
  debounceMs: number
  watcher: FSWatcher
  timer: ReturnType<typeof setTimeout> | null
  lastHash: string | null
  lastMtimeMs: number | null
  lastSize: number | null
  onNotice?: (notice: HandoffInboundNotice) => void
}

interface PartnerLink {
  id: string
  consumerPaneId: string
  partnerPaneId: string
  originLabel: string
  originProvider: string | null
  filePath: string | null
  relativePath: string | null
}

const DEFAULT_DEBOUNCE_MS = 80
const MAX_WATCHED_FILE_BYTES = 2 * 1024 * 1024
const MAX_NOTICES_PER_PANE = 50

function isInsideCanonical(root: string, target: string): boolean {
  const nr = normalize(root)
  const nt = normalize(target)
  const cmpRoot = process.platform === 'win32' ? nr.toLowerCase() : nr
  const cmpTarget = process.platform === 'win32' ? nt.toLowerCase() : nt
  const prefix = cmpRoot.endsWith(sep) ? cmpRoot : `${cmpRoot}${sep}`
  return cmpTarget === cmpRoot || cmpTarget.startsWith(prefix)
}

function sameFileName(a: string, b: string): boolean {
  return process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b
}

function normalizeRelative(value: string): string {
  return value.replaceAll('\\', '/').replace(/^\.\//, '')
}

async function readFingerprint(filePath: string, canonicalRoot: string): Promise<{ hash: string; mtimeMs: number; size: number } | null> {
  try {
    const canonical = await realpath(filePath)
    if (!isInsideCanonical(canonicalRoot, canonical)) return null
    const info = await stat(canonical)
    if (!info.isFile() || info.size > MAX_WATCHED_FILE_BYTES) return null
    const content = await readFile(canonical)
    const hash = createHash('sha256').update(content).digest('hex')
    return { hash, mtimeMs: info.mtimeMs, size: info.size }
  } catch {
    return null
  }
}

/**
 * OXE-298 (CA-1): Watches handoff files and partner panes and emits passive
 * inbound notices (`stealFocus: false`) to consumer panes.
 *
 * Watches the file's parent directory so atomic saves (`write tmp` + `rename`)
 * never drop the watch, debounces rapid OS event bursts, and deduplicates by
 * content SHA-256 + mtime/size so duplicate notifications are suppressed.
 */
export class HandoffNoticeWatcher {
  private readonly watches = new Map<string, WatchRecord>()
  private readonly links = new Map<string, PartnerLink>()
  private readonly noticesByPane = new Map<string, HandoffInboundNotice[]>()
  private readonly listeners = new Set<(notice: HandoffInboundNotice) => void>()
  private readonly lastReplyKey = new Map<string, { fingerprint: string; at: number }>()

  subscribe(listener: (notice: HandoffInboundNotice) => void): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  listNotices(consumerPaneId: string): HandoffInboundNotice[] {
    return [...(this.noticesByPane.get(consumerPaneId) ?? [])]
  }

  clearNotices(consumerPaneId: string): void {
    this.noticesByPane.delete(consumerPaneId)
  }

  async watchFile(
    input: WatchHandoffFileInput,
    onNotice?: (notice: HandoffInboundNotice) => void
  ): Promise<HandoffWatchHandle> {
    const canonicalRoot = await realpath(resolve(input.rootPath))
    const filePath = safeJoin(canonicalRoot, input.relativePath)
    const parentDir = dirname(filePath)
    const canonicalParent = await realpath(parentDir)
    if (!isInsideCanonical(canonicalRoot, canonicalParent)) {
      throw new Error('Watched handoff file escapes workspace root')
    }

    const relPath = normalizeRelative(relative(canonicalRoot, filePath))
    const initial = await readFingerprint(filePath, canonicalRoot)
    const watchId = randomUUID()
    const targetName = basename(filePath)
    const debounceMs = Math.max(10, input.debounceMs ?? DEFAULT_DEBOUNCE_MS)

    const watcher = watch(canonicalParent, (_eventType, filename) => {
      // filename may be null on some platforms; when present, filter to the watched file.
      if (filename && !sameFileName(String(filename), targetName)) return
      const entry = this.watches.get(watchId)
      if (!entry) return
      if (entry.timer) clearTimeout(entry.timer)
      entry.timer = setTimeout(() => {
        entry.timer = null
        void this.checkWatchedFile(watchId)
      }, entry.debounceMs)
    })

    const record: WatchRecord = {
      watchId,
      consumerPaneId: input.consumerPaneId,
      canonicalRoot,
      filePath,
      relativePath: relPath,
      targetName,
      origin: input.origin,
      debounceMs,
      watcher,
      timer: null,
      lastHash: initial?.hash ?? null,
      lastMtimeMs: initial?.mtimeMs ?? null,
      lastSize: initial?.size ?? null,
      onNotice
    }
    this.watches.set(watchId, record)
    return { watchId, filePath, relativePath: relPath, stop: () => this.unwatch(watchId) }
  }

  unwatch(watchId: string): void {
    const entry = this.watches.get(watchId)
    if (!entry) return
    if (entry.timer) clearTimeout(entry.timer)
    entry.watcher.close()
    this.watches.delete(watchId)
  }

  linkPartnerPane(input: PartnerPaneLinkInput): () => void {
    const id = randomUUID()
    this.links.set(id, {
      id,
      consumerPaneId: input.consumerPaneId,
      partnerPaneId: input.partnerPaneId,
      originLabel: input.originLabel,
      originProvider: input.originProvider ?? null,
      filePath: input.filePath ?? null,
      relativePath: input.relativePath ?? null
    })
    return () => { this.links.delete(id) }
  }

  notifyPeerReply(input: PeerReplyInput): HandoffInboundNotice[] {
    const matchingLinks = [...this.links.values()].filter(link =>
      link.partnerPaneId === input.fromPaneId &&
      (!input.consumerPaneId || link.consumerPaneId === input.consumerPaneId)
    )
    const targets: Array<{
      consumerPaneId: string
      originLabel: string
      originProvider: string | null
      filePath: string | null
      relativePath: string | null
    }> = matchingLinks.length > 0
      ? matchingLinks.map(link => ({
        consumerPaneId: link.consumerPaneId,
        originLabel: input.fromLabel || link.originLabel,
        originProvider: input.fromProvider ?? link.originProvider,
        filePath: input.filePath ?? link.filePath,
        relativePath: input.relativePath ?? link.relativePath
      }))
      : input.consumerPaneId
        ? [{
          consumerPaneId: input.consumerPaneId,
          originLabel: input.fromLabel || input.fromPaneId,
          originProvider: input.fromProvider ?? null,
          filePath: input.filePath ?? null,
          relativePath: input.relativePath ?? null
        }]
        : []

    const emitted: HandoffInboundNotice[] = []
    const now = Date.now()
    for (const target of targets) {
      if (target.consumerPaneId === input.fromPaneId) continue
      const summary = input.summary?.trim() || null
      const dedupKey = `${target.consumerPaneId}|${input.fromPaneId}`
      const fingerprint = createHash('sha256')
        .update(`${target.relativePath ?? target.filePath ?? ''}|${summary ?? ''}`)
        .digest('hex')
      const previous = this.lastReplyKey.get(dedupKey)
      if (previous && previous.fingerprint === fingerprint && now - previous.at < 250) {
        continue
      }
      this.lastReplyKey.set(dedupKey, { fingerprint, at: now })

      const notice: HandoffInboundNotice = {
        id: randomUUID(),
        consumerPaneId: target.consumerPaneId,
        kind: 'peer-reply',
        origin: {
          paneId: input.fromPaneId,
          provider: target.originProvider,
          label: target.originLabel
        },
        filePath: target.filePath,
        relativePath: target.relativePath,
        contentHash: fingerprint,
        mtimeMs: null,
        summary,
        stealFocus: false,
        timestampUtc: new Date(now).toISOString()
      }
      this.emitNotice(notice)
      emitted.push(notice)
    }
    return emitted
  }

  dispose(): void {
    for (const watchId of [...this.watches.keys()]) this.unwatch(watchId)
    this.links.clear()
    this.listeners.clear()
    this.lastReplyKey.clear()
  }

  private async checkWatchedFile(watchId: string): Promise<void> {
    const entry = this.watches.get(watchId)
    if (!entry) return
    const current = await readFingerprint(entry.filePath, entry.canonicalRoot)
    if (!current) return
    // Dedup atomic-save bursts and identical rewrites by content hash and mtime+size.
    if (current.hash === entry.lastHash) {
      entry.lastMtimeMs = current.mtimeMs
      entry.lastSize = current.size
      return
    }
    if (entry.lastMtimeMs === current.mtimeMs && entry.lastSize === current.size && entry.lastHash === current.hash) {
      return
    }
    entry.lastHash = current.hash
    entry.lastMtimeMs = current.mtimeMs
    entry.lastSize = current.size

    const notice: HandoffInboundNotice = {
      id: randomUUID(),
      consumerPaneId: entry.consumerPaneId,
      kind: 'file-changed',
      origin: entry.origin,
      filePath: entry.filePath,
      relativePath: entry.relativePath,
      contentHash: current.hash,
      mtimeMs: current.mtimeMs,
      summary: null,
      stealFocus: false,
      timestampUtc: new Date().toISOString()
    }
    this.emitNotice(notice, entry.onNotice)
  }

  private emitNotice(notice: HandoffInboundNotice, direct?: (notice: HandoffInboundNotice) => void): void {
    const list = this.noticesByPane.get(notice.consumerPaneId) ?? []
    list.unshift(notice)
    if (list.length > MAX_NOTICES_PER_PANE) list.length = MAX_NOTICES_PER_PANE
    this.noticesByPane.set(notice.consumerPaneId, list)
    try { direct?.(notice) } catch { /* listener error never breaks watcher */ }
    for (const listener of this.listeners) {
      try { listener(notice) } catch { /* listener error never breaks watcher */ }
    }
  }
}
