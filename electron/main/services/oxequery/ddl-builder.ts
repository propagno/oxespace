import type {
  ColumnDef, ConstraintDef, CreateTableDef, IndexDef, ReferentialAction, StructureAction, StructurePlan, TableChange
} from '../../../../shared/types/oxequery-structure'
import { OxeQueryError } from './oxequery-errors'
import { outsideReach, quoteIdentifier } from './sql-guard'

const MAX_NAME_BYTES = 63
const MAX_EXPRESSION = 2000
const MAX_COLUMNS = 400
const MAX_CHANGES = 100
const ACTIONS: ReferentialAction[] = ['no action', 'restrict', 'cascade', 'set null', 'set default']
const METHODS = ['btree', 'hash', 'gin', 'gist', 'brin']

const invalid = (message: string): OxeQueryError => new OxeQueryError('invalid', message)

/** An identifier PostgreSQL will not silently shorten, quoted. */
function ident(name: unknown, label: string): string {
  if (typeof name !== 'string' || name.trim() === '' || name !== name.trim()) throw invalid(`${label} needs a name without leading or trailing spaces.`)
  if (name.includes('\0') || Buffer.byteLength(name) > MAX_NAME_BYTES) throw invalid(`${label} must be at most ${MAX_NAME_BYTES} bytes (PostgreSQL would cut it).`)
  return quoteIdentifier(name)
}

const qualified = (schema: string, table: string): string => `${ident(schema, 'The schema')}.${ident(table, 'The table')}`

