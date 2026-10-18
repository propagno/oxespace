import { useState, type ReactElement } from 'react'
import { Plus, RotateCcw, Trash2 } from 'lucide-react'
import type { SqlTableDetails } from '../../../shared/types/oxequery'
import type { ConstraintDef, IndexDef, IndexMethod, ReferentialAction } from '../../../shared/types/oxequery-structure'
import { Button, Checkbox, IconButton, Select, TextField } from '../../ui'
import { newColumnRow, splitList, standaloneIndexes, type StructureDraft } from './structure-model'
import styles from './StructureEditor.module.css'

export const COMMON_TYPES = ['smallint', 'integer', 'bigint', 'numeric(10,2)', 'real', 'double precision', 'boolean', 'text', 'varchar(255)', 'char(1)', 'uuid', 'date', 'time', 'timestamp', 'timestamp with time zone', 'interval', 'jsonb', 'json', 'bytea', 'inet', 'integer[]', 'text[]']
const ACTIONS: ReferentialAction[] = ['no action', 'restrict', 'cascade', 'set null', 'set default']

interface PartProps { draft: StructureDraft; details: SqlTableDetails | null; onChange: (draft: StructureDraft) => void }

export function ColumnsTab({ draft, onChange }: PartProps): ReactElement {
  const update = (key: string, patch: Partial<StructureDraft['rows'][number]>): void => onChange({ ...draft, rows: draft.rows.map(row => row.key === key ? { ...row, ...patch } : row) })
  return <div className={styles.section}>
    <datalist id="oq-structure-types">{COMMON_TYPES.map(type => <option key={type} value={type} />)}</datalist>
    <div className={styles.scroll}>
      <table className={styles.grid} aria-label="Columns">
        <thead><tr><th>Name</th><th>Type</th><th>Not null</th><th>Default</th><th>Identity</th><th><span className={styles.visuallyHidden}>Remove</span></th></tr></thead>
        <tbody>
          {draft.rows.map(row => {
            const locked = Boolean(row.original?.generated)
            const label = row.original?.name ?? (row.name || 'new column')
            return <tr key={row.key} data-removed={row.removed || undefined} data-new={!row.original || undefined}>
              <td><TextField mono aria-label={`Name of ${label}`} value={row.name} disabled={row.removed} onChange={event => update(row.key, { name: event.target.value })} /></td>
              <td><TextField mono list="oq-structure-types" aria-label={`Type of ${label}`} value={row.type} disabled={row.removed || locked} onChange={event => update(row.key, { type: event.target.value })} /></td>
              <td><input type="checkbox" aria-label={`${label} is not null`} checked={!row.nullable} disabled={row.removed || locked} onChange={event => update(row.key, { nullable: !event.target.checked })} /></td>
              <td>{locked
                ? <span className={styles.note} title="Generated column">= {row.generated}</span>
                : <TextField mono aria-label={`Default of ${label}`} placeholder="none" value={row.default} disabled={row.removed || Boolean(row.identity)} onChange={event => update(row.key, { default: event.target.value })} />}</td>
              <td><Select aria-label={`Identity of ${label}`} value={row.identity} disabled={row.removed || locked || row.default.trim() !== ''} onChange={event => update(row.key, { identity: event.target.value as typeof row.identity })}
                options={[{ value: '', label: 'none' }, { value: 'always', label: 'always' }, { value: 'by-default', label: 'by default' }]} /></td>
              <td>{row.original
                ? <IconButton label={row.removed ? `Keep ${label}` : `Drop ${label}`} size="sm" icon={row.removed ? <RotateCcw size={14} /> : <Trash2 size={14} />} onClick={() => update(row.key, { removed: !row.removed })} />
                : <IconButton label={`Remove ${label}`} size="sm" icon={<Trash2 size={14} />} onClick={() => onChange({ ...draft, rows: draft.rows.filter(item => item.key !== row.key) })} />}</td>
            </tr>
          })}
        </tbody>
      </table>
    </div>
    <Button size="sm" icon={<Plus size={14} />} onClick={() => onChange({ ...draft, rows: [...draft.rows, newColumnRow()] })}>Add column</Button>
  </div>
}

