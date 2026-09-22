import { basename } from 'node:path'
import type { AppDatabase } from '../../db'
import type { ThreadProjectCatalog, ThreadProjectSummary } from '../../../../shared/types/thread'
import { MemoryProjectService } from '../memory/memory-project.service'

export async function threadProjectCatalog(db: AppDatabase): Promise<ThreadProjectCatalog> {
  const resolver = new MemoryProjectService(db)
  const contexts = db.prepare(`SELECT w.id AS workspaceId, NULL AS paneId, w.root_path AS rootPath, w.name AS label FROM workspaces w
    UNION ALL SELECT p.workspace_id, p.id, p.root_path, COALESCE(p.display_name, w.name) FROM panes p
    JOIN workspaces w ON w.id=p.workspace_id WHERE p.type='terminal' AND p.root_path IS NOT NULL`).all() as
    { workspaceId: string; paneId?: string | null; rootPath: string; label: string }[]
  const groups = new Map<string, ThreadProjectSummary>()
  const unavailable = new Set<string>()
  let cursor = 0
  await Promise.all(Array.from({ length: Math.min(4, contexts.length) }, async () => {
    while (cursor < contexts.length) {
      const context = contexts[cursor++]
      try {
        const { projectId } = await resolver.resolve(context.rootPath)
        const row = db.prepare('SELECT identity FROM memory_projects WHERE id=?').get(projectId) as { identity: string }
        const identityLabel = row.identity.replace(/[\\/]\.git$/, '')
        const group = groups.get(projectId) ?? { projectId, displayName: basename(identityLabel), identityLabel, contexts: [] }
        group.contexts.push({ ...context, paneId: context.paneId ?? undefined })
        groups.set(projectId, group)
      } catch { unavailable.add(context.workspaceId) }
    }
  }))
  return { projects: [...groups.values()].sort((a, b) => a.displayName.localeCompare(b.displayName)), unavailable: [...unavailable] }
}