/** A type name: letters, digits, `_`, spaces, dots, quoted names, `(10,2)` and `[]`; no stacking of clauses with a top-level comma. */
export function checkType(type: unknown, label = 'The type'): string {
  if (typeof type !== 'string' || !/^[A-Za-z0-9_ ."(),[\]]+$/.test(type) || type.trim() !== type || type.length === 0 || type.length > 100) throw invalid(`${label} is not a valid type name.`)
  let depth = 0
  let quoted = false
  for (const char of type) {
    if (char === '"') quoted = !quoted
    else if (!quoted && char === '(') depth++
    else if (!quoted && char === ')') depth--
    else if (!quoted && char === ',' && depth === 0) throw invalid(`${label} is not a valid type name.`)
    if (depth < 0) throw invalid(`${label} has unbalanced parentheses.`)
  }
  if (depth !== 0 || quoted) throw invalid(`${label} has unbalanced parentheses or quotes.`)
  return type
}

/**
 * A SQL expression for a default, a CHECK or a partial index. It must be one expression: no `;`, no
 * comments, balanced quotes and parentheses, and none of the functions that reach outside the database
 * (`nextval` is allowed: it is how serial defaults are written).
 */
export function checkExpression(expression: unknown, label: string): string {
  if (typeof expression !== 'string' || expression.trim() === '') throw invalid(`${label} is empty.`)
  if (expression.length > MAX_EXPRESSION || expression.includes('\0')) throw invalid(`${label} is too long.`)
  let depth = 0
  for (let index = 0; index < expression.length;) {
    const char = expression[index]
    const next = expression[index + 1]
    if (char === "'") {
      const escapes = /[eE]/.test(expression[index - 1] ?? '') && !/[A-Za-z0-9_]/.test(expression[index - 2] ?? '')
      index++
      let closed = false
      while (index < expression.length) {
        if (escapes && expression[index] === '\\') { index += 2; continue }
        if (expression[index] === "'") { if (expression[index + 1] === "'") { index += 2; continue } index++; closed = true; break }
        index++
      }
      if (!closed) throw invalid(`${label} has an unclosed quote.`)
      continue
    }
    if (char === '"') {
      const close = expression.indexOf('"', index + 1)
      if (close === -1) throw invalid(`${label} has an unclosed quote.`)
      index = close + 1
      continue
    }
    if (char === '$' && /^\$[A-Za-z_]*\$/.test(expression.slice(index))) {
      const tag = /^\$[A-Za-z_]*\$/.exec(expression.slice(index))![0]
      const close = expression.indexOf(tag, index + tag.length)
      if (close === -1) throw invalid(`${label} has an unclosed quote.`)
      index = close + tag.length
      continue
    }
    if (char === ';') throw invalid(`${label} must be a single expression, without ";".`)
    if ((char === '-' && next === '-') || (char === '/' && next === '*')) throw invalid(`${label} cannot contain comments.`)
    if (char === '(') depth++
    else if (char === ')') depth--
    if (depth < 0) throw invalid(`${label} has unbalanced parentheses.`)
    index++
  }
  if (depth !== 0) throw invalid(`${label} has unbalanced parentheses.`)
  const reaching = outsideReach(expression).filter(name => name !== 'nextval')
  if (reaching.length) throw invalid(`${label} calls ${reaching.join(', ')}, which reaches outside the database.`)
  return expression.trim()
}

const columnList = (names: unknown, label: string): string => {
  if (!Array.isArray(names) || names.length === 0 || names.length > 32) throw invalid(`${label} needs between 1 and 32 columns.`)
  return names.map(name => ident(name, 'A column')).join(', ')
}

function literal(text: string): string {
  if (text.includes('\0')) throw invalid('Text cannot contain a null character.')
  return `'${text.replace(/'/g, "''")}'`
}

function columnClause(column: ColumnDef): string {
  const parts = [ident(column.name, 'A column'), checkType(column.type, `The type of "${column.name}"`)]
  if (column.generated !== undefined && column.generated !== '') {
    if (column.identity || (column.default !== undefined && column.default !== '')) throw invalid(`"${column.name}" cannot be generated and also have a default or identity.`)
    parts.push(`GENERATED ALWAYS AS (${checkExpression(column.generated, `The expression of "${column.name}"`)}) STORED`)
  } else if (column.identity) {
    if (column.default !== undefined && column.default !== '') throw invalid(`"${column.name}" cannot have both an identity and a default.`)
    parts.push(column.identity === 'always' ? 'GENERATED ALWAYS AS IDENTITY' : 'GENERATED BY DEFAULT AS IDENTITY')
  } else if (column.default !== undefined && column.default !== '') {
    parts.push(`DEFAULT ${checkExpression(column.default, `The default of "${column.name}"`)}`)
  }
  if (!column.nullable) parts.push('NOT NULL')
  return parts.join(' ')
}

function constraintClause(constraint: ConstraintDef): string {
  const name = constraint.name ? `CONSTRAINT ${ident(constraint.name, 'A constraint')} ` : ''
  switch (constraint.kind) {
    case 'primary': return `${name}PRIMARY KEY (${columnList(constraint.columns, 'A primary key')})`
    case 'unique': return `${name}UNIQUE (${columnList(constraint.columns, 'A unique constraint')})`
    case 'check': return `${name}CHECK (${checkExpression(constraint.expression, 'A check expression')})`
    case 'foreign': {
      for (const action of [constraint.onDelete, constraint.onUpdate]) if (action !== undefined && !ACTIONS.includes(action)) throw invalid('Unsupported referential action.')
      return `${name}FOREIGN KEY (${columnList(constraint.columns, 'A foreign key')}) REFERENCES ${qualified(constraint.refSchema, constraint.refTable)} (${columnList(constraint.refColumns, 'The referenced columns')})`
        + `${constraint.onDelete ? ` ON DELETE ${constraint.onDelete.toUpperCase()}` : ''}${constraint.onUpdate ? ` ON UPDATE ${constraint.onUpdate.toUpperCase()}` : ''}`
    }
    default: throw invalid('Unsupported constraint.')
  }
}

function indexStatement(schema: string, table: string, index: IndexDef): string {
  const method = index.method ?? 'btree'
  if (!METHODS.includes(method)) throw invalid('Unsupported index method.')
  const where = index.where !== undefined && index.where !== '' ? ` WHERE ${checkExpression(index.where, 'The index condition')}` : ''
  return `CREATE ${index.unique ? 'UNIQUE ' : ''}INDEX ${ident(index.name, 'An index')} ON ${qualified(schema, table)} USING ${method} (${columnList(index.columns, 'An index')})${where}`
}

function changeStatements(schema: string, table: string, change: TableChange, warnings: string[]): { statements: string[]; destructive: boolean } {
  const target = qualified(schema, table)
  switch (change.op) {
    case 'addColumn': {
      if (!change.column.nullable && change.column.default === undefined && !change.column.identity && !change.column.generated) {
        warnings.push(`Adding "${change.column.name}" as NOT NULL without a default fails if the table has rows.`)
      }
      const statements = [`ALTER TABLE ${target} ADD COLUMN ${columnClause(change.column)}`]
      if (change.column.comment) statements.push(`COMMENT ON COLUMN ${target}.${ident(change.column.name, 'A column')} IS ${literal(change.column.comment)}`)
      return { statements, destructive: false }
    }
    case 'dropColumn':
      warnings.push(`Dropping "${change.name}" deletes its data for good, and views or functions that use it stop working.`)
      return { statements: [`ALTER TABLE ${target} DROP COLUMN ${ident(change.name, 'A column')}`], destructive: true }
    case 'renameColumn':
      warnings.push(`Renaming "${change.from}" breaks queries, views and functions that still use the old name.`)
      return { statements: [`ALTER TABLE ${target} RENAME COLUMN ${ident(change.from, 'A column')} TO ${ident(change.to, 'The new name')}`], destructive: false }
    case 'alterColumn': {
      const column = ident(change.name, 'A column')
      const statements: string[] = []
      let destructive = false
      if (change.type !== undefined) {
        const using = change.using !== undefined && change.using !== '' ? ` USING ${checkExpression(change.using, 'The USING expression')}` : ''
        statements.push(`ALTER TABLE ${target} ALTER COLUMN ${column} TYPE ${checkType(change.type)}${using}`)
        warnings.push(`Changing the type of "${change.name}" rewrites the table (it is locked meanwhile) and fails or loses data if values do not convert.`)
        destructive = true
      }
      if (change.nullable !== undefined) {
        statements.push(`ALTER TABLE ${target} ALTER COLUMN ${column} ${change.nullable ? 'DROP NOT NULL' : 'SET NOT NULL'}`)
        if (!change.nullable) warnings.push(`"${change.name}" cannot be NOT NULL while it has empty values.`)
      }
      if (change.default !== undefined) {
        statements.push(change.default === null || change.default === '' ? `ALTER TABLE ${target} ALTER COLUMN ${column} DROP DEFAULT` : `ALTER TABLE ${target} ALTER COLUMN ${column} SET DEFAULT ${checkExpression(change.default, 'The default')}`)
      }
      if (change.identity !== undefined) {
        statements.push(change.identity === null ? `ALTER TABLE ${target} ALTER COLUMN ${column} DROP IDENTITY IF EXISTS` : `ALTER TABLE ${target} ALTER COLUMN ${column} ADD GENERATED ${change.identity === 'always' ? 'ALWAYS' : 'BY DEFAULT'} AS IDENTITY`)
      }
      if (statements.length === 0) throw invalid('Nothing to change on the column.')
      return { statements, destructive }
    }
    case 'addConstraint': {
      if (change.constraint.kind === 'primary' || change.constraint.kind === 'unique' || change.constraint.kind === 'foreign') warnings.push('Adding this constraint checks every existing row and holds a lock while it does.')
      return { statements: [`ALTER TABLE ${target} ADD ${constraintClause(change.constraint)}`], destructive: false }
    }
    case 'dropConstraint':
      warnings.push(`Dropping the constraint "${change.name}" removes a guarantee the data may rely on.`)
      return { statements: [`ALTER TABLE ${target} DROP CONSTRAINT ${ident(change.name, 'A constraint')}`], destructive: false }
    case 'addIndex':
      warnings.push('Creating an index blocks writes to the table until it is built.')
      return { statements: [indexStatement(schema, table, change.index)], destructive: false }
    case 'dropIndex':
      return { statements: [`DROP INDEX ${ident(schema, 'The schema')}.${ident(change.name, 'An index')}`], destructive: false }
    case 'renameTable':
      warnings.push(`Renaming the table breaks queries, views and functions that still use "${table}".`)
      return { statements: [`ALTER TABLE ${target} RENAME TO ${ident(change.to, 'The new name')}`], destructive: false }
    case 'setComment':
      return { statements: [`COMMENT ON TABLE ${target} IS ${change.comment === '' ? 'NULL' : literal(change.comment)}`], destructive: false }
    default: throw invalid('Unsupported change.')
  }
}

function createStatements(schema: string, table: string, definition: CreateTableDef): string[] {
  const columns = definition.columns ?? []
  if (columns.length === 0 || columns.length > MAX_COLUMNS) throw invalid(`A table needs between 1 and ${MAX_COLUMNS} columns.`)
  const names = columns.map(column => column.name)
  if (new Set(names).size !== names.length) throw invalid('Two columns have the same name.')
  const parts = [...columns.map(columnClause), ...(definition.constraints ?? []).map(constraintClause)]
  const statements = [`CREATE TABLE ${qualified(schema, table)} (\n  ${parts.join(',\n  ')}\n)`]
  for (const index of definition.indexes ?? []) statements.push(indexStatement(schema, table, index))
  if (definition.comment) statements.push(`COMMENT ON TABLE ${qualified(schema, table)} IS ${literal(definition.comment)}`)
  for (const column of columns) if (column.comment) statements.push(`COMMENT ON COLUMN ${qualified(schema, table)}.${ident(column.name, 'A column')} IS ${literal(column.comment)}`)
  return statements
}

/** The statements for one structure action and what is worth warning about. Writes nothing. */
export function planStructure(schema: string, table: string, action: StructureAction): StructurePlan {
  const warnings: string[] = []
  switch (action.kind) {
    case 'create':
      return { statements: createStatements(schema, table, action.table), warnings, destructive: false }
    case 'alter': {
      if (!Array.isArray(action.changes) || action.changes.length === 0 || action.changes.length > MAX_CHANGES) throw invalid(`Make between 1 and ${MAX_CHANGES} changes at a time.`)
      const statements: string[] = []
      let destructive = false
      for (const change of action.changes) {
        const planned = changeStatements(schema, table, change, warnings)
        statements.push(...planned.statements)
        destructive = destructive || planned.destructive
      }
      return { statements, warnings: [...new Set(warnings)], destructive }
    }
    case 'drop':
      return { statements: [`DROP TABLE ${qualified(schema, table)}`], warnings: [`Dropping "${table}" deletes the table and all of its rows for good. Views and foreign keys that depend on it block the drop.`], destructive: true }
    case 'truncate':
      return {
        statements: [`TRUNCATE TABLE ${qualified(schema, table)}${action.restartIdentity ? ' RESTART IDENTITY' : ''}${action.cascade ? ' CASCADE' : ''}`],
        warnings: [`Truncating "${table}" deletes every row immediately${action.cascade ? ', and every row of the tables that reference it' : ''}.`],
        destructive: true
      }
    case 'duplicate': {
      const copy = qualified(schema, action.to)
      const statements = [`CREATE TABLE ${copy} (LIKE ${qualified(schema, table)} INCLUDING ALL)`]
      if (action.withData) { statements.push(`INSERT INTO ${copy} SELECT * FROM ${qualified(schema, table)}`); warnings.push('Copying the rows can take a while on a large table.') }
      return { statements, warnings, destructive: false }
    }
    default: throw invalid('Unsupported structure action.')
  }
}

export function maintenanceStatement(schema: string, table: string, action: string): string {
  const target = qualified(schema, table)
  switch (action) {
    case 'vacuum': return `VACUUM ${target}`
    case 'analyze': return `ANALYZE ${target}`
    case 'vacuum-analyze': return `VACUUM (ANALYZE) ${target}`
    case 'reindex': return `REINDEX TABLE ${target}`
    default: throw invalid('Unsupported maintenance action.')
  }
}
