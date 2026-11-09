import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import type { AppDatabase } from '../../db/index'
import type { DataExportState, RemovedFeatureId, RemovedFeatureUse } from '../../../../shared/types/ipc'
import { writePrivateJson } from '../private-json'

/**
 * R0b · the one-time export of what the features removed in 1.5.0 kept, to <userData>/exports/1.5-removed-<ts>.json.
 * It only reads: the collections under each open workspace's .oxespace/requests, the memory tables of the app's
 * database and the automations store's own database (opened read-only). Secret values are never read, only the names
 * an environment lists. The file is written with writePrivateJson (a temporary file that helper moves into place), so
 * a failed write leaves no partial file. Nothing here deletes, moves or rewrites a file of the person.
 */

/** v1.4.3 shipped database version 91: a database below 92 before the first 1.5.0 start is a 1.4 upgrade. */
export const FIRST_1_5_0_DB_VERSION = 92

const EXPORT_FILE = /^1\.5-removed-(\d+)\.json$/
const STATE_FILE = 'state.json'
const MAX_DEPTH = 6
const MAX_FILES_PER_WORKSPACE = 2000
const MAX_FILE_BYTES = 1024 * 1024
const SECRETS_NOTE = "Secret values were not copied into this file, only their names. The values stay in OXESpace's own data on this computer."
const REMOVED_IDS: readonly RemovedFeatureId[] = ['codegraph', 'semantic', 'rtk', 'memory', 'linear', 'teams', 'automations', 'docs', 'oxepost', 'oxepod', 'work']

interface ExportDeps { db: AppDatabase; userData: string; workspaceRoots: () => string[] }
interface StoredState { shownNotice?: boolean; previousDbVersion?: number; done?: boolean }
interface RequestFile { path: string; text: string }
interface Collection { root: string; requests: RequestFile[]; environments: Array<Record<string, unknown>> }
interface Sections {
  oxepostCollections: Collection[]
  memories: { projects: unknown[]; notes: unknown[]; noteUses: unknown[]; runtime: unknown[] }
  automations: { automations: unknown[]; runs: unknown[] }
}

/** The last failure of this app run, per userData folder (HML-678-2); a success clears it. */
const lastErrors = new Map<string, string>()

const exportsDir = (userData: string): string => join(userData, 'exports')
const requestsDir = (root: string): string => join(root, '.oxespace', 'requests')

function readState(userData: string): StoredState {
  try {
    const value = JSON.parse(readFileSync(join(exportsDir(userData), STATE_FILE), 'utf8')) as unknown
    return value && typeof value === 'object' && !Array.isArray(value) ? value as StoredState : {}
  } catch { return {} }
}

function ensureExportsDir(userData: string): string {
  const dir = exportsDir(userData)
  if (existsSync(dir) && !statSync(dir).isDirectory()) throw new Error('The exports folder in the app data is a file, not a folder')
  mkdirSync(dir, { recursive: true })
  return dir
}

function writeState(userData: string, patch: StoredState): void {
  const dir = ensureExportsDir(userData)
  writeFileSync(join(dir, STATE_FILE), JSON.stringify({ ...readState(userData), ...patch }, null, 2) + '\n', { mode: 0o600 })
}

function newestExport(userData: string): { path: string; at: number } | null {
  const dir = exportsDir(userData)
  let names: string[]
  try { names = readdirSync(dir) } catch { return null }
  let best: { path: string; at: number } | null = null
  for (const name of names) {
    const match = EXPORT_FILE.exec(name)
    if (!match) continue
    const at = Number(match[1])
    if (!best || at > best.at) best = { path: join(dir, name), at }
  }
  return best
}

function matches(db: AppDatabase, sql: string): boolean {
  try { return db.prepare(sql).get() !== undefined } catch { return false }
}

const hasRows = (db: AppDatabase, table: string): boolean => matches(db, `SELECT 1 FROM "${table}" LIMIT 1`)

/** Every row of a table; a missing table is an empty list. */
function rows(db: AppDatabase, table: string): unknown[] {
  try {
    if (db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(table) === undefined) return []
    return db.prepare(`SELECT * FROM "${table}"`).all()
  } catch { return [] }
}

function roots(deps: ExportDeps): string[] {
  try { return [...new Set(deps.workspaceRoots().filter(root => typeof root === 'string' && root.length > 0))] } catch { return [] }
}

function hasEntries(dir: string): boolean {
  try { return statSync(dir).isDirectory() && readdirSync(dir).length > 0 } catch { return false }
}

