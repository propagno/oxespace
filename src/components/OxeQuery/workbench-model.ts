import type { ScriptStatementResult, SqlExplain, SqlFilter, SqlResult, SqlTableDetails, WorkspaceState } from '../../../shared/types/oxequery'
import { scanParameters } from '../../../shared/sqlText'
import type { GridSort } from './ResultGrid'

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
  error?: { message: string; position?: number; sqlState?: string; hint?: string }
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
export const newTab = (sql = '', title?: string): QueryTab => ({ id: `q${++counter}`, title: title ?? `Query ${counter}`, sql, outputs: [], outputIndex: 0, browse: null, details: null, explain: null })

export function serializeWorkspace(tabs: QueryTab[], activeId: string): WorkspaceState {
  return { v: 1, activeId, tabs: tabs.map(tab => ({ id: tab.id, title: tab.title, sql: tab.sql, ...(tab.pinned ? { pinned: true } : {}) })) }
}

/** Tabs from a saved workspace; the id counter moves past the restored ids so new tabs do not repeat them. */
export function restoreWorkspace(state: WorkspaceState): { tabs: QueryTab[]; activeId: string } {
  const tabs = state.tabs.slice(0, MAX_TABS).map((tab): QueryTab => ({ id: tab.id, title: tab.title, sql: tab.sql, outputs: [], outputIndex: 0, browse: null, details: null, explain: null, ...(tab.pinned ? { pinned: true } : {}) }))
  for (const tab of tabs) {
    const match = /^q(\d+)$/.exec(tab.id)
    if (match) counter = Math.max(counter, Number(match[1]))
  }
  return { tabs, activeId: tabs.some(tab => tab.id === state.activeId) ? state.activeId : tabs[0].id }
}

/** The outputs of a script run, as tabs; a script that stopped on an error ends with that error. */
export function outputsFromScript(statements: ScriptStatementResult[], baseOffset: number, source: string): Output[] {
  return statements.map(entry => ({
    id: `s${entry.index}`, label: entry.sql.replace(/\s+/g, ' ').slice(0, 40) || `Statement ${entry.index + 1}`, start: baseOffset + entry.start, text: source.slice(entry.start, entry.end),
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

export const FILTER_LABELS: Record<SqlFilter['op'], string> = {
  eq: 'equals', ne: 'is not', lt: '<', lte: '≤', gt: '>', gte: '≥', contains: 'contains', startsWith: 'starts with', endsWith: 'ends with', null: 'is empty', notNull: 'is not empty', in: 'is one of'
}
