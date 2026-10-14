import { lstat, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import type { MemoryStorageUsage } from '../../../../shared/types/memory'

const MAX_ENTRIES = 50_000

/**
 * Read-only physical size of the memory directory, grouped by its top-level
 * entry (data, outbox, upgrade snapshots…). Never follows links, never deletes,
 * and stops at a bounded number of entries so a huge store cannot stall the app.
 */
export async function measureMemoryStorage(root: string, now: () => number = Date.now): Promise<MemoryStorageUsage> {
  const categories: Record<string, number> = {}
  let seen = 0
  let truncated = false
  async function walk(directory: string, category: string): Promise<void> {
    let entries
    try { entries = await readdir(directory, { withFileTypes: true }) } catch { return }
    for (const entry of entries) {
      if (++seen > MAX_ENTRIES) { truncated = true; return }
      const path = join(directory, entry.name)
      const name = category || entry.name
      if (entry.isSymbolicLink()) continue
      if (entry.isDirectory()) { categories[name] ??= 0; await walk(path, name); if (truncated) return }
      else if (entry.isFile()) {
        try { categories[name] = (categories[name] ?? 0) + (await lstat(path)).size } catch { /* file vanished while scanning */ }
      }
    }
  }
  await walk(root, '')
  return { categories, totalBytes: Object.values(categories).reduce((sum, bytes) => sum + bytes, 0), truncated, measuredAt: now() }
}
