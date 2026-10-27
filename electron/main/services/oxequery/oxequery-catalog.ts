import type { SqlDatabaseInfo, SqlExtensionInfo, SqlFunctionInfo, SqlObjects, SqlResult, SqlRoleInfo, SqlSearchHit, SqlSearchResult, SqlTypeInfo } from '../../../../shared/types/oxequery'
import { OxeQueryError, type ResolvedConnection } from './oxequery-errors'
import { quoteIdentifier } from './sql-guard'
import { nameList } from './oxequery-core'

/**
 * PostgreSQL catalog lists for the schema tree and the database page: functions, databases, roles, sequences,
 * types, triggers, extensions and search. They read through the core's own query paths.
 */
export interface CatalogHost {
  pgMeta(connection: ResolvedConnection, sql: string, params: unknown[], maxRows: number, readOnly: boolean): Promise<SqlResult>
  pgRun(connection: ResolvedConnection, sql: string, params: unknown[], maxRows: number, readOnly: boolean): Promise<SqlResult>
}

export async function sqlFunctions(host: CatalogHost, connection: ResolvedConnection, schema: string): Promise<SqlFunctionInfo[]> {
  const result = await host.pgMeta(connection, `SELECT p.oid::int, p.proname, pg_get_function_identity_arguments(p.oid), p.prokind
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = $1 AND p.prokind IN ('f', 'p') ORDER BY p.proname, p.oid LIMIT 1000`, [schema], 1000, true)
  return result.rows.map(row => ({ oid: Number(row[0]), name: String(row[1]), args: String(row[2]), kind: row[3] === 'p' ? 'procedure' as const : 'function' as const }))
}

export async function sqlDatabases(host: CatalogHost, connection: ResolvedConnection): Promise<SqlDatabaseInfo[]> {
  const result = await host.pgMeta(connection, `SELECT d.datname, pg_get_userbyid(d.datdba), pg_encoding_to_char(d.encoding), CASE WHEN has_database_privilege(d.datname, 'CONNECT') THEN pg_database_size(d.datname) END,
      d.datconnlimit, d.datname = current_database()
    FROM pg_database d WHERE NOT d.datistemplate ORDER BY d.datname`, [], 500, true)
  return result.rows.map(row => ({ name: String(row[0]), owner: String(row[1]), encoding: String(row[2]), sizeBytes: row[3] === null ? null : Number(row[3]), connectionLimit: Number(row[4]), current: Boolean(row[5]) }))
}

export async function sqlRoles(host: CatalogHost, connection: ResolvedConnection): Promise<SqlRoleInfo[]> {
  const result = await host.pgMeta(connection, `SELECT r.rolname, r.rolsuper, r.rolcreatedb, r.rolcreaterole, r.rolcanlogin, r.rolreplication, r.rolconnlimit,
      COALESCE((SELECT array_agg(g.rolname ORDER BY g.rolname) FROM pg_auth_members m JOIN pg_roles g ON g.oid = m.roleid WHERE m.member = r.oid), '{}')
    FROM pg_roles r WHERE r.rolname NOT LIKE 'pg\\_%' ORDER BY r.rolname`, [], 1000, true)
  return result.rows.map(row => ({
    name: String(row[0]), superuser: Boolean(row[1]), createDatabase: Boolean(row[2]), createRole: Boolean(row[3]), login: Boolean(row[4]), replication: Boolean(row[5]), connectionLimit: Number(row[6]),
    memberOf: nameList(row[7])
  }))
}

/** CREATE DATABASE cannot run inside a transaction, so it goes out as the only statement of the session. */
export async function sqlCreateDatabase(host: CatalogHost, connection: ResolvedConnection, input: { name: string; owner?: string; template?: string; encoding?: string }): Promise<{ ok: true }> {
  if (connection.readOnly) throw new OxeQueryError('read-only', 'This connection is read-only. Turn read-only off to create a database.')
  const encodings = ['UTF8', 'LATIN1', 'SQL_ASCII']
  if (input.encoding !== undefined && !encodings.includes(input.encoding)) throw new OxeQueryError('invalid', 'Choose UTF8, LATIN1 or SQL_ASCII.')
  const clauses = [
    input.owner ? `OWNER ${quoteIdentifier(input.owner)}` : '', input.template ? `TEMPLATE ${quoteIdentifier(input.template)}` : '', input.encoding ? `ENCODING '${input.encoding}'` : ''
  ].filter(Boolean).join(' ')
  await host.pgRun(connection, `CREATE DATABASE ${quoteIdentifier(input.name)} ${clauses}`.trim(), [], 1, false)
  return { ok: true }
}

export async function sqlDropDatabase(host: CatalogHost, connection: ResolvedConnection, input: { name: string; confirmed?: boolean }): Promise<{ ok: true }> {
  if (connection.readOnly) throw new OxeQueryError('read-only', 'This connection is read-only. Turn read-only off to drop a database.')
  if (input.name === connection.database) throw new OxeQueryError('invalid', 'This connection is using that database. Connect to another one to drop it.')
  if (!input.confirmed) throw new OxeQueryError('confirm', `Dropping the database "${input.name}" deletes all of its data for good.`)
  await host.pgRun(connection, `DROP DATABASE ${quoteIdentifier(input.name)}`, [], 1, false)
  return { ok: true }
}

