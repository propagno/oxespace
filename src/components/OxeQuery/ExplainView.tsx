import { useState, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { formatMs } from './catalog'
import { ChevronDown, ChevronRight, X } from 'lucide-react'
import type { PlanNode, SqlExplain } from '../../../shared/types/oxequery'
import { formatNumber } from '../../utils/formatTime'

function Node({ node, depth, analyze }: { node: PlanNode; depth: number; analyze: boolean }): ReactElement {
  const { t } = useTranslation('oxequery')
  const [open, setOpen] = useState(depth < 6)
  const share = Math.round(node.selfCostShare * 100)
  const label = [node.nodeType, node.joinType && `(${node.joinType})`, node.relation && t('plan.on', { relation: `${node.relation}${node.alias ? ` ${node.alias}` : ''}` }), node.index && t('plan.using', { index: node.index })].filter(Boolean).join(' ')
  const hot = node.selfCostShare >= 0.25
  return <li role="treeitem" aria-expanded={node.children.length ? open : undefined} aria-level={depth + 1}>
    <div className="oq-plan-node" data-hot={hot}>
      {node.children.length > 0
        ? <button type="button" aria-label={open ? t('plan.collapse') : t('plan.expand')} onClick={() => setOpen(value => !value)}>{open ? <ChevronDown size={12} aria-hidden="true" /> : <ChevronRight size={12} aria-hidden="true" />}</button>
        : <span className="oq-plan-spacer" />}
      <div className="oq-plan-body">
        <div className="oq-plan-title"><strong>{label}</strong>
          <span className="oq-plan-share" title={t('plan.shareTitle')}><span style={{ width: `${Math.max(2, share)}%` }} /></span><small>{share}%</small></div>
        <div className="oq-plan-meta">
          {analyze && node.actualMs !== undefined
            ? <span>{t('plan.actual', { own: formatMs(node.selfMs ?? 0, 2), rows: node.actualRows === undefined ? '–' : formatNumber(node.actualRows), estimated: formatNumber(node.planRows) })}{(node.loops ?? 1) > 1 ? ` ${t('plan.loops', { count: node.loops, formatted: formatNumber(node.loops ?? 1) })}` : ''}</span>
            : <span>{t('plan.cost', { startup: formatNumber(node.startupCost, { minimumFractionDigits: 2, maximumFractionDigits: 2 }), total: formatNumber(node.totalCost, { minimumFractionDigits: 2, maximumFractionDigits: 2 }), rows: formatNumber(node.planRows) })}</span>}
          {node.readBlocks ? <span>{t('plan.blocks', { count: node.readBlocks, formatted: formatNumber(node.readBlocks) })}</span> : null}
        </div>
        {node.detail && <code className="oq-plan-detail">{node.detail}</code>}
      </div>
    </div>
    {open && node.children.length > 0 && <ul role="group">{node.children.map((child, index) => <Node key={index} node={child} depth={depth + 1} analyze={analyze} />)}</ul>}
  </li>
}

/** The execution plan as a tree; steps that take a large share of the time are highlighted. */
export function ExplainView({ explain, onClose }: { explain: SqlExplain; onClose: () => void }): ReactElement {
  const { t } = useTranslation('oxequery')
  const facts = [explain.planningMs !== undefined ? t('plan.planning', { duration: formatMs(explain.planningMs, 2) }) : '', explain.executionMs !== undefined ? t('plan.execution', { duration: formatMs(explain.executionMs, 2) }) : '', t('plan.steps', { count: explain.nodeCount })]
  return <section className="oq-plan" aria-label={t('plan.label')}>
    <header>
      <strong>{explain.analyze ? t('plan.analyzed') : t('plan.estimated')}</strong>
      <span className="oq-muted">{facts.filter(Boolean).join(' · ')}</span>
      <span className="oq-spacer" />
      <button type="button" aria-label={t('plan.close')} onClick={onClose}><X size={13} aria-hidden="true" /></button>
    </header>
    {explain.hints.length > 0 && <ul className="oq-plan-hints" aria-label={t('plan.suggestions')}>{explain.hints.map(hint => <li key={hint}>{hint}</li>)}</ul>}
    {!explain.analyze && <p className="oq-muted">{t('plan.estimatesOnly')}</p>}
    <ul role="tree" className="oq-plan-tree"><Node node={explain.plan} depth={0} analyze={explain.analyze} /></ul>
  </section>
}
