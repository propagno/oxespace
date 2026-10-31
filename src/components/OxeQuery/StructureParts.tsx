import { useState, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { Plus, RotateCcw, Trash2 } from 'lucide-react'
import type { SqlTableDetails } from '../../../shared/types/oxequery'
import type { ConstraintDef, IndexDef, IndexMethod, ReferentialAction } from '../../../shared/types/oxequery-structure'
import { Button, Checkbox, IconButton, Select, TextField } from '../../ui'
import { newColumnRow, splitList, standaloneIndexes, type StructureDraft } from './structure-model'
import styles from './StructureEditor.module.css'
import { EXAMPLE } from './examples'

export const COMMON_TYPES = ['smallint', 'integer', 'bigint', 'numeric(10,2)', 'real', 'double precision', 'boolean', 'text', 'varchar(255)', 'char(1)', 'uuid', 'date', 'time', 'timestamp', 'timestamp with time zone', 'interval', 'jsonb', 'json', 'bytea', 'inet', 'integer[]', 'text[]']
const ACTIONS: ReferentialAction[] = ['no action', 'restrict', 'cascade', 'set null', 'set default']

interface PartProps { draft: StructureDraft; details: SqlTableDetails | null; onChange: (draft: StructureDraft) => void }

export function ColumnsTab({ draft, onChange }: PartProps): ReactElement {
  const { t } = useTranslation('oxequery')
  const update = (key: string, patch: Partial<StructureDraft['rows'][number]>): void => onChange({ ...draft, rows: draft.rows.map(row => row.key === key ? { ...row, ...patch } : row) })
  return <div className={styles.section}>
    <datalist id="oq-structure-types">{COMMON_TYPES.map(type => <option key={type} value={type} />)}</datalist>
    <div className={styles.scroll}>
      <table className={styles.grid} aria-label={t('structure.columns')}>
        <thead><tr><th>{t('server.column.name')}</th><th>{t('columns.type')}</th><th>{t('structure.notNull')}</th><th>{t('columns.default')}</th><th>{t('structure.identity')}</th><th><span className={styles.visuallyHidden}>{t('common.remove')}</span></th></tr></thead>
        <tbody>
          {draft.rows.map(row => {
            const locked = Boolean(row.original?.generated)
            const label = row.original?.name ?? (row.name || t('structure.newColumn'))
            return <tr key={row.key} data-removed={row.removed || undefined} data-new={!row.original || undefined}>
              <td><TextField mono aria-label={t('structure.nameOf', { name: label })} value={row.name} disabled={row.removed} onChange={event => update(row.key, { name: event.target.value })} /></td>
              <td><TextField mono list="oq-structure-types" aria-label={t('structure.typeOf', { name: label })} value={row.type} disabled={row.removed || locked} onChange={event => update(row.key, { type: event.target.value })} /></td>
              <td><input type="checkbox" aria-label={t('structure.notNullOf', { name: label })} checked={!row.nullable} disabled={row.removed || locked} onChange={event => update(row.key, { nullable: !event.target.checked })} /></td>
              <td>{locked
                ? <span className={styles.note} title={t('structure.generatedColumn')}>= {row.generated}</span>
                : <TextField mono aria-label={t('structure.defaultOf', { name: label })} placeholder={t('common.none')} value={row.default} disabled={row.removed || Boolean(row.identity)} onChange={event => update(row.key, { default: event.target.value })} />}</td>
              <td><Select aria-label={t('structure.identityOf', { name: label })} value={row.identity} disabled={row.removed || locked || row.default.trim() !== ''} onChange={event => update(row.key, { identity: event.target.value as typeof row.identity })}
                options={[{ value: '', label: t('common.none') }, { value: 'always', label: t('structure.identityAlways') }, { value: 'by-default', label: t('structure.identityByDefault') }]} /></td>
              <td>{row.original
                ? <IconButton label={t(row.removed ? 'structure.keepNamed' : 'structure.dropNamed', { name: label })} size="sm" icon={row.removed ? <RotateCcw size={14} /> : <Trash2 size={14} />} onClick={() => update(row.key, { removed: !row.removed })} />
                : <IconButton label={t('structure.removeNamed', { name: label })} size="sm" icon={<Trash2 size={14} />} onClick={() => onChange({ ...draft, rows: draft.rows.filter(item => item.key !== row.key) })} />}</td>
            </tr>
          })}
        </tbody>
      </table>
    </div>
    <Button size="sm" icon={<Plus size={14} />} onClick={() => onChange({ ...draft, rows: [...draft.rows, newColumnRow()] })}>{t('structure.addColumn')}</Button>
  </div>
}

function ConstraintForm({ columns, onAdd }: { columns: string[]; onAdd: (constraint: ConstraintDef) => void }): ReactElement {
  const { t } = useTranslation('oxequery')
  const [kind, setKind] = useState<ConstraintDef['kind']>('unique')
  const [name, setName] = useState('')
  const [list, setList] = useState('')
  const [expression, setExpression] = useState('')
  const [refSchema, setRefSchema] = useState('public')
  const [refTable, setRefTable] = useState('')
  const [refColumns, setRefColumns] = useState('')
  const [onDelete, setOnDelete] = useState<ReferentialAction>('no action')
  const [onUpdate, setOnUpdate] = useState<ReferentialAction>('no action')
  const add = (): void => {
    const named = name.trim() ? { name: name.trim() } : {}
    const constraint: ConstraintDef = kind === 'check' ? { kind, ...named, expression }
      : kind === 'foreign' ? { kind, ...named, columns: splitList(list), refSchema: refSchema.trim() || 'public', refTable: refTable.trim(), refColumns: splitList(refColumns), onDelete, onUpdate }
      : { kind, ...named, columns: splitList(list) }
    onAdd(constraint)
    setName(''); setList(''); setExpression(''); setRefTable(''); setRefColumns('')
  }
  return <fieldset className={styles.form}>
    <legend>{t('structure.addConstraintLegend')}</legend>
    <Select label={t('structure.kind')} value={kind} onChange={event => setKind(event.target.value as ConstraintDef['kind'])}
      options={(['primary', 'unique', 'check', 'foreign'] as const).map(value => ({ value, label: t(`structure.constraintKind.${value}`) }))} />
    <TextField mono label={t('structure.nameOptional')} value={name} onChange={event => setName(event.target.value)} />
    {kind === 'check'
      ? <TextField mono label={t('structure.expression')} placeholder={EXAMPLE.checkExpression} value={expression} onChange={event => setExpression(event.target.value)} />
      : <TextField mono label={t('structure.columns')} placeholder={columns.slice(0, 2).join(', ')} hint={t('structure.commas')} value={list} onChange={event => setList(event.target.value)} />}
    {kind === 'foreign' && <>
      <TextField mono label={t('structure.refSchema')} value={refSchema} onChange={event => setRefSchema(event.target.value)} />
      <TextField mono label={t('structure.refTable')} value={refTable} onChange={event => setRefTable(event.target.value)} />
      <TextField mono label={t('structure.refColumns')} hint={t('structure.commas')} value={refColumns} onChange={event => setRefColumns(event.target.value)} />
      <Select label={t('structure.onDelete')} value={onDelete} onChange={event => setOnDelete(event.target.value as ReferentialAction)} options={ACTIONS.map(value => ({ value, label: value }))} />
      <Select label={t('structure.onUpdate')} value={onUpdate} onChange={event => setOnUpdate(event.target.value as ReferentialAction)} options={ACTIONS.map(value => ({ value, label: value }))} />
    </>}
    <Button size="sm" icon={<Plus size={14} />} onClick={add}>{t('structure.addConstraint')}</Button>
  </fieldset>
}

const describeConstraint = (constraint: ConstraintDef): string => {
  switch (constraint.kind) {
    case 'check': return `CHECK (${constraint.expression})`
    case 'foreign': return `FOREIGN KEY (${constraint.columns.join(', ')}) → ${constraint.refSchema}.${constraint.refTable} (${constraint.refColumns.join(', ')})`
    default: return `${constraint.kind === 'primary' ? 'PRIMARY KEY' : 'UNIQUE'} (${constraint.columns.join(', ')})`
  }
}

export function ConstraintsTab({ draft, details, onChange }: PartProps): ReactElement {
  const { t } = useTranslation('oxequery')
  const existing = [
    ...(details?.constraints.map(item => ({ name: item.name, text: item.definition })) ?? []),
    ...(details?.foreignKeys.map(item => ({ name: item.name, text: item.definition })) ?? [])
  ]
  const toggle = (name: string): void => onChange({ ...draft, droppedConstraints: draft.droppedConstraints.includes(name) ? draft.droppedConstraints.filter(item => item !== name) : [...draft.droppedConstraints, name] })
  return <div className={styles.section}>
    <ul className={styles.list} aria-label={t('structure.constraints')}>
      {existing.map(item => {
        const dropped = draft.droppedConstraints.includes(item.name)
        return <li key={item.name} data-removed={dropped || undefined}>
          <span><strong>{item.name}</strong> <code>{item.text}</code></span>
          <IconButton label={t(dropped ? 'structure.keepNamed' : 'structure.dropNamed', { name: item.name })} size="sm" icon={dropped ? <RotateCcw size={14} /> : <Trash2 size={14} />} onClick={() => toggle(item.name)} />
        </li>
      })}
      {draft.addedConstraints.map((constraint, index) => <li key={`new-${index}`} data-new>
        <span><strong>{t('structure.new')}</strong> <code>{describeConstraint(constraint)}</code></span>
        <IconButton label={t('structure.removeNewConstraint', { number: index + 1 })} size="sm" icon={<Trash2 size={14} />} onClick={() => onChange({ ...draft, addedConstraints: draft.addedConstraints.filter((_, at) => at !== index) })} />
      </li>)}
      {existing.length === 0 && draft.addedConstraints.length === 0 && <li className={styles.note}>{t('structure.noConstraints')}</li>}
    </ul>
    <ConstraintForm columns={draft.rows.filter(row => !row.removed && row.name.trim()).map(row => row.name.trim())} onAdd={constraint => onChange({ ...draft, addedConstraints: [...draft.addedConstraints, constraint] })} />
  </div>
}

function IndexForm({ columns, onAdd }: { columns: string[]; onAdd: (index: IndexDef) => void }): ReactElement {
  const { t } = useTranslation('oxequery')
  const [name, setName] = useState('')
  const [list, setList] = useState('')
  const [unique, setUnique] = useState(false)
  const [method, setMethod] = useState<IndexMethod>('btree')
  const [where, setWhere] = useState('')
  return <fieldset className={styles.form}>
    <legend>{t('structure.addIndexLegend')}</legend>
    <TextField mono label={t('server.column.name')} value={name} onChange={event => setName(event.target.value)} />
    <TextField mono label={t('structure.columns')} placeholder={columns.slice(0, 2).join(', ')} hint={t('structure.commas')} value={list} onChange={event => setList(event.target.value)} />
    <Select label={t('structure.method')} value={method} onChange={event => setMethod(event.target.value as IndexMethod)} options={(['btree', 'hash', 'gin', 'gist', 'brin'] as const).map(value => ({ value, label: value }))} />
    <TextField mono label={t('structure.partial')} placeholder={EXAMPLE.partialIndex} value={where} onChange={event => setWhere(event.target.value)} />
    <Checkbox label={t('structure.unique')} checked={unique} onChange={event => setUnique(event.target.checked)} />
    <Button size="sm" icon={<Plus size={14} />} onClick={() => { onAdd({ name: name.trim(), columns: splitList(list), unique, method, ...(where.trim() ? { where: where.trim() } : {}) }); setName(''); setList(''); setWhere('') }}>{t('structure.addIndex')}</Button>
  </fieldset>
}

export function IndexesTab({ draft, details, onChange }: PartProps): ReactElement {
  const { t } = useTranslation('oxequery')
  const existing = details ? standaloneIndexes(details) : []
  const toggle = (name: string): void => onChange({ ...draft, droppedIndexes: draft.droppedIndexes.includes(name) ? draft.droppedIndexes.filter(item => item !== name) : [...draft.droppedIndexes, name] })
  return <div className={styles.section}>
    <ul className={styles.list} aria-label={t('structure.indexes')}>
      {existing.map(item => {
        const dropped = draft.droppedIndexes.includes(item.name)
        return <li key={item.name} data-removed={dropped || undefined}>
          <span><strong>{item.name}</strong> <code>{item.definition}</code></span>
          <IconButton label={t(dropped ? 'structure.keepNamed' : 'structure.dropNamed', { name: item.name })} size="sm" icon={dropped ? <RotateCcw size={14} /> : <Trash2 size={14} />} onClick={() => toggle(item.name)} />
        </li>
      })}
      {draft.addedIndexes.map((index, at) => <li key={`new-${at}`} data-new>
        <span><strong>{t('structure.new')}</strong> <code>{index.unique ? 'UNIQUE ' : ''}{index.name} ({index.columns.join(', ')}) USING {index.method ?? 'btree'}{index.where ? ` WHERE ${index.where}` : ''}</code></span>
        <IconButton label={t('structure.removeNewIndex', { number: at + 1 })} size="sm" icon={<Trash2 size={14} />} onClick={() => onChange({ ...draft, addedIndexes: draft.addedIndexes.filter((_, position) => position !== at) })} />
      </li>)}
      {existing.length === 0 && draft.addedIndexes.length === 0 && <li className={styles.note}>{t('structure.noIndexes')}</li>}
    </ul>
    <IndexForm columns={draft.rows.filter(row => !row.removed && row.name.trim()).map(row => row.name.trim())} onAdd={index => onChange({ ...draft, addedIndexes: [...draft.addedIndexes, index] })} />
  </div>
}
