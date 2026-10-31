import type { SemanticStatus, SemanticVectorStatus } from '../../../shared/types/ipc'

export type SemanticSummaryTone = 'off' | 'error' | 'busy' | 'ready'

export interface SemanticSummary {
  tone: SemanticSummaryTone
  label: string
}

/** Which sources answer queries right now, in user words. */
export function semanticSourcesLabel(vector: SemanticVectorStatus | undefined): string {
  return vector?.state === 'ready' ? 'exact terms + vector index' : 'exact terms'
}

/** What the optional vector index is doing, or null when it is off. */
export function vectorStateLabel(vector: SemanticVectorStatus | undefined): string | null {
  if (!vector || vector.state === 'off') return null
  switch (vector.state) {
    case 'downloading': {
      const progress = vector.progress
      return progress && progress.total > 0
        ? `downloading model ${Math.floor((progress.loaded / progress.total) * 100)}%`
        : 'downloading model…'
    }
    case 'loading': return 'loading vector model…'
    case 'not-installed': return 'vector model not installed'
    case 'error': return `vector model error: ${vector.error ?? 'unknown'}`
    default: return 'vector index ready'
  }
}

/**
 * One summary for the integration chip and the activity panel. Exact-term
 * search (FTS5) needs no model, so a missing or loading vector model is a note,
 * not a "loading" state for the whole feature.
 */
export function summarizeSemanticStatus(status: SemanticStatus | null, enabled: boolean): SemanticSummary {
  if (!enabled || (status && !status.enabled)) return { tone: 'off', label: 'off' }
  if (!status) return { tone: 'busy', label: 'starting…' }
  if (status.lastError) return { tone: 'error', label: `error: ${status.lastError}` }
  const documents = status.coverage?.lexicalDocuments ?? status.count
  const vector = vectorStateLabel(status.vector)
  const base = status.indexing
    ? `indexing… · ${documents} files`
    : documents === 0
      ? 'ready · empty index (waiting for files)'
      : `ready · ${documents} files`
  const busy = status.indexing || status.vector?.state === 'downloading' || status.vector?.state === 'loading'
  return { tone: busy ? 'busy' : 'ready', label: `${base} · ${semanticSourcesLabel(status.vector)}${vector && status.vector?.state !== 'ready' ? ` · ${vector}` : ''}` }
}
