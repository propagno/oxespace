import type { ConversationThread, ThreadProjectSummary } from '../../shared/types/thread'

// A paint-only copy of the conversation list, so a cold sidebar shows its rows before main answers (OXE-58 CA-2).
// Only what a row draws is kept: never paths, workspace or session ids. Nothing here runs when the module loads.
export const THREAD_LIST_CACHE_KEY = 'oxe.thread-list.v1'
export const THREAD_LIST_CACHE_MAX_ROWS = 100
/** Length of the stored JSON string. */
export const THREAD_LIST_CACHE_MAX_BYTES = 32_768

export type CachedThreadRow = Pick<ConversationThread, 'id' | 'projectId' | 'title' | 'provider' | 'status' | 'pinned' | 'createdAt' | 'updatedAt'>
export interface CachedThreadProject { projectId: string; displayName: string }
export interface ThreadListCache { v: 1; savedAt: number; threads: CachedThreadRow[]; projects: CachedThreadProject[] }

function defaultStorage(): Storage | null {
  try { return typeof localStorage === 'undefined' ? null : localStorage } catch { return null }
}

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)
const isRow = (value: unknown): value is CachedThreadRow => isObject(value) && typeof value.id === 'string' && typeof value.projectId === 'string'
  && typeof value.title === 'string' && typeof value.provider === 'string' && typeof value.status === 'string'
  && typeof value.createdAt === 'number' && typeof value.updatedAt === 'number' && (value.pinned === undefined || typeof value.pinned === 'boolean')
const isProject = (value: unknown): value is CachedThreadProject => isObject(value) && typeof value.projectId === 'string' && typeof value.displayName === 'string'

export function readThreadListCache(storage: Storage | null = defaultStorage()): ThreadListCache | null {
  try {
    if (!storage) return null
    const raw = storage.getItem(THREAD_LIST_CACHE_KEY)
    if (typeof raw !== 'string' || raw.length > THREAD_LIST_CACHE_MAX_BYTES) return null
    const value: unknown = JSON.parse(raw)
    if (!isObject(value) || value.v !== 1 || typeof value.savedAt !== 'number' || !Array.isArray(value.threads) || !Array.isArray(value.projects)) return null
    if (!value.threads.every(isRow) || !value.projects.every(isProject)) return null
    return {
      v: 1, savedAt: value.savedAt,
      threads: value.threads.map(row => ({ id: row.id, projectId: row.projectId, title: row.title, provider: row.provider, status: row.status, pinned: Boolean(row.pinned), createdAt: row.createdAt, updatedAt: row.updatedAt })),
      projects: value.projects.map(item => ({ projectId: item.projectId, displayName: item.displayName }))
    }
  } catch { return null }
}

export function writeThreadListCache(threads: ConversationThread[], projects: ThreadProjectSummary[], storage: Storage | null = defaultStorage()): void {
  try {
    if (!storage) return
    const hidden = new Set(projects.filter(project => project.hidden).map(project => project.projectId))
    const rows: CachedThreadRow[] = threads
      .filter(thread => !thread.archived && !hidden.has(thread.projectId))
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, THREAD_LIST_CACHE_MAX_ROWS)
      .map(thread => ({ id: thread.id, projectId: thread.projectId, title: thread.title, provider: thread.provider, status: thread.status, pinned: Boolean(thread.pinned), createdAt: thread.createdAt, updatedAt: thread.updatedAt }))
    const cachedProjects: CachedThreadProject[] = projects.filter(project => !project.hidden).map(project => ({ projectId: project.projectId, displayName: project.displayName }))
    const savedAt = Date.now()
    let text = JSON.stringify({ v: 1, savedAt, threads: rows, projects: cachedProjects })
    while (text.length > THREAD_LIST_CACHE_MAX_BYTES && rows.length) {
      // Drop the oldest rows in proportion to the overflow, one at least, then measure again.
      const average = text.length / rows.length
      rows.splice(rows.length - Math.max(1, Math.min(rows.length, Math.floor((text.length - THREAD_LIST_CACHE_MAX_BYTES) / average))))
      text = JSON.stringify({ v: 1, savedAt, threads: rows, projects: cachedProjects })
    }
    if (text.length > THREAD_LIST_CACHE_MAX_BYTES) return
    storage.setItem(THREAD_LIST_CACHE_KEY, text)
  } catch { /* A full or denied storage only loses the paint-only copy. */ }
}

export function clearThreadListCache(storage: Storage | null = defaultStorage()): void {
  try { storage?.removeItem(THREAD_LIST_CACHE_KEY) } catch { /* Nothing to clear. */ }
}
