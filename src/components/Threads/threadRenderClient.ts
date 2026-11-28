import { parseMarkdownHast } from './threadMarkdownParse'
import type { ThreadHastRoot } from './threadRenderCore'

const LRU_MAX_ENTRIES = 300

interface WorkerReply {
  id?: unknown
  tree?: unknown
}

type Listener = (tree: ThreadHastRoot) => void

interface PendingEntry {
  text: string
  listeners: Set<Listener>
}

interface WorkerConstructorWithRegistry {
  new (url: string | URL, options?: WorkerOptions): Worker
  all?: unknown[]
}

const cache = new Map<string, ThreadHastRoot>()
let worker: Worker | null = null
let workerCtor: WorkerConstructorWithRegistry | null = null
let nextRequestId = 1
const pendingById = new Map<number, PendingEntry>()
const inflightIdByText = new Map<string, number>()

function cacheSet(text: string, tree: ThreadHastRoot): void {
  if (cache.has(text)) cache.delete(text)
  cache.set(text, tree)
  while (cache.size > LRU_MAX_ENTRIES) {
    const oldest = cache.keys().next().value
    if (oldest === undefined) break
    cache.delete(oldest)
  }
}

/** Looks up a parsed hast root in the 300-entry LRU cache, refreshing its recency on hit. */
export function getCachedThreadTree(text: string): ThreadHastRoot | undefined {
  const hit = cache.get(text)
  if (!hit) return undefined
  cache.delete(text)
  cache.set(text, hit)
  return hit
}

/** True when the environment supports Web Workers (browser / Electron renderer; false in jsdom unless stubbed). */
export function hasRenderWorker(): boolean {
  return typeof globalThis.Worker === 'function'
}

/** Synchronous main-thread parser used while an answer streams or when no Web Worker exists (tests/jsdom). */
export function parseThreadMarkdownSync(text: string): ThreadHastRoot {
  return parseMarkdownHast(text)
}

function clearPendingWithSyncFallback(): void {
  const entries = Array.from(pendingById.values())
  pendingById.clear()
  inflightIdByText.clear()
  for (const entry of entries) {
    const fallback = parseThreadMarkdownSync(entry.text)
    cacheSet(entry.text, fallback)
    for (const listener of entry.listeners) listener(fallback)
  }
}

function handleMessage(event: MessageEvent<WorkerReply>): void {
  const payload = event.data
  if (!payload || typeof payload.id !== 'number') return
  const entry = pendingById.get(payload.id)
  if (!entry) return
  pendingById.delete(payload.id)
  if (inflightIdByText.get(entry.text) === payload.id) inflightIdByText.delete(entry.text)
  const tree = payload.tree as ThreadHastRoot
  cacheSet(entry.text, tree)
  for (const listener of entry.listeners) listener(tree)
}

function ensureWorker(): Worker | null {
  if (!hasRenderWorker()) {
    worker = null
    workerCtor = null
    return null
  }
  const CurrentCtor = globalThis.Worker as unknown as WorkerConstructorWithRegistry
  const stubReset = worker !== null && Array.isArray(CurrentCtor.all) && !CurrentCtor.all.includes(worker)
  if (worker && (workerCtor !== CurrentCtor || stubReset)) {
    try { worker.terminate() } catch { /* ignore */ }
    worker = null
    workerCtor = null
    pendingById.clear()
    inflightIdByText.clear()
  }
  if (worker) return worker
  try {
    // Literal `new Worker(new URL(..., import.meta.url), { type: 'module' })` is required for Vite's static
    // worker bundling transform (calling through a local variable inlines raw `.ts` as `data:video/mp2t`).
    const instance = new Worker(new URL('../../workers/threadRender.worker.ts', import.meta.url), { type: 'module' })
    instance.onmessage = handleMessage
    instance.addEventListener?.('error', () => {
      if (worker !== instance) return
      worker = null
      workerCtor = null
      try { instance.terminate() } catch { /* ignore */ }
      clearPendingWithSyncFallback()
    })
    worker = instance
    workerCtor = CurrentCtor
    return instance
  } catch {
    worker = null
    workerCtor = null
    return null
  }
}

/**
 * Requests a parsed hast tree for a settled answer from the single dedicated render worker (with a 300-entry LRU
 * cache and in-flight deduplication). Falls back to synchronous parsing if the worker cannot start.
 * Returns a cancellation callback that detaches this caller's listener.
 */
export function requestThreadTree(text: string, onResult: Listener): () => void {
  const hit = getCachedThreadTree(text)
  if (hit) {
    onResult(hit)
    return () => undefined
  }

  const activeWorker = ensureWorker()
  if (!activeWorker) {
    const syncTree = parseThreadMarkdownSync(text)
    cacheSet(text, syncTree)
    onResult(syncTree)
    return () => undefined
  }

  const existingId = inflightIdByText.get(text)
  if (existingId !== undefined) {
    const existing = pendingById.get(existingId)
    if (existing) {
      existing.listeners.add(onResult)
      return () => { existing.listeners.delete(onResult) }
    }
  }

  const id = nextRequestId++
  const entry: PendingEntry = { text, listeners: new Set([onResult]) }
  pendingById.set(id, entry)
  inflightIdByText.set(text, id)
  activeWorker.postMessage({ id, text })

  return () => {
    entry.listeners.delete(onResult)
  }
}

/** Resets worker handle, pending requests and LRU cache (for unit tests). */
export function resetThreadRenderClientForTest(): void {
  if (worker) {
    try { worker.terminate() } catch { /* ignore */ }
  }
  worker = null
  workerCtor = null
  nextRequestId = 1
  pendingById.clear()
  inflightIdByText.clear()
  cache.clear()
}