function readText(file: string): string | null {
  try {
    const info = lstatSync(file)
    if (!info.isFile() || info.size > MAX_FILE_BYTES) return null
    return readFileSync(file, 'utf8')
  } catch { return null }
}

/** An environment with its variables and the NAMES of its secrets; a secret value is never read. */
function environmentOf(path: string, text: string): Record<string, unknown> {
  try {
    const value = JSON.parse(text) as Record<string, unknown>
    if (!value || typeof value !== 'object' || Array.isArray(value)) return { path, problem: 'This environment file is not a JSON object' }
    return {
      path,
      name: typeof value.name === 'string' ? value.name : null,
      production: value.production === true,
      variables: value.variables && typeof value.variables === 'object' && !Array.isArray(value.variables) ? value.variables : {},
      secretNames: Array.isArray(value.secrets) ? value.secrets.filter((name): name is string => typeof name === 'string') : []
    }
  } catch { return { path, problem: 'This environment file is not valid JSON' } }
}

function readCollection(root: string): Collection | null {
  const dir = requestsDir(root)
  try { if (!statSync(dir).isDirectory()) return null } catch { return null }
  const collection: Collection = { root, requests: [], environments: [] }
  const walk = (folder: string, segments: string[]): void => {
    let entries
    try { entries = readdirSync(folder, { withFileTypes: true }) } catch { return }
    entries.sort((a, b) => a.name.localeCompare(b.name))
    for (const entry of entries) {
      if (collection.requests.length + collection.environments.length >= MAX_FILES_PER_WORKSPACE) return
      if (entry.isSymbolicLink()) continue
      const full = join(folder, entry.name)
      if (entry.isDirectory()) {
        if (segments.length + 1 < MAX_DEPTH) walk(full, [...segments, entry.name])
        continue
      }
      if (!entry.isFile()) continue
      const text = readText(full)
      if (text === null) continue
      const path = [...segments, entry.name].join('/')
      if (segments[0] === 'environments' && entry.name.endsWith('.json')) collection.environments.push(environmentOf(path, text))
      else collection.requests.push({ path, text })
    }
  }
  walk(dir, [])
  return collection
}

/** The automations store's own database, opened read-only when it exists. */
function readAutomations(userData: string): Sections['automations'] {
  const file = join(userData, 'automations.sqlite3')
  if (!existsSync(file)) return { automations: [], runs: [] }
  let store: Database.Database
  try { store = new Database(file, { readonly: true, fileMustExist: true }) } catch { return { automations: [], runs: [] } }
  try {
    const handle = store as unknown as AppDatabase
    return { automations: rows(handle, 'automations'), runs: rows(handle, 'automation_runs') }
  } finally { store.close() }
}

function collect(deps: ExportDeps): Sections {
  return {
    oxepostCollections: roots(deps).map(root => readCollection(root))
      .filter((entry): entry is Collection => entry !== null && (entry.requests.length > 0 || entry.environments.length > 0)),
    memories: {
      projects: rows(deps.db, 'memory_projects'),
      notes: rows(deps.db, 'memory_notes'),
      noteUses: rows(deps.db, 'memory_note_uses'),
      runtime: rows(deps.db, 'memory_runtime')
    },
    automations: readAutomations(deps.userData)
  }
}

const isEmpty = (sections: Sections): boolean => sections.oxepostCollections.length === 0
  && Object.values(sections.memories).every(list => list.length === 0)
  && sections.automations.automations.length === 0 && sections.automations.runs.length === 0

function semanticProjectsSaved(userData: string): boolean {
  try {
    const value = JSON.parse(readFileSync(join(userData, 'semantic-projects.json'), 'utf8')) as { roots?: unknown }
    return Array.isArray(value.roots) && value.roots.length > 0
  } catch { return false }
}

