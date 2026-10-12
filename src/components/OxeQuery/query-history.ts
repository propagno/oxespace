export interface HistoryEntry { sql: string; at: number; ms: number; rows: number | null; ok: boolean }

export const HISTORY_LIMIT = 50
const key = (connectionId: string): string => `oxe.oxequery.history.${connectionId}`

export function readHistory(connectionId: string, storage: Pick<Storage, 'getItem'> = window.localStorage): HistoryEntry[] {
  try {
    const parsed: unknown = JSON.parse(storage.getItem(key(connectionId)) ?? '[]')
    if (!Array.isArray(parsed)) return []
    return parsed.filter((item): item is HistoryEntry => {
      const entry = item as Partial<HistoryEntry> | null
      return Boolean(entry) && typeof entry!.sql === 'string' && typeof entry!.at === 'number'
    }).slice(0, HISTORY_LIMIT)
  } catch { return [] }
}

export function writeHistory(connectionId: string, history: HistoryEntry[], storage: Pick<Storage, 'setItem'> = window.localStorage): void {
  // History is a convenience; a full or blocked store must never break a query.
  try { storage.setItem(key(connectionId), JSON.stringify(history.slice(0, HISTORY_LIMIT))) } catch { /* ignore */ }
}

/** Newest first, the same statement is kept once, bounded. */
export function pushHistory(history: HistoryEntry[], entry: HistoryEntry): HistoryEntry[] {
  const sql = entry.sql.trim()
  if (!sql) return history
  return [{ ...entry, sql }, ...history.filter(item => item.sql.trim() !== sql)].slice(0, HISTORY_LIMIT)
}
