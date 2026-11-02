/**
 * Work that exists only in this window and would be lost if it closed now: an edited file not written yet, an
 * OxePost request changed since it was saved. Each feature registers its source when its module loads, so the close
 * guard (src/lib/closeGuard.ts) asks every loaded feature without importing any of them.
 */
export interface UnsavedItem {
  /** Stable within its source. */
  id: string
  /** What the person recognises: a file path, a request name. */
  label: string
  /** Where it lives: the workspace, the mode. */
  detail?: string
}

export interface UnsavedSource {
  id: string
  items(): UnsavedItem[]
  /** Saves everything this source holds. Whatever could not be saved is still listed by items() afterwards. */
  saveAll(): Promise<void>
}

const sources = new Map<string, UnsavedSource>()

/** Adds a source; returns the function that removes it. A second source with the same id replaces the first. */
export function registerUnsavedSource(source: UnsavedSource): () => void {
  sources.set(source.id, source)
  return () => { if (sources.get(source.id) === source) sources.delete(source.id) }
}

/** Everything unsaved, by source. A source that throws while listing counts as having nothing to lose. */
export function unsavedWork(): Array<{ source: string; items: UnsavedItem[] }> {
  return [...sources.values()].flatMap(source => {
    let items: UnsavedItem[]
    try { items = source.items() } catch { return [] }
    return items.length ? [{ source: source.id, items }] : []
  })
}

/** Asks each source with unsaved work to save it; resolves with what is still unsaved after that. */
export async function saveAllUnsaved(): Promise<Array<{ source: string; items: UnsavedItem[] }>> {
  const pending = unsavedWork()
  await Promise.allSettled(pending.map(({ source }) => sources.get(source)!.saveAll()))
  return unsavedWork()
}

/** Tests only: forgets every source. */
export function resetUnsavedSourcesForTests(): void {
  sources.clear()
}
