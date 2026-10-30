import { useState, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { Plus, X } from 'lucide-react'
import type { SqlColumnInfo, SqlFilter, SqlFilterOp, SqlTxState } from '../../../shared/types/oxequery'
import { SQL_NULL, describeCell } from './grid-format'
import { ArrayList, JsonTree, contentText } from './CellValue'
import { readCell } from './grid-model'
import { FILTER_OPS, completeFilters, filterLabel, type ParamValue } from './workbench-model'
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
  const { t } = useTranslation('oxequery')
  const ready = names.every(name => values[name] !== undefined)
  return <form className="oq-params" aria-label={t('params.label')} onSubmit={event => { event.preventDefault(); if (ready) onRun() }}>
    <strong>{t('params.title')}</strong>
    {names.map((name, index) => {
      const entry = values[name] ?? { value: '', isNull: false }
      return <label key={name}>{/^\d+$/.test(name) ? `$${name}` : `:${name}`}
        <input value={entry.isNull ? '' : entry.value} disabled={entry.isNull} placeholder={entry.isNull ? SQL_NULL : t('params.value')} autoFocus={index === 0} spellCheck={false}
          onChange={event => onChange(name, { value: event.target.value, isNull: false })} />
        <span className="oq-check"><input type="checkbox" aria-label={t('params.useNull', { name })} checked={entry.isNull} onChange={event => onChange(name, { value: '', isNull: event.target.checked })} />{SQL_NULL}</span>
      </label>
    })}
    <small>{t('params.hint')}</small>
    <div><button type="button" onClick={onCancel}>{t('common.cancel')}</button><button type="submit" className="oq-primary" disabled={!ready}>{t('common.run')}</button></div>
  </form>
}

/** Begin, commit and roll back, with the state of the connection's transaction. */
export function TxBar({ state, busy, onAction }: { state: SqlTxState; busy: boolean; onAction: (action: 'begin' | 'commit' | 'rollback') => void }): ReactElement {
  const { t } = useTranslation('oxequery')
  if (state.state === 'none') {
    return <Button size="sm" onClick={() => onAction('begin')} disabled={busy} title={t('tx.beginTitle')}>{t('tx.begin')}</Button>
  }
  const failed = state.state === 'failed'
  return <span className="oq-tx" data-state={state.state} role="status">
    <strong>{failed ? t('tx.failed') : t('tx.open')}</strong>
    <span>{t('tx.statements', { count: state.statements })}</span>
    <Button size="sm" variant="primary" onClick={() => onAction('commit')} disabled={busy || failed} title={failed ? t('tx.commitBlocked') : t('tx.commitTitle')}>{t('tx.commit')}</Button>
    <Button size="sm" variant="danger" onClick={() => onAction('rollback')} disabled={busy} title={t('tx.rollbackTitle')}>{t('tx.rollback')}</Button>
  </span>
}

const NEEDS_VALUE = (op: SqlFilterOp): boolean => op !== 'null' && op !== 'notNull'

/** The filter bar of a browsed table: conditions the server applies as bound parameters. */
export function FilterBar({ columns, filters, onApply }: { columns: SqlColumnInfo[]; filters: SqlFilter[]; onApply: (filters: SqlFilter[]) => void }): ReactElement {
  const { t } = useTranslation('oxequery')
  const [draft, setDraft] = useState<SqlFilter[]>(filters)
  const change = (index: number, patch: Partial<SqlFilter>): void => setDraft(current => current.map((filter, position) => position === index ? { ...filter, ...patch } : filter))
  const add = (): void => setDraft(current => [...current, { column: columns[0]?.name ?? '', op: 'contains', value: '' }])
  const apply = (): void => onApply(completeFilters(draft))
  const clear = (): void => { setDraft([]); onApply([]) }
  return <form className="oq-filters" aria-label={t('filter.label')} onSubmit={event => { event.preventDefault(); apply() }}>
    {draft.map((filter, index) => <span key={index} className="oq-filter">
      <Select className="oq-select" aria-label={t('filter.column')} value={filter.column} onChange={event => change(index, { column: event.target.value })}>
        {columns.map(column => <option key={column.name} value={column.name}>{column.name}</option>)}</Select>
      <Select className="oq-select" aria-label={t('filter.condition')} value={filter.op} onChange={event => change(index, { op: event.target.value as SqlFilterOp })}>
        {FILTER_OPS.map(op => <option key={op} value={op}>{filterLabel(op)}</option>)}</Select>
      {NEEDS_VALUE(filter.op) && <input aria-label={t('filter.value')} value={filter.value ?? ''} placeholder={filter.op === 'in' ? 'a, b, c' : t('params.value')} spellCheck={false} onChange={event => change(index, { value: event.target.value })} />}
      <button type="button" className="oq-icon" aria-label={t('filter.remove')} onClick={() => setDraft(current => current.filter((_, position) => position !== index))}><X size={12} aria-hidden="true" /></button>
    </span>)}
    <button type="button" onClick={add}><Plus size={12} aria-hidden="true" />{t('filter.add')}</button>
    {draft.length > 0 && <button type="submit" className="oq-primary">{t('common.apply')}</button>}
    {(draft.length > 0 || filters.length > 0) && <button type="button" onClick={clear}>{t('common.clear')}</button>}
  </form>
}

/** One cell in full: long text, pretty JSON, binary as hex. */
export function CellViewer({ cell, onCopy, onClose }: { cell: { column: string; type?: string; value: unknown; row: number }; onCopy: (text: string) => void; onClose: () => void }): ReactElement {
  const { t } = useTranslation('oxequery')
  const described = describeCell(cell.value)
  const content = readCell(cell.value, cell.type)
  const kind = content.kind === 'other' ? described.kind : content.kind
  const text = contentText(content) ?? described.text
  return <aside className="oq-cell-viewer" aria-label={t('cell.label')}>
    <header><strong>{cell.column}</strong>{cell.type && <small>{cell.type}</small>}<small>{t('cell.row', { number: cell.row + 1 })}</small><span className="oq-spacer" />
      <button type="button" onClick={() => onCopy(kind === 'null' ? '' : text)}>{t('common.copy')}</button>
      <button type="button" aria-label={t('cell.close')} onClick={onClose}><X size={13} aria-hidden="true" /></button></header>
    {content.kind === 'json' ? <JsonTree data={content.data} />
      : content.kind === 'array' ? <ArrayList items={content.items} />
        : <pre className={kind === 'null' ? 'is-null' : undefined} data-kind={kind}>{text}</pre>}
  </aside>
}
