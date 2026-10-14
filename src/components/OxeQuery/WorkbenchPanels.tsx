import { useState, type ReactElement } from 'react'
import { Plus, X } from 'lucide-react'
import type { SqlColumnInfo, SqlFilter, SqlFilterOp, SqlTxState } from '../../../shared/types/oxequery'
import { describeCell } from './grid-format'
import { FILTER_LABELS, completeFilters, type ParamValue } from './workbench-model'
import { Select } from '../../ui/Field'
import { Button } from '../../ui/Button'

/** Values for the `:name` / `$1` parameters of the statement about to run. */
export function ParamsBar({ names, values, onChange, onRun, onCancel }: {
  names: string[]
  values: Record<string, ParamValue>
  onChange: (name: string, value: ParamValue) => void
  onRun: () => void
  onCancel: () => void
}): ReactElement {
  const ready = names.every(name => values[name] !== undefined)
  return <form className="oq-params" aria-label="Query parameters" onSubmit={event => { event.preventDefault(); if (ready) onRun() }}>
    <strong>Parameters</strong>
    {names.map((name, index) => {
      const entry = values[name] ?? { value: '', isNull: false }
      return <label key={name}>{/^\d+$/.test(name) ? `$${name}` : `:${name}`}
        <input value={entry.isNull ? '' : entry.value} disabled={entry.isNull} placeholder={entry.isNull ? 'NULL' : 'value'} autoFocus={index === 0} spellCheck={false}
          onChange={event => onChange(name, { value: event.target.value, isNull: false })} />
        <span className="oq-check"><input type="checkbox" aria-label={`Use NULL for ${name}`} checked={entry.isNull} onChange={event => onChange(name, { value: '', isNull: event.target.checked })} />NULL</span>
      </label>
    })}
    <small>Values are text; the server converts them to the type the statement expects.</small>
    <div><button type="button" onClick={onCancel}>Cancel</button><button type="submit" className="oq-primary" disabled={!ready}>Run</button></div>
  </form>
}

/** Begin, commit and roll back, with the state of the connection's transaction. */
export function TxBar({ state, busy, onAction }: { state: SqlTxState; busy: boolean; onAction: (action: 'begin' | 'commit' | 'rollback') => void }): ReactElement {
  if (state.state === 'none') {
    return <Button size="sm" onClick={() => onAction('begin')} disabled={busy} title="Group the statements that follow into one transaction you commit or roll back yourself">Begin transaction</Button>
  }
  const failed = state.state === 'failed'
  return <span className="oq-tx" data-state={state.state} role="status">
    <strong>{failed ? 'Transaction failed' : 'Transaction open'}</strong>
    <span>{state.statements} statement{state.statements === 1 ? '' : 's'}</span>
    <Button size="sm" variant="primary" onClick={() => onAction('commit')} disabled={busy || failed} title={failed ? 'A statement failed; only Roll back is possible' : 'Make the changes permanent'}>Commit</Button>
    <Button size="sm" variant="danger" onClick={() => onAction('rollback')} disabled={busy} title="Discard the changes">Roll back</Button>
  </span>
}

const NEEDS_VALUE = (op: SqlFilterOp): boolean => op !== 'null' && op !== 'notNull'

/** The filter bar of a browsed table: conditions the server applies as bound parameters. */
export function FilterBar({ columns, filters, onApply }: { columns: SqlColumnInfo[]; filters: SqlFilter[]; onApply: (filters: SqlFilter[]) => void }): ReactElement {
  const [draft, setDraft] = useState<SqlFilter[]>(filters)
  const change = (index: number, patch: Partial<SqlFilter>): void => setDraft(current => current.map((filter, position) => position === index ? { ...filter, ...patch } : filter))
  const add = (): void => setDraft(current => [...current, { column: columns[0]?.name ?? '', op: 'contains', value: '' }])
  const apply = (): void => onApply(completeFilters(draft))
  const clear = (): void => { setDraft([]); onApply([]) }
  return <form className="oq-filters" aria-label="Filter rows" onSubmit={event => { event.preventDefault(); apply() }}>
    {draft.map((filter, index) => <span key={index} className="oq-filter">
      <Select className="oq-select" aria-label="Column" value={filter.column} onChange={event => change(index, { column: event.target.value })}>
        {columns.map(column => <option key={column.name} value={column.name}>{column.name}</option>)}</Select>
      <Select className="oq-select" aria-label="Condition" value={filter.op} onChange={event => change(index, { op: event.target.value as SqlFilterOp })}>
        {(Object.keys(FILTER_LABELS) as SqlFilterOp[]).map(op => <option key={op} value={op}>{FILTER_LABELS[op]}</option>)}</Select>
      {NEEDS_VALUE(filter.op) && <input aria-label="Value" value={filter.value ?? ''} placeholder={filter.op === 'in' ? 'a, b, c' : 'value'} spellCheck={false} onChange={event => change(index, { value: event.target.value })} />}
      <button type="button" className="oq-icon" aria-label="Remove condition" onClick={() => setDraft(current => current.filter((_, position) => position !== index))}><X size={12} aria-hidden="true" /></button>
    </span>)}
    <button type="button" onClick={add}><Plus size={12} aria-hidden="true" />Filter</button>
    {draft.length > 0 && <button type="submit" className="oq-primary">Apply</button>}
    {(draft.length > 0 || filters.length > 0) && <button type="button" onClick={clear}>Clear</button>}
  </form>
}

/** One cell in full: long text, pretty JSON, binary as hex. */
export function CellViewer({ cell, onCopy, onClose }: { cell: { column: string; type?: string; value: unknown; row: number }; onCopy: (text: string) => void; onClose: () => void }): ReactElement {
  const { text, kind } = describeCell(cell.value)
  return <aside className="oq-cell-viewer" aria-label="Cell">
    <header><strong>{cell.column}</strong>{cell.type && <small>{cell.type}</small>}<small>row {cell.row + 1}</small><span className="oq-spacer" />
      <button type="button" onClick={() => onCopy(kind === 'null' ? '' : text)}>Copy</button>
      <button type="button" aria-label="Close cell viewer" onClick={onClose}><X size={13} aria-hidden="true" /></button></header>
    <pre className={kind === 'null' ? 'is-null' : undefined} data-kind={kind}>{text}</pre>
  </aside>
}
