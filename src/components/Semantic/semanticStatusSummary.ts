import type { SemanticStatus, SemanticVectorStatus } from '../../../shared/types/ipc'
import { i18n } from '../../i18n'

const ts = (key: string, values?: Record<string, unknown>): string => (i18n.t as unknown as (key: string, options: object) => string)(`semantic.${key}`, { ns: 'code', ...values })

export type SemanticSummaryTone = 'off' | 'error' | 'busy' | 'ready'

export interface SemanticSummary {
  tone: SemanticSummaryTone
  label: string
}

/** Which sources answer queries right now, in user words. */
export function semanticSourcesLabel(vector: SemanticVectorStatus | undefined): string {
  return vector?.state === 'ready' ? ts('sources.both') : ts('sources.exact')
}

/** What the optional vector index is doing, or null when it is off. */
export function vectorStateLabel(vector: SemanticVectorStatus | undefined): string | null {
  if (!vector || vector.state === 'off') return null
  switch (vector.state) {
    case 'downloading': {
      const progress = vector.progress
      return progress && progress.total > 0
        ? ts('vector.downloadingProgress', { percent: Math.floor((progress.loaded / progress.total) * 100) })
        : ts('vector.downloading')
    }
    case 'loading': return ts('vector.loading')
    case 'not-installed': return ts('vector.notInstalled')
    case 'error': return ts('vector.error', { error: vector.error ?? ts('vector.unknown') })
    default: return ts('vector.ready')
  }
}

/**
 * One summary for the integration chip and the activity panel. Exact-term
 * search (FTS5) needs no model, so a missing or loading vector model is a note,
 * not a "loading" state for the whole feature.
 */
export function summarizeSemanticStatus(status: SemanticStatus | null, enabled: boolean): SemanticSummary {
  if (!enabled || (status && !status.enabled)) return { tone: 'off', label: ts('summary.off') }
  if (!status) return { tone: 'busy', label: ts('summary.starting') }
  if (status.lastError) return { tone: 'error', label: ts('summary.error', { error: status.lastError }) }
  const documents = status.coverage?.lexicalDocuments ?? status.count
  const vector = vectorStateLabel(status.vector)
  const base = status.indexing
    ? ts('summary.indexing', { count: documents })
    : documents === 0
      ? ts('summary.empty')
      : ts('summary.ready', { count: documents })
  const busy = status.indexing || status.vector?.state === 'downloading' || status.vector?.state === 'loading'
  const note = vector && status.vector?.state !== 'ready' ? [vector] : []
  return { tone: busy ? 'busy' : 'ready', label: [base, semanticSourcesLabel(status.vector), ...note].join(' · ') }
}
