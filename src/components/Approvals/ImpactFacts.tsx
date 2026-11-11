import type { ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import type { ThreadRequestImpact } from '../../../shared/types/thread'
import { Badge } from '../../ui'

export function titleIncludesWhere(title: string, where: string | undefined): boolean {
  if (!where) return false
  const needle = where.trim().toLowerCase()
  if (!needle) return false
  return title.toLowerCase().includes(needle)
}

export function ImpactFacts({
  impact,
  layout,
  countOverride
}: {
  impact: ThreadRequestImpact
  layout: 'chips' | 'grid'
  countOverride?: number | null
}): ReactElement {
  const { t } = useTranslation('thread')
  const { t: tCommon } = useTranslation('common')
  const whereText = impact.whereSub ? `${impact.where} · ${impact.whereSub}` : impact.where
  const count = countOverride !== undefined ? countOverride : impact.affects.count
  const affectsText = count === null ? t('f7.facts.affectsUnknown') : t(`f7.facts.unit.${impact.affects.unit}`, { count })
  const undoText = impact.reversible ? t('f7.facts.canUndo') : t('f7.facts.cannotUndo')
  const riskText = tCommon(`approvals.risk.${impact.risk}`)

  if (layout === 'chips') {
    return (
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-2)', alignItems: 'center' }}>
        <Badge>{whereText}</Badge>
        {count !== null ? <Badge>{affectsText}</Badge> : null}
        <Badge intent={impact.reversible ? 'success' : 'warning'}>{undoText}</Badge>
      </div>
    )
  }

  return (
    <dl style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 'var(--space-3)', margin: 0 }}>
      <div>
        <dt style={{ color: 'var(--text-secondary)', fontSize: 'var(--text-xs)' }}>{t('f7.facts.whereLabel')}</dt>
        <dd style={{ margin: 0, fontWeight: 500 }}>{whereText}</dd>
      </div>
      <div>
        <dt style={{ color: 'var(--text-secondary)', fontSize: 'var(--text-xs)' }}>{t('f7.facts.affectsLabel')}</dt>
        <dd style={{ margin: 0, fontWeight: 500 }}>{affectsText}</dd>
      </div>
      <div>
        <dt style={{ color: 'var(--text-secondary)', fontSize: 'var(--text-xs)' }}>{t('f7.facts.undoLabel')}</dt>
        <dd style={{ margin: 0, fontWeight: 500 }}>{undoText}</dd>
      </div>
      <div>
        <dt style={{ color: 'var(--text-secondary)', fontSize: 'var(--text-xs)' }}>{t('f7.facts.riskLabel')}</dt>
        <dd style={{ margin: 0, fontWeight: 500 }}>{riskText}</dd>
      </div>
    </dl>
  )
}
