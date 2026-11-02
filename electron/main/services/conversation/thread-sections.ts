import type { AppDatabase } from '../../db'
import { isThreadSectionsWorkspaceId, normalizeThreadSections, threadSectionsRefusal } from '../../../../shared/thread-sections'
import type { ThreadSection, ThreadSections, ThreadSectionsSaveResult } from '../../../../shared/types/thread-sections'

const THREAD_PREFIX = 'thread:'

/** Where a conversation workspace id lives: a Thread project (`thread:<project id>`) or a Code workspace. */
function owner(workspaceId: string): { codeWorkspaceId: string | null; threadProjectId: string | null } {
  return workspaceId.startsWith(THREAD_PREFIX)
    ? { codeWorkspaceId: null, threadProjectId: workspaceId.slice(THREAD_PREFIX.length) }
    : { codeWorkspaceId: workspaceId, threadProjectId: null }
}

/**
 * F13 · The sections of the conversation list, per conversation workspace (the `workspaceId` a conversation carries).
 * A save replaces the workspace's whole state in one transaction, or, refused, changes nothing.
 */
export class ThreadSectionsStore {
  constructor(private readonly db: AppDatabase) {}

  /** True when the id names a Code workspace or a Thread project that exists. */
  exists(workspaceId: string): boolean {
    const { codeWorkspaceId, threadProjectId } = owner(workspaceId)
    if (threadProjectId !== null) return !!threadProjectId && !!this.db.prepare('SELECT 1 FROM thread_projects WHERE id = ?').get(threadProjectId)
    return !!this.db.prepare('SELECT 1 FROM workspaces WHERE id = ?').get(codeWorkspaceId)
  }

  list(workspaceId: string): ThreadSections {
    const sections = (this.db.prepare('SELECT id, name, position, collapsed FROM thread_sections WHERE workspace_id = ? ORDER BY position, id')
      .all(workspaceId) as { id: string; name: string; position: number; collapsed: number }[])
      .map((row): ThreadSection => ({ id: row.id, name: row.name, order: row.position, collapsed: row.collapsed === 1 }))
    const rows = this.db.prepare('SELECT conversation_id, section_id FROM thread_section_assignments WHERE workspace_id = ? ORDER BY conversation_id')
      .all(workspaceId) as { conversation_id: string; section_id: string }[]
    return { sections, assignments: Object.fromEntries(rows.map(row => [row.conversation_id, row.section_id])) }
  }

  save(workspaceId: unknown, input: unknown): ThreadSectionsSaveResult {
    if (!isThreadSectionsWorkspaceId(workspaceId)) return threadSectionsRefusal('invalid')
    return this.db.transaction((): ThreadSectionsSaveResult => {
      if (!this.exists(workspaceId)) return threadSectionsRefusal('unknownWorkspace')
      const { codeWorkspaceId, threadProjectId } = owner(workspaceId)
      // A Thread project's list holds every conversation of that project, including a delegated or Work-run one that
      // carries a Code workspace id; a Code workspace's list, the conversations of that workspace.
      const rows = threadProjectId === null
        ? this.db.prepare('SELECT id FROM conversation_threads WHERE workspace_id = ?').all(workspaceId)
        : this.db.prepare('SELECT id FROM conversation_threads WHERE workspace_id = ? OR thread_project_id = ?').all(workspaceId, threadProjectId)
      const conversations = new Set((rows as { id: string }[]).map(row => row.id))
      const checked = normalizeThreadSections(input, id => conversations.has(id))
      if (!checked.ok) return checked
      this.db.prepare('DELETE FROM thread_section_assignments WHERE workspace_id = ?').run(workspaceId)
      this.db.prepare('DELETE FROM thread_sections WHERE workspace_id = ?').run(workspaceId)
      const section = this.db.prepare('INSERT INTO thread_sections (workspace_id, code_workspace_id, thread_project_id, id, name, position, collapsed) VALUES (?, ?, ?, ?, ?, ?, ?)')
      for (const item of checked.state.sections) section.run(workspaceId, codeWorkspaceId, threadProjectId, item.id, item.name, item.order, item.collapsed ? 1 : 0)
      // A conversation is in one list's section at a time; assigning it here moves it out of the other list it may be in.
      const assignment = this.db.prepare(`INSERT INTO thread_section_assignments (conversation_id, workspace_id, section_id) VALUES (?, ?, ?)
        ON CONFLICT(conversation_id) DO UPDATE SET workspace_id = excluded.workspace_id, section_id = excluded.section_id`)
      for (const [conversationId, sectionId] of Object.entries(checked.state.assignments)) assignment.run(conversationId, workspaceId, sectionId)
      return { ok: true, state: this.list(workspaceId) }
    }).immediate()
  }
}