/** Whether this install used a removed feature: from its rows, files and settings. Only booleans leave main. */
function featureUse(deps: ExportDeps, id: RemovedFeatureId): { hadData: boolean; hadSettings: boolean } {
  const { db, userData } = deps
  switch (id) {
    case 'codegraph': return { hadData: roots(deps).some(root => existsSync(join(root, '.oxe', 'codegraph.db'))), hadSettings: false }
    case 'semantic': return { hadData: hasRows(db, 'semantic_documents') || hasRows(db, 'semantic_embeddings'), hadSettings: semanticProjectsSaved(userData) }
    case 'rtk': return { hadData: false, hadSettings: existsSync(join(userData, 'bin', process.platform === 'win32' ? 'rtk.exe' : 'rtk')) }
    case 'memory': return {
      hadData: hasRows(db, 'memory_projects') || hasRows(db, 'memory_notes'),
      hadSettings: hasRows(db, 'memory_runtime') || matches(db, `SELECT 1 FROM memory_projects WHERE settings_json LIKE '%"enabled":true%' LIMIT 1`)
    }
    case 'linear': return { hadData: false, hadSettings: matches(db, "SELECT 1 FROM secure_credentials WHERE provider = 'linear' LIMIT 1") }
    case 'teams': return { hadData: hasRows(db, 'agent_teams'), hadSettings: false }
    case 'automations': {
      const stored = readAutomations(userData)
      return { hadData: stored.automations.length > 0 || stored.runs.length > 0, hadSettings: false }
    }
    case 'docs': return { hadData: hasRows(db, 'documentation_jobs'), hadSettings: false }
    case 'oxepost': return { hadData: roots(deps).some(root => hasEntries(requestsDir(root))), hadSettings: false }
    case 'work': return { hadData: hasRows(db, 'work_runs'), hadSettings: false }
    default: return { hadData: false, hadSettings: false }
  }
}

/** The version the app database had before this start migrated it; 0 when there is none or it cannot be read. */
export function peekDatabaseVersion(databasePath: string): number {
  if (!existsSync(databasePath)) return 0
  try {
    const handle = new Database(databasePath, { readonly: true, fileMustExist: true })
    try {
      const version = handle.pragma('user_version', { simple: true })
      return typeof version === 'number' ? version : 0
    } finally { handle.close() }
  } catch { return 0 }
}

/** The full path of the newest export file, or null. */
export function latestRemovedFeaturesExport(userData: string): string | null {
  return newestExport(userData)?.path ?? null
}

/**
 * Writes the export once. If an export file exists it returns it (created:false); force:true always writes a new one.
 * With nothing to save no file is written and the run is recorded so it is not retried. A failure never throws: it
 * returns the error, keeps it for the state, and sets no marker, so the next start tries again.
 */
export async function exportRemovedFeatures(deps: { db: AppDatabase; userData: string; workspaceRoots: () => string[]; previousDbVersion?: number; now?: () => number; force?: boolean }): Promise<{ path: string | null; created: boolean; error?: string }> {
  const { userData } = deps
  try {
    if (typeof deps.previousDbVersion === 'number' && readState(userData).previousDbVersion === undefined) {
      writeState(userData, { previousDbVersion: deps.previousDbVersion })
    }
    if (!deps.force) {
      const existing = newestExport(userData)
      if (existing) return { path: existing.path, created: false }
      if (readState(userData).done === true) return { path: null, created: false }
    }
    const sections = collect(deps)
    if (isEmpty(sections)) {
      writeState(userData, { done: true })
      lastErrors.delete(userData)
      return { path: null, created: false }
    }
    const dir = ensureExportsDir(userData)
    const at = (deps.now ?? Date.now)()
    const path = join(dir, `1.5-removed-${at}.json`)
    await writePrivateJson(path, { format: 'oxespace-1.5-removed-features', version: 1, exportedAt: new Date(at).toISOString(), secretsNote: SECRETS_NOTE, sections })
    try { writeState(userData, { done: true }) } catch { /* the export file itself marks the run */ }
    lastErrors.delete(userData)
    return { path, created: true }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    lastErrors.set(userData, message)
    return { path: null, created: false, error: message }
  }
}

/** What FE-R0b shows: the newest file, whether the notice was shown, the 1.4 upgrade flag, the last error, and ids. */
export function removedFeaturesState(deps: { db: AppDatabase; userData: string; workspaceRoots: () => string[] }): DataExportState {
  const newest = newestExport(deps.userData)
  const stored = readState(deps.userData)
  const version = stored.previousDbVersion
  const removed: RemovedFeatureUse[] = []
  for (const id of REMOVED_IDS) {
    const use = featureUse(deps, id)
    if (use.hadData || use.hadSettings) removed.push({ id, hadData: use.hadData, hadSettings: use.hadSettings })
  }
  return {
    file: newest?.path ?? null,
    exportedAt: newest ? new Date(newest.at).toISOString() : null,
    shownNotice: stored.shownNotice === true,
    upgrade: typeof version === 'number' && version >= 1 && version < FIRST_1_5_0_DB_VERSION,
    error: lastErrors.get(deps.userData) ?? null,
    removed
  }
}

/** Records that the person saw the notice, in <userData>/exports/state.json. Idempotent. */
export function markRemovedFeaturesNoticeShown(userData: string): void {
  if (readState(userData).shownNotice === true) return
  writeState(userData, { shownNotice: true })
}
