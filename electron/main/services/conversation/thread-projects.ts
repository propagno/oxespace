import { basename } from 'node:path'
import { realpath } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import type { AppDatabase } from '../../db'
import type { ThreadProjectCatalog, ThreadProjectSummary } from '../../../../shared/types/thread'
import { projectIdentity } from '../memory/memory-project.service'
import { flagChanges, grantedCoordinators, relinkProjectCoordinators } from './coordinator-authority'

interface ProjectRow { id: string; identity: string; root_path: string; display_name: string; hidden: number }
interface ContextRow { project_id: string; root_path: string }

/** Persistent Thread directory registry. Code workspaces are never consulted. */
export class ThreadProjectService {
  /** `coordinatorsChanged` hears of conversations whose coordinator flag a relink changed (B1.4 · S7.5). */
  constructor(private readonly db: AppDatabase, private readonly coordinatorsChanged?: (ids: string[]) => void) {}

  catalog(): ThreadProjectCatalog {
    const rows = this.db.prepare('SELECT id, identity, root_path, display_name, hidden FROM thread_projects ORDER BY display_name COLLATE NOCASE').all() as ProjectRow[]
    const contexts = this.db.prepare('SELECT project_id, root_path FROM thread_project_contexts').all() as ContextRow[]
    const projects: ThreadProjectSummary[] = rows.map(row => ({
      projectId: row.id, displayName: row.display_name, identityLabel: row.identity,
      hidden: !!row.hidden,
      contexts: contexts.filter(context => context.project_id === row.id).map(context => ({ rootPath: context.root_path, label: basename(context.root_path) }))
    }))
    return { projects, unavailable: rows.filter(row => !existsSync(row.root_path)).map(row => row.id) }
  }

  async add(rootPath: string): Promise<ThreadProjectSummary> {
    const canonical = await realpath(rootPath)
    const identity = await projectIdentity(canonical)
    const existing = this.db.prepare('SELECT id FROM thread_projects WHERE identity = ?').get(identity) as { id: string } | undefined
    const projectId = existing?.id ?? randomUUID()
    const now = Date.now()
    this.db.transaction(() => {
      this.db.prepare(`INSERT INTO thread_projects (id, identity, root_path, display_name, hidden, created_at, updated_at)
        VALUES (?, ?, ?, ?, 0, ?, ?) ON CONFLICT(id) DO UPDATE SET hidden=0, updated_at=excluded.updated_at`)
        .run(projectId, identity, canonical, basename(canonical), now, now)
      this.db.prepare('INSERT OR IGNORE INTO thread_project_contexts (project_id, root_path) VALUES (?, ?)').run(projectId, canonical)
    })()
    return this.catalog().projects.find(project => project.projectId === projectId)!
  }

  context(projectId: string, rootPath?: string): { projectId: string; rootPath: string } {
    const row = this.db.prepare('SELECT id, root_path FROM thread_projects WHERE id = ? AND hidden = 0').get(projectId) as { id: string; root_path: string } | undefined
    if (!row) throw Error('OxeChat project is unavailable. Restore or add the project first.')
    const selected = rootPath ?? row.root_path
    if (!this.db.prepare('SELECT 1 FROM thread_project_contexts WHERE project_id = ? AND root_path = ?').get(projectId, selected)) throw Error('Directory does not belong to this Thread project')
    if (!existsSync(selected)) throw Error('Project directory is unavailable. Relink the project before starting a conversation.')
    return { projectId, rootPath: selected }
  }

  /** Registers another checkout of the project (a worktree created for a conversation). */
  addContext(projectId: string, rootPath: string): void {
    if (!this.db.prepare('SELECT 1 FROM thread_projects WHERE id = ?').get(projectId)) throw Error('OxeChat project not found')
    this.db.prepare('INSERT OR IGNORE INTO thread_project_contexts (project_id, root_path) VALUES (?, ?)').run(projectId, rootPath)
  }

  /** Drops a registered checkout; the project's own root is never removed this way. */
  removeContext(projectId: string, rootPath: string): void {
    this.db.prepare('DELETE FROM thread_project_contexts WHERE project_id = ? AND root_path = ? AND root_path <> (SELECT root_path FROM thread_projects WHERE id = ?)').run(projectId, rootPath, projectId)
  }

  setHidden(projectId: string, hidden: boolean): void {
    const result = this.db.prepare('UPDATE thread_projects SET hidden = ?, updated_at = ? WHERE id = ?').run(hidden ? 1 : 0, Date.now(), projectId)
    if (!result.changes) throw Error('OxeChat project not found')
  }

  async relink(projectId: string, rootPath: string): Promise<ThreadProjectSummary> {
    const canonical = await realpath(rootPath)
    const identity = await projectIdentity(canonical)
    const current = this.db.prepare('SELECT identity, root_path FROM thread_projects WHERE id = ?').get(projectId) as { identity: string; root_path: string } | undefined
    if (!current) throw Error('OxeChat project not found')
    if (existsSync(current.root_path) && identity !== current.identity) throw Error('Choose a directory from the same project')
    const owner = this.db.prepare('SELECT id FROM thread_projects WHERE identity = ? AND id <> ?').get(identity, projectId) as { id: string } | undefined
    if (owner) throw Error('This directory belongs to another OxeChat project')
    const now = Date.now()
    let coordinators: string[] = []
    this.db.transaction(() => {
      const granted = grantedCoordinators(this.db)
      this.db.prepare('UPDATE thread_projects SET identity = ?, root_path = ?, display_name = ?, hidden = 0, updated_at = ? WHERE id = ?')
        .run(identity, canonical, basename(canonical), now, projectId)
      this.db.prepare('INSERT OR IGNORE INTO thread_project_contexts (project_id, root_path) VALUES (?, ?)').run(projectId, canonical)
      if (canonical !== current.root_path) this.db.prepare('DELETE FROM thread_project_contexts WHERE project_id = ? AND root_path = ?').run(projectId, current.root_path)
      this.db.prepare(`UPDATE conversation_threads SET data_json = json_set(data_json, '$.rootPath', ?) WHERE thread_project_id = ? AND json_extract(data_json, '$.rootPath') = ?`)
        .run(canonical, projectId, current.root_path)
      // The project's coordinator rows follow the new root and identity, in this transaction.
      relinkProjectCoordinators(this.db, projectId, identity, canonical, now)
      coordinators = flagChanges(granted, grantedCoordinators(this.db))
    })()
    if (coordinators.length) this.coordinatorsChanged?.(coordinators)
    return this.catalog().projects.find(project => project.projectId === projectId)!
  }
}

export function threadProjectCatalog(db: AppDatabase): ThreadProjectCatalog {
  return new ThreadProjectService(db).catalog()
}
