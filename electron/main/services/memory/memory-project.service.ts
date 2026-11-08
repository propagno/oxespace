import { randomUUID } from 'node:crypto'
import { basename, dirname } from 'node:path'
import type { AppDatabase } from '../../db'
import type { MemoryContext, MemorySettings } from '../../../../shared/types/memory'
import { integrationBlocked } from '../policy'
import { projectIdentity } from '../project-identity'

// The identity probe moved to ../project-identity (R0a); the retry helper stays reachable here for its unit test.
export { retryIdentityProbe } from '../project-identity'

export const DEFAULT_MEMORY_SETTINGS: MemorySettings = { enabled: false, automaticCapture: false, automaticContext: false }

export class MemoryProjectService {
  constructor(private readonly db: AppDatabase) {}

  async resolve(cwd: string): Promise<MemoryContext> {
    const identity = await projectIdentity(cwd)
    // No await between lookup and insert: concurrent worktree resolutions converge.
    let row = this.db.prepare('SELECT id FROM memory_projects WHERE identity = ?').get(identity) as { id: string } | undefined
    if (!row) {
      row = { id: randomUUID() }
      this.db.prepare('INSERT INTO memory_projects (id, identity) VALUES (?, ?)').run(row.id, identity)
    }
    return { projectId: row.id, workspace: 'oxespace-local', project: `p-${row.id}`, cwd }
  }

  async workspace(workspaceId: string, paneId?: string): Promise<MemoryContext> {
    const ws = this.db.prepare('SELECT root_path FROM workspaces WHERE id = ?').get(workspaceId) as { root_path: string } | undefined
    if (!ws) throw new Error('Memory requires an existing, explicit workspace')
    if (!paneId) return this.resolve(ws.root_path)
    const pane = this.db.prepare('SELECT root_path FROM panes WHERE id = ? AND workspace_id = ?').get(paneId, workspaceId) as { root_path: string | null } | undefined
    if (!pane) throw new Error('Memory pane does not belong to this workspace')
    return this.resolve(pane.root_path ?? ws.root_path)
  }

  /** Stored settings, forced off while organization policy blocks `memory` for the project (stored values are kept). */
  settings(projectId: string): MemorySettings {
    const row = this.db.prepare('SELECT identity, settings_json FROM memory_projects WHERE id = ?').get(projectId) as { identity: string; settings_json: string } | undefined
    if (!row) return { ...DEFAULT_MEMORY_SETTINGS }
    if (this.policyBlocked(row.identity)) return { ...DEFAULT_MEMORY_SETTINGS }
    return { ...DEFAULT_MEMORY_SETTINGS, ...JSON.parse(row.settings_json) }
  }

  /** The policy message when `memory` is blocked for the project; its identity is the Git common dir or the folder. */
  policyBlocked(identity: string): string | undefined {
    const root = basename(identity) === '.git' ? dirname(identity) : identity
    return integrationBlocked('memory', 'Shared memory', root)
  }

  /** Policy decides what may rise to the team: `memory:team` (an `integration.use` rule), and nothing at all if `memory` is blocked. */
  teamBlocked(projectId: string): string | undefined {
    const row = this.db.prepare('SELECT identity FROM memory_projects WHERE id = ?').get(projectId) as { identity: string } | undefined
    if (!row) return undefined
    const root = basename(row.identity) === '.git' ? dirname(row.identity) : row.identity
    return integrationBlocked('memory', 'Shared memory', root) ?? integrationBlocked('memory:team', 'Sharing memory with the team', root)
  }

  configure(projectId: string, settings: MemorySettings): void {
    if (settings.enabled) {
      const row = this.db.prepare('SELECT identity FROM memory_projects WHERE id = ?').get(projectId) as { identity: string } | undefined
      const blocked = row && this.policyBlocked(row.identity)
      if (blocked) throw new Error(blocked)
    }
    this.db.prepare('UPDATE memory_projects SET settings_json = ? WHERE id = ?').run(JSON.stringify(settings), projectId)
  }

  anyEnabled(): boolean {
    return (this.db.prepare('SELECT settings_json FROM memory_projects').all() as { settings_json: string }[])
      .some(row => (JSON.parse(row.settings_json) as MemorySettings).enabled)
  }
}
