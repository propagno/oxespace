/**
 * In-memory LRU file-list cache keyed by workspace `rootPath`.
 *
 * Avoids spawning `rg --files` on every CommandMenu open (and can be shared
 * with CommandBarHost if file quick-open is unified later).
 */

export const LIST_FILES_CACHE_TTL_MS = 30_000
export const FILE_LIST_CACHE_MAX_ENTRIES = 16

export interface FileListCacheEntry {
  files: string[]
  fetchedAt: number
}

export interface FileListCacheLookup {
  files: string[]
  fresh: boolean
}

const cache = new Map<string, FileListCacheEntry>()
let cacheEpoch = 0

/** Returns the current cache generation (incremented on `clearFileListCache`). */
export function getFileListCacheEpoch(): number {
  return cacheEpoch
}

/**
 * Looks up a cached file list for `rootPath` and marks it as most-recently used.
 * Returns `null` on miss; otherwise returns the stored files and whether the
 * entry is still within `LIST_FILES_CACHE_TTL_MS`.
 */
export function getCachedFileList(rootPath: string, now = Date.now()): FileListCacheLookup | null {
  const entry = cache.get(rootPath)
  if (!entry) return null
  // Refresh LRU order on read.
  cache.delete(rootPath)
  cache.set(rootPath, entry)
  return {
    files: entry.files,
    fresh: now - entry.fetchedAt < LIST_FILES_CACHE_TTL_MS
  }
}

/**
 * Stores a file list for `rootPath` and evicts the least-recently used entry
 * when the cache exceeds `FILE_LIST_CACHE_MAX_ENTRIES`.
 *
 * When `expectedEpoch` is provided and no longer matches the current epoch
 * (e.g. `clearFileListCache()` ran while a fetch was in flight), the write is
 * skipped and `false` is returned.
 */
export function setCachedFileList(
  rootPath: string,
  files: string[],
  now = Date.now(),
  expectedEpoch?: number
): boolean {
  if (expectedEpoch !== undefined && expectedEpoch !== cacheEpoch) return false
  cache.delete(rootPath)
  cache.set(rootPath, { files: [...files], fetchedAt: now })
  while (cache.size > FILE_LIST_CACHE_MAX_ENTRIES) {
    const oldestKey = cache.keys().next().value
    if (oldestKey === undefined) break
    cache.delete(oldestKey)
  }
  return true
}

/** Clears all cached file lists (used in tests and explicit invalidation). */
export function clearFileListCache(): void {
  cacheEpoch += 1
  cache.clear()
}
