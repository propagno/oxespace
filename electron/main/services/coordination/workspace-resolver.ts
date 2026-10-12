import { realpath } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { WorkspaceService } from '../workspace.service'
import { projectIdentity } from '../memory/memory-project.service'
import { isAbsolute } from 'node:path'
const exec = promisify(execFile)

/** Trusted UI registration only; MCP may discover already-authorized targets. */
export async function registerLocalRepository(workspace: WorkspaceService, rootPath: string) {
  if (typeof rootPath !== 'string' || !isAbsolute(rootPath) || rootPath.length > 4096 || /[\0\r\n]/.test(rootPath)) throw new Error('Invalid repository path')
  const root = await realpath(rootPath)
  const info = await exec('git', ['rev-parse', '--show-toplevel'], { cwd: root, windowsHide: true, timeout: 10000 })
  const top = await realpath(info.stdout.trim())
  const project = await projectIdentity(top)
  for (const existing of workspace.list()) {
    try { if (await projectIdentity(existing.rootPath) === project) return { workspace: existing, project } } catch { /* stale workspace */ }
  }
  // create() activates a workspace; retain the user's current view.
  const active = workspace.list().find(w => w.isActive)
  const created = workspace.create({ rootPath: top, layout: '1x1', autoStart: false })
  if (active) workspace.setActive(active.id)
  return { workspace: created, project }
}
