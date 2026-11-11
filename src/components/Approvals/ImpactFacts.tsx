import type { ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import type { ThreadRequestImpact } from '../../../shared/types/thread'
import { Badge, cx } from '../../ui'
import styles from './Approvals.module.css'

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
      <div className={styles.factsChips}>
        <Badge>{whereText}</Badge>
        {count !== null ? <Badge>{affectsText}</Badge> : null}
        <Badge intent={impact.reversible ? 'success' : 'danger'}>{undoText}</Badge>
      </div>
    )
  }

  const riskTone = impact.risk === 'critical'
    ? styles.factDanger
    : impact.risk === 'high' || impact.risk === 'medium'
      ? styles.factWarning
      : styles.factSuccess

  return (
    <dl className={styles.factsGrid}>
      <div className={styles.factCard}>
        <dt className={styles.factLabel}>{t('f7.facts.whereLabel')}</dt>
        <dd className={styles.factValue}>{whereText}</dd>
      </div>
      <div className={styles.factCard}>
        <dt className={styles.factLabel}>{t('f7.facts.affectsLabel')}</dt>
        <dd className={styles.factValue}>{affectsText}</dd>
      </div>
      <div className={styles.factCard}>
        <dt className={styles.factLabel}>{t('f7.facts.undoLabel')}</dt>
        <dd className={cx(styles.factValue, impact.reversible ? styles.factSuccess : styles.factDanger)}>{undoText}</dd>
      </div>
      <div className={styles.factCard}>
        <dt className={styles.factLabel}>{t('f7.facts.riskLabel')}</dt>
        <dd className={cx(styles.factValue, riskTone)}>{riskText}</dd>
      </div>
    </dl>
  )
}
