import { execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { realpath } from 'node:fs/promises'
import { resolve } from 'node:path'
import { promisify } from 'node:util'
import type { AppDatabase } from '../../db'
import type { MemoryContext, MemorySettings } from '../../../../shared/types/memory'

const exec = promisify(execFile)
export const DEFAULT_MEMORY_SETTINGS: MemorySettings = { enabled: false, automaticCapture: false, automaticContext: false }

export async function projectIdentity(cwd: string): Promise<string> {
  const root = await realpath(cwd)
  let identity = root
  try {
    const result = await exec('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], { cwd: root, timeout: 2000, windowsHide: true })
    identity = await realpath(resolve(root, result.stdout.trim()))
  } catch (error) {
    // Timeouts, missing Git and permission errors must not mint a second identity.
    if (!String((error as { stderr?: string }).stderr).includes('not a git repository')) throw error
  }
  return process.platform === 'win32' ? identity.replace(/\\/g, '/').toLowerCase() : identity
}

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

  settings(projectId: string): MemorySettings {
    const row = this.db.prepare('SELECT settings_json FROM memory_projects WHERE id = ?').get(projectId) as { settings_json: string } | undefined
    return row ? { ...DEFAULT_MEMORY_SETTINGS, ...JSON.parse(row.settings_json) } : { ...DEFAULT_MEMORY_SETTINGS }
  }

  configure(projectId: string, settings: MemorySettings): void {
    this.db.prepare('UPDATE memory_projects SET settings_json = ? WHERE id = ?').run(JSON.stringify(settings), projectId)
  }

  anyEnabled(): boolean {
    return (this.db.prepare('SELECT settings_json FROM memory_projects').all() as { settings_json: string }[])
      .some(row => (JSON.parse(row.settings_json) as MemorySettings).enabled)
  }
}
