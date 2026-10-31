import type { SqlColumnInfo, SqlTableDetails } from '../../../shared/types/oxequery'
import type { ColumnDef, ConstraintDef, CreateTableDef, IndexDef, TableChange } from '../../../shared/types/oxequery-structure'
import { tq } from './catalog'

/** One column in the editor: what the table has now (`original`) next to what the person typed. */
export interface ColumnRow {
  key: string
  original?: SqlColumnInfo
  name: string
  type: string
  nullable: boolean
  default: string
  identity: '' | 'always' | 'by-default'
  generated: string
  comment: string
  removed: boolean
}

export interface StructureDraft {
  rows: ColumnRow[]
  droppedConstraints: string[]
  addedConstraints: ConstraintDef[]
  droppedIndexes: string[]
  addedIndexes: IndexDef[]
  tableName: string
  comment: string
}

let counter = 0
const nextKey = (): string => `c${++counter}`

export function newColumnRow(overrides: Partial<ColumnRow> = {}): ColumnRow {
  return { key: nextKey(), name: '', type: 'text', nullable: true, default: '', identity: '', generated: '', comment: '', removed: false, ...overrides }
}

export function rowFromColumn(column: SqlColumnInfo): ColumnRow {
  return newColumnRow({
    original: column, name: column.name, type: column.type, nullable: column.nullable, default: column.default ?? '',
    identity: column.identity ?? '', generated: column.generated ?? '', comment: column.comment ?? ''
  })
}

export function draftFromDetails(table: string, details: SqlTableDetails): StructureDraft {
  return {
    rows: details.columns.map(rowFromColumn), droppedConstraints: [], addedConstraints: [], droppedIndexes: [], addedIndexes: [],
    tableName: table, comment: details.properties?.comment ?? ''
  }
}

export function emptyDraft(): StructureDraft {
  return {
    rows: [newColumnRow({ name: 'id', type: 'bigint', nullable: false, identity: 'always' })],
    droppedConstraints: [], addedConstraints: [{ kind: 'primary', columns: ['id'] }], droppedIndexes: [], addedIndexes: [], tableName: '', comment: ''
  }
}

export function columnDef(row: ColumnRow): ColumnDef {
  return {
    name: row.name.trim(), type: row.type.trim(), nullable: row.nullable,
    ...(row.default.trim() ? { default: row.default.trim() } : {}),
    ...(row.identity ? { identity: row.identity } : {}),
    ...(row.generated.trim() ? { generated: row.generated.trim() } : {}),
    ...(row.comment.trim() ? { comment: row.comment.trim() } : {})
  }
}

/** What is wrong with the draft before the server is asked, in words for a person. */
export function draftProblems(draft: StructureDraft, creating: boolean): string[] {
  const problems: string[] = []
  if (creating && !draft.tableName.trim()) problems.push(tq('structure.problem.tableName'))
  const live = draft.rows.filter(row => !row.removed)
  if (live.length === 0) problems.push(tq('structure.problem.oneColumn'))
  const seen = new Set<string>()
  for (const row of live) {
    const name = row.name.trim()
    if (!name) { problems.push(tq('structure.problem.columnName')); continue }
    if (seen.has(name)) problems.push(tq('structure.problem.duplicate', { name }))
    seen.add(name)
    if (!row.type.trim()) problems.push(tq('structure.problem.type', { name }))
    if (row.identity && row.default.trim()) problems.push(tq('structure.problem.identityDefault', { name }))
  }
  for (const constraint of draft.addedConstraints) {
    if (constraint.kind === 'check') { if (!constraint.expression.trim()) problems.push(tq('structure.problem.checkExpression')) }
    else if (constraint.columns.length === 0) problems.push(tq(`structure.problem.columns.${constraint.kind}`))
    if (constraint.kind === 'foreign' && (!constraint.refTable.trim() || constraint.refColumns.length === 0)) problems.push(tq('structure.problem.foreignTarget'))
  }
  for (const index of draft.addedIndexes) {
    if (!index.name.trim()) problems.push(tq('structure.problem.indexName'))
    if (index.columns.length === 0) problems.push(tq('structure.problem.indexColumns', { name: index.name || tq('structure.unnamed') }))
  }
  return problems
}

function columnChanges(rows: ColumnRow[]): TableChange[] {
  const changes: TableChange[] = []
  for (const row of rows) if (row.original && row.removed) changes.push({ op: 'dropColumn', name: row.original.name })
  for (const row of rows) {
    if (row.removed || !row.original) continue
    const name = row.name.trim()
    if (name !== row.original.name) changes.push({ op: 'renameColumn', from: row.original.name, to: name })
  }
  for (const row of rows) {
    const original = row.original
    if (row.removed || !original || original.generated) continue
    const alter: Extract<TableChange, { op: 'alterColumn' }> = { op: 'alterColumn', name: row.name.trim() }
    let changed = false
    if (row.type.trim() !== original.type) { alter.type = row.type.trim(); changed = true }
    if (row.nullable !== original.nullable) { alter.nullable = row.nullable; changed = true }
    if (row.default.trim() !== (original.default ?? '')) { alter.default = row.default.trim() || null; changed = true }
    if ((row.identity || null) !== (original.identity ?? null)) { alter.identity = row.identity || null; changed = true }
    if (changed) changes.push(alter)
  }
  for (const row of rows) if (!row.original && !row.removed) changes.push({ op: 'addColumn', column: columnDef(row) })
  return changes
}

/** The changes that turn the table as loaded into the table as drafted. Order matters: drops, renames, alters, adds. */
export function changesFromDraft(draft: StructureDraft, table: string, originalComment: string): TableChange[] {
  const changes: TableChange[] = []
  for (const name of draft.droppedConstraints) changes.push({ op: 'dropConstraint', name })
  for (const name of draft.droppedIndexes) changes.push({ op: 'dropIndex', name })
  changes.push(...columnChanges(draft.rows))
  for (const constraint of draft.addedConstraints) changes.push({ op: 'addConstraint', constraint })
  for (const index of draft.addedIndexes) changes.push({ op: 'addIndex', index })
  if (draft.comment !== originalComment) changes.push({ op: 'setComment', comment: draft.comment })
  if (draft.tableName.trim() && draft.tableName.trim() !== table) changes.push({ op: 'renameTable', to: draft.tableName.trim() })
  return changes
}

export function createFromDraft(draft: StructureDraft): CreateTableDef {
  const columns = draft.rows.filter(row => !row.removed).map(columnDef)
  return {
    columns,
    ...(draft.addedConstraints.length ? { constraints: draft.addedConstraints } : {}),
    ...(draft.addedIndexes.length ? { indexes: draft.addedIndexes } : {}),
    ...(draft.comment.trim() ? { comment: draft.comment.trim() } : {})
  }
}

/** `a, b ,c` → `['a','b','c']`. */
export const splitList = (text: string): string[] => text.split(',').map(part => part.trim()).filter(Boolean)

/** Indexes that exist only because a primary key or unique constraint needs one are managed as constraints. */
export function standaloneIndexes(details: SqlTableDetails): SqlTableDetails['indexes'] {
  const owned = new Set(details.constraints.filter(constraint => constraint.kind === 'primary' || constraint.kind === 'unique' || constraint.kind === 'exclusion').map(constraint => constraint.name))
  return details.indexes.filter(index => !index.primary && !owned.has(index.name))
}