function ConstraintForm({ columns, onAdd }: { columns: string[]; onAdd: (constraint: ConstraintDef) => void }): ReactElement {
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
    <legend>Add a constraint</legend>
    <Select label="Kind" value={kind} onChange={event => setKind(event.target.value as ConstraintDef['kind'])}
      options={[{ value: 'primary', label: 'Primary key' }, { value: 'unique', label: 'Unique' }, { value: 'check', label: 'Check' }, { value: 'foreign', label: 'Foreign key' }]} />
    <TextField mono label="Name (optional)" value={name} onChange={event => setName(event.target.value)} />
    {kind === 'check'
      ? <TextField mono label="Expression" placeholder="price >= 0" value={expression} onChange={event => setExpression(event.target.value)} />
      : <TextField mono label="Columns" placeholder={columns.slice(0, 2).join(', ')} hint="Separate with commas" value={list} onChange={event => setList(event.target.value)} />}
    {kind === 'foreign' && <>
      <TextField mono label="References schema" value={refSchema} onChange={event => setRefSchema(event.target.value)} />
      <TextField mono label="References table" value={refTable} onChange={event => setRefTable(event.target.value)} />
      <TextField mono label="References columns" hint="Separate with commas" value={refColumns} onChange={event => setRefColumns(event.target.value)} />
      <Select label="On delete" value={onDelete} onChange={event => setOnDelete(event.target.value as ReferentialAction)} options={ACTIONS.map(value => ({ value, label: value }))} />
      <Select label="On update" value={onUpdate} onChange={event => setOnUpdate(event.target.value as ReferentialAction)} options={ACTIONS.map(value => ({ value, label: value }))} />
    </>}
    <Button size="sm" icon={<Plus size={14} />} onClick={add}>Add constraint</Button>
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
  const existing = [
    ...(details?.constraints.map(item => ({ name: item.name, text: item.definition })) ?? []),
    ...(details?.foreignKeys.map(item => ({ name: item.name, text: item.definition })) ?? [])
  ]
  const toggle = (name: string): void => onChange({ ...draft, droppedConstraints: draft.droppedConstraints.includes(name) ? draft.droppedConstraints.filter(item => item !== name) : [...draft.droppedConstraints, name] })
  return <div className={styles.section}>
    <ul className={styles.list} aria-label="Constraints">
      {existing.map(item => {
        const dropped = draft.droppedConstraints.includes(item.name)
        return <li key={item.name} data-removed={dropped || undefined}>
          <span><strong>{item.name}</strong> <code>{item.text}</code></span>
          <IconButton label={dropped ? `Keep ${item.name}` : `Drop ${item.name}`} size="sm" icon={dropped ? <RotateCcw size={14} /> : <Trash2 size={14} />} onClick={() => toggle(item.name)} />
        </li>
      })}
      {draft.addedConstraints.map((constraint, index) => <li key={`new-${index}`} data-new>
        <span><strong>new</strong> <code>{describeConstraint(constraint)}</code></span>
        <IconButton label={`Remove new constraint ${index + 1}`} size="sm" icon={<Trash2 size={14} />} onClick={() => onChange({ ...draft, addedConstraints: draft.addedConstraints.filter((_, at) => at !== index) })} />
      </li>)}
      {existing.length === 0 && draft.addedConstraints.length === 0 && <li className={styles.note}>No constraints.</li>}
    </ul>
    <ConstraintForm columns={draft.rows.filter(row => !row.removed && row.name.trim()).map(row => row.name.trim())} onAdd={constraint => onChange({ ...draft, addedConstraints: [...draft.addedConstraints, constraint] })} />
  </div>
}

function IndexForm({ columns, onAdd }: { columns: string[]; onAdd: (index: IndexDef) => void }): ReactElement {
  const [name, setName] = useState('')
  const [list, setList] = useState('')
  const [unique, setUnique] = useState(false)
  const [method, setMethod] = useState<IndexMethod>('btree')
  const [where, setWhere] = useState('')
  return <fieldset className={styles.form}>
    <legend>Add an index</legend>
    <TextField mono label="Name" value={name} onChange={event => setName(event.target.value)} />
    <TextField mono label="Columns" placeholder={columns.slice(0, 2).join(', ')} hint="Separate with commas" value={list} onChange={event => setList(event.target.value)} />
    <Select label="Method" value={method} onChange={event => setMethod(event.target.value as IndexMethod)} options={(['btree', 'hash', 'gin', 'gist', 'brin'] as const).map(value => ({ value, label: value }))} />
    <TextField mono label="Only rows where (optional)" placeholder="deleted_at IS NULL" value={where} onChange={event => setWhere(event.target.value)} />
    <Checkbox label="Unique" checked={unique} onChange={event => setUnique(event.target.checked)} />
    <Button size="sm" icon={<Plus size={14} />} onClick={() => { onAdd({ name: name.trim(), columns: splitList(list), unique, method, ...(where.trim() ? { where: where.trim() } : {}) }); setName(''); setList(''); setWhere('') }}>Add index</Button>
  </fieldset>
}

export function IndexesTab({ draft, details, onChange }: PartProps): ReactElement {
  const existing = details ? standaloneIndexes(details) : []
  const toggle = (name: string): void => onChange({ ...draft, droppedIndexes: draft.droppedIndexes.includes(name) ? draft.droppedIndexes.filter(item => item !== name) : [...draft.droppedIndexes, name] })
  return <div className={styles.section}>
    <ul className={styles.list} aria-label="Indexes">
      {existing.map(item => {
        const dropped = draft.droppedIndexes.includes(item.name)
        return <li key={item.name} data-removed={dropped || undefined}>
          <span><strong>{item.name}</strong> <code>{item.definition}</code></span>
          <IconButton label={dropped ? `Keep ${item.name}` : `Drop ${item.name}`} size="sm" icon={dropped ? <RotateCcw size={14} /> : <Trash2 size={14} />} onClick={() => toggle(item.name)} />
        </li>
      })}
      {draft.addedIndexes.map((index, at) => <li key={`new-${at}`} data-new>
        <span><strong>new</strong> <code>{index.unique ? 'UNIQUE ' : ''}{index.name} ({index.columns.join(', ')}) USING {index.method ?? 'btree'}{index.where ? ` WHERE ${index.where}` : ''}</code></span>
        <IconButton label={`Remove new index ${at + 1}`} size="sm" icon={<Trash2 size={14} />} onClick={() => onChange({ ...draft, addedIndexes: draft.addedIndexes.filter((_, position) => position !== at) })} />
      </li>)}
      {existing.length === 0 && draft.addedIndexes.length === 0 && <li className={styles.note}>No indexes besides the keys.</li>}
    </ul>
    <IndexForm columns={draft.rows.filter(row => !row.removed && row.name.trim()).map(row => row.name.trim())} onAdd={index => onChange({ ...draft, addedIndexes: [...draft.addedIndexes, index] })} />
  </div>
}
