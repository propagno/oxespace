import { useState, type ReactElement } from 'react'
import { ChevronDown, ChevronRight, X } from 'lucide-react'
import type { PlanNode, SqlExplain } from '../../../shared/types/oxequery'
import { formatNumber } from '../../utils/formatTime'

function Node({ node, depth, analyze }: { node: PlanNode; depth: number; analyze: boolean }): ReactElement {
  const [open, setOpen] = useState(depth < 6)
  const share = Math.round(node.selfCostShare * 100)
  const label = [node.nodeType, node.joinType && `(${node.joinType})`, node.relation && `on ${node.relation}${node.alias ? ` ${node.alias}` : ''}`, node.index && `using ${node.index}`].filter(Boolean).join(' ')
  const hot = node.selfCostShare >= 0.25
  return <li role="treeitem" aria-expanded={node.children.length ? open : undefined} aria-level={depth + 1}>
    <div className="oq-plan-node" data-hot={hot}>
      {node.children.length > 0
        ? <button type="button" aria-label={open ? 'Collapse' : 'Expand'} onClick={() => setOpen(value => !value)}>{open ? <ChevronDown size={12} aria-hidden="true" /> : <ChevronRight size={12} aria-hidden="true" />}</button>
        : <span className="oq-plan-spacer" />}
      <div className="oq-plan-body">
        <div className="oq-plan-title"><strong>{label}</strong>
          <span className="oq-plan-share" title="Share of the plan's time (or cost) spent in this step alone"><span style={{ width: `${Math.max(2, share)}%` }} /></span><small>{share}%</small></div>
        <div className="oq-plan-meta">
          {analyze && node.actualMs !== undefined
            ? <span>{(node.selfMs ?? 0).toFixed(2)} ms own · {node.actualRows === undefined ? '' : formatNumber(node.actualRows)} rows{(node.loops ?? 1) > 1 ? ` × ${node.loops} loops` : ''} (estimated {formatNumber(node.planRows)})</span>
            : <span>cost {node.startupCost.toFixed(2)}..{node.totalCost.toFixed(2)} · ~{formatNumber(node.planRows)} rows</span>}
          {node.readBlocks ? <span>{formatNumber(node.readBlocks)} blocks read from disk</span> : null}
        </div>
        {node.detail && <code className="oq-plan-detail">{node.detail}</code>}
      </div>
    </div>
    {open && node.children.length > 0 && <ul role="group">{node.children.map((child, index) => <Node key={index} node={child} depth={depth + 1} analyze={analyze} />)}</ul>}
  </li>
}

/** The execution plan as a tree; steps that take a large share of the time are highlighted. */
export function ExplainView({ explain, onClose }: { explain: SqlExplain; onClose: () => void }): ReactElement {
  return <section className="oq-plan" aria-label="Execution plan">
    <header>
      <strong>{explain.analyze ? 'Execution plan (analyzed)' : 'Execution plan (estimated)'}</strong>
      <span className="oq-muted">
        {explain.planningMs !== undefined ? `planning ${explain.planningMs.toFixed(2)} ms` : ''}
        {explain.executionMs !== undefined ? ` · execution ${explain.executionMs.toFixed(2)} ms` : ''}
        {` · ${explain.nodeCount} step${explain.nodeCount === 1 ? '' : 's'}`}
      </span>
      <span className="oq-spacer" />
      <button type="button" aria-label="Close plan" onClick={onClose}><X size={13} aria-hidden="true" /></button>
    </header>
    {explain.hints.length > 0 && <ul className="oq-plan-hints" aria-label="Suggestions">{explain.hints.map(hint => <li key={hint}>{hint}</li>)}</ul>}
    {!explain.analyze && <p className="oq-muted">Estimates only; the statement was not run. Use Analyze for real timings.</p>}
    <ul role="tree" className="oq-plan-tree"><Node node={explain.plan} depth={0} analyze={explain.analyze} /></ul>
  </section>
}
