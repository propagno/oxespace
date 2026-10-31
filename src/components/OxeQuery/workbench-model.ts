import type { ScriptStatementResult, SqlExplain, SqlFilter, SqlResult, SqlTableDetails, WorkspaceState } from '../../../shared/types/oxequery'
import { scanParameters } from '../../../shared/sqlText'
import type { GridSort } from './ResultGrid'
import { tq } from './catalog'

export const MAX_TABS = 12

/** One result of a run: a statement's rows, or the error that stopped the script there. */
export interface Output {
  id: string
  /** The first characters of the statement, for the result tab. */
  label: string
  /** Offset of the statement in the editor text, to put an error marker in the right place. */
  start: number
  /** The whole statement, for Export and for running it again. */
  text: string
  result?: SqlResult
  error?: OutputError
}

/** A failed run as the result pane shows it; `code` and `sqlState` choose the plain explanation above the server's words. */
export interface OutputError { message: string; code?: string; position?: number; sqlState?: string; hint?: string }

/** The error of a failed call with what QueryError needs to explain it, not only its message. */
export function outputError(cause: unknown, message: string): OutputError {
  const info = (typeof cause === 'object' && cause !== null ? cause : {}) as Partial<Record<'code' | 'sqlState' | 'hint', unknown>> & { position?: unknown }
  const text = (value: unknown): string | undefined => typeof value === 'string' && value ? value : undefined
  const code = text(info.code), sqlState = text(info.sqlState), hint = text(info.hint)
  return { message, ...(code ? { code } : {}), ...(typeof info.position === 'number' && info.position > 0 ? { position: info.position } : {}), ...(sqlState ? { sqlState } : {}), ...(hint ? { hint } : {}) }
}

export interface Browse { schema: string; table: string; offset: number; kind?: string; sort: GridSort | null; filters: SqlFilter[] }

export interface QueryTab {
  id: string
  title: string
  sql: string
  outputs: Output[]
  outputIndex: number
  browse: Browse | null
  details: SqlTableDetails | null
  explain: SqlExplain | null
  pinned?: boolean
}

let counter = 0
export const newTab = (sql = '', title?: string): QueryTab => ({ id: `q${++counter}`, title: title ?? tq('workbench.queryTitle', { number: counter }), sql, outputs: [], outputIndex: 0, browse: null, details: null, explain: null })

export function serializeWorkspace(tabs: QueryTab[], activeId: string, pinned: NonNullable<WorkspaceState['pinned']> = []): WorkspaceState {
  return { v: 1, activeId, tabs: tabs.map(tab => ({ id: tab.id, title: tab.title, sql: tab.sql, ...(tab.pinned ? { pinned: true } : {}) })), ...(pinned.length ? { pinned } : {}) }
}

/** Tabs from a saved workspace; the id counter moves past the restored ids so new tabs do not repeat them. */
export function restoreWorkspace(state: WorkspaceState): { tabs: QueryTab[]; activeId: string; pinned: NonNullable<WorkspaceState['pinned']> } {
  const tabs = state.tabs.slice(0, MAX_TABS).map((tab): QueryTab => ({ id: tab.id, title: tab.title, sql: tab.sql, outputs: [], outputIndex: 0, browse: null, details: null, explain: null, ...(tab.pinned ? { pinned: true } : {}) }))
  for (const tab of tabs) {
    const match = /^q(\d+)$/.exec(tab.id)
    if (match) counter = Math.max(counter, Number(match[1]))
  }
  return { tabs, activeId: tabs.some(tab => tab.id === state.activeId) ? state.activeId : tabs[0].id, pinned: state.pinned ?? [] }
}

/** The outputs of a script run, as tabs; a script that stopped on an error ends with that error. */
export function outputsFromScript(statements: ScriptStatementResult[], baseOffset: number, source: string): Output[] {
  return statements.map(entry => ({
    id: `s${entry.index}`, label: entry.sql.replace(/\s+/g, ' ').slice(0, 40) || tq('workbench.statementTitle', { number: entry.index + 1 }), start: baseOffset + entry.start, text: source.slice(entry.start, entry.end),
    ...(entry.result ? { result: entry.result } : {}),
    ...(entry.error ? { error: { message: entry.error.message, ...(entry.error.position ? { position: entry.error.position } : {}), ...(entry.error.sqlState ? { sqlState: entry.error.sqlState } : {}), ...(entry.error.hint ? { hint: entry.error.hint } : {}) } } : {})
  }))
}

export interface ParamValue { value: string; isNull: boolean }

/**
 * What a run needs before it can start. `named` parameters (:id) are rewritten to $1… by the
 * caller; `positional` ones ($1) go as they are. Returns the names still without a value.
 */
export function missingParameters(sql: string, values: Record<string, ParamValue>): { kind: 'none' | 'named' | 'positional'; names: string[]; missing: string[] } {
  const scan = scanParameters(sql)
  return { ...scan, missing: scan.names.filter(name => values[name] === undefined) }
}

/** Server-side filters a person edited: complete conditions only. */
export function completeFilters(filters: SqlFilter[]): SqlFilter[] {
  return filters.filter(filter => filter.column && (filter.op === 'null' || filter.op === 'notNull' || (filter.value ?? '') !== ''))
}

/** The conditions of the filter bar, in the order offered. */
export const FILTER_OPS: SqlFilter['op'][] = ['eq', 'ne', 'lt', 'lte', 'gt', 'gte', 'contains', 'startsWith', 'endsWith', 'null', 'notNull', 'in']
const SYMBOLS: Partial<Record<SqlFilter['op'], string>> = { lt: '<', lte: '≤', gt: '>', gte: '≥' }

/** What a condition is called in the filter bar; comparisons keep their symbol in every language. */
export const filterLabel = (op: SqlFilter['op']): string => SYMBOLS[op] ?? tq(`filter.op.${op as 'eq'}`)

/** True for the errors a dropped connection produces: the next statement can dial again, and a person may want to do it now. */
export function looksLikeLostConnection(message: string): boolean {
  return /connection terminated|connection closed|client has encountered a connection error|econnreset|econnrefused|epipe|etimedout|socket (hang up|closed)|server closed the connection|topology (was )?destroyed|pool (was )?cleared|tunnel|connection \d+ to \S+ closed|MongoNetworkError/i.test(message)
}
