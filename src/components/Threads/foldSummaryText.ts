import type { FoldSummary } from '../../../shared/thread-tool-rows'
import { i18n } from '../../i18n'

type PartKey =
  | 'thread:fold.read'
  | 'thread:fold.edited'
  | 'thread:fold.ran'
  | 'thread:fold.queries'
  | 'thread:fold.http'
  | 'thread:fold.containers'

const PARTS: ReadonlyArray<{ field: keyof Pick<FoldSummary, 'read' | 'edited' | 'ran' | 'queries' | 'http' | 'containers'>; key: PartKey }> = [
  { field: 'read', key: 'thread:fold.read' },
  { field: 'edited', key: 'thread:fold.edited' },
  { field: 'ran', key: 'thread:fold.ran' },
  { field: 'queries', key: 'thread:fold.queries' },
  { field: 'http', key: 'thread:fold.http' },
  { field: 'containers', key: 'thread:fold.containers' }
]

export function foldSummaryText(summary: FoldSummary): string {
  const topParts = PARTS
    .map(entry => ({ count: Number(summary[entry.field] ?? 0), key: entry.key }))
    .filter(entry => entry.count > 0)
    .sort((a, b) => b.count - a.count)
    .slice(0, 3)
    .map(entry => i18n.t(entry.key, { count: entry.count }))

  const steps = Number(summary.steps ?? 0)
  const base = topParts.length > 0
    ? i18n.t('thread:fold.stepsWithParts', { count: steps, parts: topParts.join(', ') })
    : i18n.t('thread:fold.steps', { count: steps })

  const failed = Number(summary.failed ?? 0)
  const fixed = Number(summary.fixed ?? 0)
  if (failed > 0) {
    return `${base} · ${i18n.t('thread:fold.failed', { count: failed })}`
  }
  if (fixed > 0) {
    return `${base} · ${i18n.t('thread:fold.fixed', { count: fixed })}`
  }
  return base
}
