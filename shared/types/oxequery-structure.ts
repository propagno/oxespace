/**
 * The structure of a table as data. The page sends these shapes and the server writes the DDL
 * from them: identifiers are quoted, types are checked against a pattern, and the few places that
 * take SQL (defaults, CHECK expressions, a partial index's WHERE) are validated. Free text from
 * the page never becomes a statement.
 */

export interface ColumnDef {
  name: string
  /** `text`, `numeric(10,2)`, `timestamp with time zone`, `int[]`, `public.my_enum`. */
  type: string
  nullable: boolean
  /** A SQL expression (`now()`, `'x'`, `nextval('s')`). Not used with identity or generated columns. */
  default?: string
  identity?: 'always' | 'by-default'
  /** `price * qty`: a stored generated column. */
  generated?: string
  comment?: string
}

export type ConstraintDef =
  | { kind: 'primary'; name?: string; columns: string[] }
  | { kind: 'unique'; name?: string; columns: string[] }
  | { kind: 'check'; name?: string; expression: string }
  | { kind: 'foreign'; name?: string; columns: string[]; refSchema: string; refTable: string; refColumns: string[]; onDelete?: ReferentialAction; onUpdate?: ReferentialAction }

export type ReferentialAction = 'no action' | 'restrict' | 'cascade' | 'set null' | 'set default'
export type IndexMethod = 'btree' | 'hash' | 'gin' | 'gist' | 'brin'

export interface IndexDef {
  name: string
  columns: string[]
  unique?: boolean
  method?: IndexMethod
  /** Partial index condition, a SQL expression. */
  where?: string
}

export type TableChange =
  | { op: 'addColumn'; column: ColumnDef }
  | { op: 'dropColumn'; name: string }
  | { op: 'renameColumn'; from: string; to: string }
  | { op: 'alterColumn'; name: string; type?: string; using?: string; nullable?: boolean; default?: string | null; identity?: 'always' | 'by-default' | null }
  | { op: 'addConstraint'; constraint: ConstraintDef }
  | { op: 'dropConstraint'; name: string }
  | { op: 'addIndex'; index: IndexDef }
  | { op: 'dropIndex'; name: string }
  | { op: 'renameTable'; to: string }
  | { op: 'setComment'; comment: string }

export interface CreateTableDef {
  columns: ColumnDef[]
  constraints?: ConstraintDef[]
  indexes?: IndexDef[]
  comment?: string
}

export type StructureAction =
  | { kind: 'create'; table: CreateTableDef }
  | { kind: 'alter'; changes: TableChange[] }
  | { kind: 'drop' }
  | { kind: 'truncate'; restartIdentity?: boolean; cascade?: boolean }
  | { kind: 'duplicate'; to: string; withData?: boolean }

export interface StructureInput {
  connectionId: string
  schema: string
  table: string
  action: StructureAction
  /** The person confirmed what the preview flagged. */
  confirmed?: boolean
}

export interface StructurePlan {
  /** The statements, in the order they run (one transaction). */
  statements: string[]
  /** What deserves a second look: data loss, locks, a rewrite. Empty when nothing does. */
  warnings: string[]
  /** True when a statement cannot be undone: it needs `confirmed` to run. */
  destructive: boolean
}

export interface StructureResult extends StructurePlan { applied: boolean; durationMs: number }

export type MaintenanceAction = 'vacuum' | 'analyze' | 'vacuum-analyze' | 'reindex'