/** Sequences, user types and triggers of one schema (each list capped, with a flag when it was). */
export async function sqlObjects(host: CatalogHost, connection: ResolvedConnection, schema: string): Promise<SqlObjects> {
  const cap = 1000
  const sequences = await host.pgMeta(connection, `SELECT sequencename, data_type::text, last_value FROM pg_sequences WHERE schemaname = $1 ORDER BY sequencename LIMIT ${cap + 1}`, [schema], cap + 1, true)
  const types = await host.pgMeta(connection, `SELECT t.oid::int, t.typname, t.typtype,
      (SELECT string_agg(e.enumlabel, chr(10) ORDER BY e.enumsortorder) FROM pg_enum e WHERE e.enumtypid = t.oid)
    FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE n.nspname = $1 AND t.typtype IN ('e', 'c', 'd', 'r') AND (t.typtype <> 'c' OR EXISTS (SELECT 1 FROM pg_class c WHERE c.oid = t.typrelid AND c.relkind = 'c'))
    ORDER BY t.typname LIMIT ${cap + 1}`, [schema], cap + 1, true)
  const triggers = await host.pgMeta(connection, `SELECT t.oid::int, t.tgname, c.relname, pg_get_triggerdef(t.oid), t.tgenabled <> 'D'
    FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE NOT t.tgisinternal AND n.nspname = $1 ORDER BY c.relname, t.tgname LIMIT ${cap + 1}`, [schema], cap + 1, true)
  const kinds: Record<string, SqlTypeInfo['kind']> = { e: 'enum', c: 'composite', d: 'domain', r: 'range' }
  return {
    sequences: sequences.rows.slice(0, cap).map(row => ({ name: String(row[0]), dataType: String(row[1]), lastValue: row[2] === null ? null : Number(row[2]) })),
    types: types.rows.slice(0, cap).map(row => ({ oid: Number(row[0]), name: String(row[1]), kind: kinds[String(row[2])] ?? 'composite', ...(row[3] ? { values: String(row[3]).split('\n') } : {}) })),
    triggers: triggers.rows.slice(0, cap).map(row => ({ oid: Number(row[0]), name: String(row[1]), table: String(row[2]), definition: String(row[3]), enabled: Boolean(row[4]) })),
    truncated: sequences.rows.length > cap || types.rows.length > cap || triggers.rows.length > cap
  }
}

export async function sqlExtensions(host: CatalogHost, connection: ResolvedConnection): Promise<SqlExtensionInfo[]> {
  const result = await host.pgMeta(connection, 'SELECT e.extname, e.extversion, n.nspname FROM pg_extension e JOIN pg_namespace n ON n.oid = e.extnamespace ORDER BY e.extname', [], 500, true)
  return result.rows.map(row => ({ name: String(row[0]), version: String(row[1]), schema: String(row[2]) }))
}

/** Finds tables, views, functions, sequences and types by name in every schema except the system ones. */
export async function sqlSearch(host: CatalogHost, connection: ResolvedConnection, query: string): Promise<SqlSearchResult> {
  const text = query.trim()
  if (text.length === 0) return { hits: [], truncated: false }
  const pattern = `%${text.replace(/[\\%_]/g, match => `\\${match}`)}%`
  const cap = 200
  const result = await host.pgMeta(connection, `
    SELECT * FROM (
      SELECT CASE c.relkind WHEN 'r' THEN 'table' WHEN 'v' THEN 'view' WHEN 'm' THEN 'materialized view' WHEN 'f' THEN 'foreign table' WHEN 'p' THEN 'partitioned table' ELSE 'sequence' END AS kind,
             n.nspname AS schema, c.relname AS name, NULL::text AS args, NULL::int AS oid
        FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE c.relkind IN ('r', 'v', 'm', 'f', 'p', 'S') AND c.relname ILIKE $1
      UNION ALL
      SELECT CASE p.prokind WHEN 'p' THEN 'procedure' ELSE 'function' END, n.nspname, p.proname, pg_get_function_identity_arguments(p.oid), p.oid::int
        FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE p.prokind IN ('f', 'p') AND p.proname ILIKE $1
      UNION ALL
      SELECT 'type', n.nspname, t.typname, NULL, t.oid::int
        FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace WHERE t.typtype IN ('e', 'd', 'r') AND t.typname ILIKE $1
    ) found WHERE schema NOT IN ('pg_catalog', 'information_schema') AND schema NOT LIKE 'pg\\_toast%' AND schema NOT LIKE 'pg\\_temp%'
    ORDER BY (lower(name) = lower($2)) DESC, name, schema LIMIT ${cap + 1}`, [pattern, text], cap + 1, true)
  return {
    hits: result.rows.slice(0, cap).map(row => ({
      kind: String(row[0]) as SqlSearchHit['kind'], schema: String(row[1]), name: String(row[2]),
      ...(row[3] !== null ? { args: String(row[3]) } : {}), ...(row[4] !== null ? { oid: Number(row[4]) } : {})
    })),
    truncated: result.rows.length > cap
  }
}
