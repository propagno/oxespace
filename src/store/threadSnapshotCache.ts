import type { ThreadSnapshot } from '../../shared/types/thread'

export const THREAD_SNAPSHOT_CACHE_LIMIT = 4

export interface ThreadSnapshotCache {
  snapshots: Record<string, ThreadSnapshot>
  order: string[]
}

export function cacheThreadSnapshot(cache: ThreadSnapshotCache, snapshot: ThreadSnapshot, limit = THREAD_SNAPSHOT_CACHE_LIMIT): ThreadSnapshotCache {
  const id = snapshot.thread.id
  const order = [id, ...cache.order.filter(value => value !== id)].slice(0, Math.max(1, limit))
  const retained = new Set(order)
  return {
    order,
    snapshots: Object.fromEntries([...Object.entries(cache.snapshots).filter(([key]) => retained.has(key)), [id, snapshot]])
  }
}

export function retainThreadSnapshots(cache: ThreadSnapshotCache, validIds: Set<string>): ThreadSnapshotCache {
  const order = cache.order.filter(id => validIds.has(id))
  return { order, snapshots: Object.fromEntries(order.flatMap(id => cache.snapshots[id] ? [[id, cache.snapshots[id]]] : [])) }
}
