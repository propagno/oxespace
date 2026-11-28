/**
 * OXE-484 · Bounded 10s TTL LRU cache for terminal link resolution & existence probes.
 *
 * Eliminates repeated regex/parse work and fs/IPC stat storms while hovering or
 * scrolling over terminal output, expiring stale entries after 10 seconds and
 * capping memory via LRU eviction at 500 entries.
 */
export const LINK_CACHE_TTL_MS = 10_000
export const LINK_CACHE_MAX_ENTRIES = 500

export interface TerminalLinkCacheOptions {
  ttlMs?: number
  maxEntries?: number
  now?: () => number
}

export interface TerminalLinkCache<T> {
  get(key: string): T | undefined
  set(key: string, value: T): void
  has(key: string): boolean
  delete(key: string): boolean
  prune(): number
  clear(): void
  size(): number
}

interface CacheEntry<T> {
  value: T
  expiresAt: number
}

export function createTerminalLinkCache<T>(
  options: TerminalLinkCacheOptions = {}
): TerminalLinkCache<T> {
  const ttlMs = Math.max(1, options.ttlMs ?? LINK_CACHE_TTL_MS)
  const maxEntries = Math.max(1, options.maxEntries ?? LINK_CACHE_MAX_ENTRIES)
  const now = options.now ?? (() => Date.now())
  const entries = new Map<string, CacheEntry<T>>()

  const prune = (): number => {
    const current = now()
    let removed = 0
    for (const [key, entry] of entries) {
      if (current >= entry.expiresAt) {
        entries.delete(key)
        removed += 1
      }
    }
    return removed
  }

  const get = (key: string): T | undefined => {
    const entry = entries.get(key)
    if (!entry) return undefined
    if (now() >= entry.expiresAt) {
      entries.delete(key)
      return undefined
    }
    // Promote to MRU.
    entries.delete(key)
    entries.set(key, entry)
    return entry.value
  }

  const set = (key: string, value: T): void => {
    const current = now()
    if (entries.has(key)) entries.delete(key)
    if (entries.size >= maxEntries) {
      prune()
      while (entries.size >= maxEntries) {
        const oldest = entries.keys().next().value
        if (oldest === undefined) break
        entries.delete(oldest)
      }
    }
    entries.set(key, { value, expiresAt: current + ttlMs })
  }

  const has = (key: string): boolean => get(key) !== undefined

  return {
    get,
    set,
    has,
    delete: (key: string) => entries.delete(key),
    prune,
    clear: () => entries.clear(),
    size: () => entries.size
  }
}

export interface CachedAsyncResolverOptions<T> extends TerminalLinkCacheOptions {
  resolve: (key: string) => Promise<T> | T
}

export interface CachedAsyncResolver<T> {
  getSync(key: string): T | undefined
  resolve(key: string): Promise<T>
  clear(): void
  size(): number
}

export function createCachedAsyncResolver<T>(
  options: CachedAsyncResolverOptions<T>
): CachedAsyncResolver<T> {
  const cache = createTerminalLinkCache<T>(options)
  const inflight = new Map<string, Promise<T>>()

  const resolve = (key: string): Promise<T> => {
    const hit = cache.get(key)
    if (hit !== undefined) return Promise.resolve(hit)
    const pending = inflight.get(key)
    if (pending) return pending

    const task = Promise.resolve()
      .then(() => options.resolve(key))
      .then((result) => {
        cache.set(key, result)
        return result
      })
      .finally(() => {
        inflight.delete(key)
      })
    inflight.set(key, task)
    return task
  }

  return {
    getSync: (key: string) => cache.get(key),
    resolve,
    clear: () => {
      cache.clear()
      inflight.clear()
    },
    size: () => cache.size()
  }
}
