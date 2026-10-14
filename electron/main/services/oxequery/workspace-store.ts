import type { AppDatabase } from '../../db'
import type { WorkspaceState } from '../../../../shared/types/oxequery'

export const MAX_WORKSPACE_TABS = 12
const MAX_TAB_SQL = 200_000
const MAX_TOTAL = 1_500_000

export class WorkspaceInputError extends Error {}

/** What is accepted from the page as a workspace: a bounded list of tabs, nothing else. */
export function normalizeWorkspace(value: unknown): WorkspaceState {
  const raw = value && typeof value === 'object' ? value as Record<string, unknown> : {}
  if (!Array.isArray(raw.tabs)) throw new WorkspaceInputError('A workspace needs a list of tabs.')
  const tabs: WorkspaceState['tabs'] = []
  let total = 0
  for (const entry of raw.tabs.slice(0, MAX_WORKSPACE_TABS)) {
    const tab = entry && typeof entry === 'object' ? entry as Record<string, unknown> : {}
    if (typeof tab.id !== 'string' || !/^[\w-]{1,40}$/.test(tab.id)) throw new WorkspaceInputError('A tab has an invalid id.')
    const title = typeof tab.title === 'string' ? tab.title.slice(0, 120) : 'Query'
    const sql = typeof tab.sql === 'string' ? tab.sql.slice(0, MAX_TAB_SQL) : ''
    total += sql.length + title.length
    if (total > MAX_TOTAL) throw new WorkspaceInputError('The workspace is too large to save.')
    tabs.push({ id: tab.id, title, sql, ...(typeof tab.pinned === 'boolean' && tab.pinned ? { pinned: true } : {}) })
  }
  if (tabs.length === 0) throw new WorkspaceInputError('A workspace needs at least one tab.')
  const activeId = typeof raw.activeId === 'string' && tabs.some(tab => tab.id === raw.activeId) ? raw.activeId : tabs[0].id
  return { v: 1, activeId, tabs }
}

/** The query tabs of each connection, kept in the app database. */
export class WorkspaceStore {
  constructor(private readonly db: AppDatabase, private readonly now: () => number = Date.now) {}

  load(connectionId: string): WorkspaceState | null {
    const row = this.db.prepare('SELECT state_json FROM oxequery_workspaces WHERE connection_id = ?').get(connectionId) as { state_json: string } | undefined
    if (!row) return null
    try { return normalizeWorkspace(JSON.parse(row.state_json)) } catch { return null }
  }

  save(connectionId: string, state: unknown): void {
    const clean = normalizeWorkspace(state)
    this.db.prepare(`INSERT INTO oxequery_workspaces (connection_id, state_json, updated_at) VALUES (?, ?, ?)
      ON CONFLICT(connection_id) DO UPDATE SET state_json = excluded.state_json, updated_at = excluded.updated_at`).run(connectionId, JSON.stringify(clean), this.now())
  }
}
