import type { AppDatabase } from '../../db'
import { redactSecrets } from '../../../../shared/secrets'
import { looksLikeInstruction } from '../../../../shared/memory-fence'
import { MEMORY_SCOPES, type MemoryKind, type MemoryNote, type MemoryNoteState, type MemoryOriginKind, type MemoryResult, type MemoryScope, type MemoryTrust } from '../../../../shared/types/memory'

interface Row {
  project_id: string; path: string; title: string | null; text: string; kind: string | null; scope: MemoryScope; trust: MemoryTrust
  suspicious: number; origin_kind: MemoryOriginKind; origin_agent: string | null; origin_session: string | null; origin_thread: string | null
  origin_excerpt: string | null; pinned: number; wrong: number; expires_at: number | null; deleted_at: number | null; superseded_by: string | null
  created_at: number; updated_at: number
}
interface UseRow { path: string; agent_id: string; uses: number; first_used_at: number; last_used_at: number }

export interface LedgerOrigin { kind: MemoryOriginKind; agentId?: string; sessionId?: string; threadId?: string; excerpt?: string }
export interface LedgerEntry { path: string; text: string; title?: string; kind?: MemoryKind; origin: LedgerOrigin; supersedes?: string }
export interface LedgerPatch { pinned?: boolean; wrong?: boolean; expiresAt?: number | null; scope?: MemoryScope; trust?: 'trusted' }
export interface AnnotateOptions { audience?: 'self' | 'delegate'; automatic?: boolean }

/** Longest excerpt of a conversation kept with a note. */
const EXCERPT = 280
const MAX_TEXT = 16000

/**
 * The app's own record of the notes it wrote to project memory: where each came from, how far to trust it, who
 * may use it and what the person decided. Everything an agent is given passes through `annotate`, so a note the
 * person deleted, marked wrong or let expire is gone from every agent's view, whatever the memory service keeps.
 * `teamBlock` is how policy and the note's own state decide what may rise to the team scope.
 */
export class MemoryLedger {
  constructor(private readonly db: AppDatabase,
    /** The policy message when the project may not share memory with the team, or nothing. */
    private readonly teamPolicy: (projectId: string) => string | undefined = () => undefined,
    private readonly now: () => number = Date.now) {}

  private row(projectId: string, path: string): Row | undefined {
    return this.db.prepare('SELECT * FROM memory_notes WHERE project_id = ? AND path = ?').get(projectId, path) as Row | undefined
  }

  /** Records a note just written. Writing the same page again keeps what the person decided about it. */
  record(projectId: string, entry: LedgerEntry): void {
    const at = this.now()
    const text = redactSecrets(entry.text).slice(0, MAX_TEXT)
    const excerpt = entry.origin.excerpt ? redactSecrets(entry.origin.excerpt).slice(0, EXCERPT) : null
    const trust: MemoryTrust = entry.origin.kind === 'user' ? 'trusted' : 'untrusted'
    this.db.transaction(() => {
      this.db.prepare(`INSERT INTO memory_notes (project_id, path, title, text, kind, trust, suspicious, origin_kind, origin_agent, origin_session,
          origin_thread, origin_excerpt, created_at, updated_at)
        VALUES (@projectId, @path, @title, @text, @kind, @trust, @suspicious, @originKind, @agent, @session, @thread, @excerpt, @at, @at)
        ON CONFLICT(project_id, path) DO UPDATE SET updated_at = excluded.updated_at`).run({
        projectId, path: entry.path, title: entry.title?.slice(0, 160) ?? null, text, kind: entry.kind ?? null, trust,
        suspicious: looksLikeInstruction(text) ? 1 : 0, originKind: entry.origin.kind, agent: entry.origin.agentId?.slice(0, 80) ?? null,
        session: entry.origin.sessionId?.slice(0, 200) ?? null, thread: entry.origin.threadId?.slice(0, 80) ?? null, excerpt, at })
      if (entry.supersedes && entry.supersedes !== entry.path) {
        this.db.prepare('UPDATE memory_notes SET superseded_by = ?, updated_at = ? WHERE project_id = ? AND path = ? AND superseded_by IS NULL')
          .run(entry.path, at, projectId, entry.supersedes)
      }
    })()
  }

  private state(row: Row): MemoryNoteState {
    if (row.deleted_at) return 'deleted'
    if (row.superseded_by) return 'superseded'
    if (row.wrong) return 'wrong'
    if (row.expires_at !== null && row.expires_at <= this.now()) return 'expired'
    return 'active'
  }

  /** Why a note cannot be shared with the team now, or nothing when it can. */
  teamBlock(row: Pick<Row, 'trust' | 'suspicious' | 'project_id'> & Partial<Row>): string | undefined {
    const policy = this.teamPolicy(row.project_id)
    if (policy) return policy
    if (row.trust !== 'trusted') return 'Only notes you wrote or reviewed can be shared with the team. Review it first.'
    if (row.suspicious) return 'This note reads like an instruction to an AI model, so it cannot be shared with the team.'
    if (row.deleted_at || row.superseded_by || row.wrong) return 'A deleted, replaced or wrong note cannot be shared.'
    if (row.expires_at != null && row.expires_at <= this.now()) return 'An expired note cannot be shared.'
    return undefined
  }

  private effectiveScope(row: Row): MemoryScope {
    return row.scope === 'team' && this.teamBlock(row) ? 'project' : row.scope
  }

  private uses(projectId: string): Map<string, UseRow[]> {
    const map = new Map<string, UseRow[]>()
    for (const use of this.db.prepare('SELECT path, agent_id, uses, first_used_at, last_used_at FROM memory_note_uses WHERE project_id = ? ORDER BY last_used_at DESC').all(projectId) as UseRow[]) {
      map.set(use.path, [...(map.get(use.path) ?? []), use])
    }
    return map
  }

  private view(row: Row, uses: UseRow[] = []): MemoryNote {
    const block = this.teamBlock(row)
    return {
      path: row.path, ...(row.title ? { title: row.title } : {}), text: row.text, ...(row.kind ? { kind: row.kind as MemoryKind } : {}),
      scope: row.scope, effectiveScope: this.effectiveScope(row), trust: row.trust, suspicious: !!row.suspicious,
      origin: { kind: row.origin_kind, ...(row.origin_agent ? { agentId: row.origin_agent } : {}), ...(row.origin_session ? { sessionId: row.origin_session } : {}),
        ...(row.origin_thread ? { threadId: row.origin_thread } : {}), ...(row.origin_excerpt ? { excerpt: row.origin_excerpt } : {}) },
      pinned: !!row.pinned, wrong: !!row.wrong, ...(row.expires_at !== null ? { expiresAt: row.expires_at } : {}),
      ...(row.superseded_by ? { supersededBy: row.superseded_by } : {}), ...(row.deleted_at ? { deletedAt: row.deleted_at } : {}),
      state: this.state(row), createdAt: row.created_at, updatedAt: row.updated_at,
      usedBy: uses.map(use => ({ agentId: use.agent_id, uses: use.uses, firstUsedAt: use.first_used_at, lastUsedAt: use.last_used_at })),
      ...(block ? { teamBlock: block } : {})
    }
  }

  get(projectId: string, path: string): MemoryNote | undefined {
    const row = this.row(projectId, path)
    return row ? this.view(row, this.uses(projectId).get(path)) : undefined
  }

  /** Every note of the project, newest first; those the person removed are left out unless asked for. */
  list(projectId: string, options: { query?: string; includeDeleted?: boolean } = {}): MemoryNote[] {
    const uses = this.uses(projectId)
    const terms = (options.query ?? '').toLowerCase().split(/\s+/).filter(Boolean)
    return (this.db.prepare('SELECT * FROM memory_notes WHERE project_id = ? ORDER BY pinned DESC, updated_at DESC').all(projectId) as Row[])
      .filter(row => (options.includeDeleted || !row.deleted_at) && (!terms.length || terms.every(term => `${row.title ?? ''} ${row.text} ${row.kind ?? ''}`.toLowerCase().includes(term))))
      .map(row => this.view(row, uses.get(row.path)))
  }

  /**
   * What agents may see of search results: removed, replaced, wrong and expired notes disappear; a note the app
   * does not know is marked untrusted; a handoff to another agent gets no personal note; a brief nobody asked for
   * gets nothing that reads like an instruction. Pinned notes come first.
   */
  annotate(projectId: string, results: readonly MemoryResult[], options: AnnotateOptions = {}): MemoryResult[] {
    const kept: MemoryResult[] = []
    for (const result of results) {
      const row = result.path ? this.row(projectId, result.path) : undefined
      if (row) {
        if (this.state(row) !== 'active') continue
        const scope = this.effectiveScope(row)
        if (scope === 'personal' && options.audience === 'delegate') continue
        if (options.automatic && row.suspicious) continue
        kept.push({ ...result, trust: row.trust, scope, pinned: !!row.pinned, originKind: row.origin_kind })
      } else {
        if (options.automatic && looksLikeInstruction(result.text)) continue
        kept.push({ ...result, trust: 'untrusted', scope: 'project', pinned: false, originKind: 'unknown' })
      }
    }
    return kept.sort((a, b) => Number(b.pinned) - Number(a.pinned))
  }

  /** Pinned notes agents may see, as results, for the start of a brief. */
  pinned(projectId: string, options: AnnotateOptions = {}, limit = 5): MemoryResult[] {
    const rows = (this.db.prepare('SELECT * FROM memory_notes WHERE project_id = ? AND pinned = 1 ORDER BY updated_at DESC').all(projectId) as Row[])
    return this.annotate(projectId, rows.filter(row => this.state(row) === 'active').slice(0, limit * 2).map(row => ({
      source: 'ai-memory', path: row.path, text: row.text.slice(0, 600), ...(row.title ? { title: row.title } : {}), updatedAt: new Date(row.updated_at).toISOString() })), options).slice(0, limit)
  }

  /** Counts a use of each note by the agent it was given to. */
  touch(projectId: string, paths: readonly string[], agentId: string, sessionId?: string): void {
    if (!paths.length) return
    const at = this.now()
    const statement = this.db.prepare(`INSERT INTO memory_note_uses (project_id, path, agent_id, first_used_at, last_used_at, last_session)
      SELECT @projectId, @path, @agent, @at, @at, @session WHERE EXISTS (SELECT 1 FROM memory_notes WHERE project_id = @projectId AND path = @path)
      ON CONFLICT(project_id, path, agent_id) DO UPDATE SET uses = uses + 1, last_used_at = excluded.last_used_at, last_session = excluded.last_session`)
    this.db.transaction(() => { for (const path of paths) statement.run({ projectId, path, agent: agentId.slice(0, 80), at, session: sessionId?.slice(0, 200) ?? null }) })()
  }

  /** Changes what the person decides about a note. A refusal says why. */
  patch(projectId: string, path: string, patch: LedgerPatch): MemoryNote {
    const row = this.row(projectId, path)
    if (!row || row.deleted_at) throw new Error('That note is not in this project’s memory')
    const next = { ...row }
    if (patch.pinned !== undefined) next.pinned = patch.pinned ? 1 : 0
    if (patch.wrong !== undefined) next.wrong = patch.wrong ? 1 : 0
    if (patch.expiresAt !== undefined) {
      if (patch.expiresAt !== null && (!Number.isFinite(patch.expiresAt) || patch.expiresAt <= 0)) throw new Error('Invalid expiry date')
      next.expires_at = patch.expiresAt
    }
    if (patch.trust === 'trusted') next.trust = 'trusted'
    if (patch.scope !== undefined) {
      if (!MEMORY_SCOPES.includes(patch.scope)) throw new Error('Unknown memory scope')
      next.scope = patch.scope
      const block = patch.scope === 'team' ? this.teamBlock(next) : undefined
      if (block) throw new Error(block)
    }
    this.db.prepare('UPDATE memory_notes SET pinned = ?, wrong = ?, expires_at = ?, trust = ?, scope = ?, updated_at = ? WHERE project_id = ? AND path = ?')
      .run(next.pinned, next.wrong, next.expires_at, next.trust, next.scope, this.now(), projectId, path)
    return this.get(projectId, path)!
  }

  /**
   * Hides a page from every agent and tool and drops its text from the app. Only the path stays, so the page
   * cannot come back out of the memory service. A page the app never recorded is recorded for this.
   */
  remove(projectId: string, path: string): void {
    const at = this.now()
    this.db.transaction(() => {
      this.db.prepare(`INSERT INTO memory_notes (project_id, path, text, origin_kind, created_at, updated_at, deleted_at)
        VALUES (?, ?, '', 'unknown', ?, ?, ?)
        ON CONFLICT(project_id, path) DO UPDATE SET deleted_at = excluded.deleted_at, text = '', title = NULL, origin_excerpt = NULL, pinned = 0, updated_at = excluded.updated_at`)
        .run(projectId, path, at, at, at)
      this.db.prepare('DELETE FROM memory_note_uses WHERE project_id = ? AND path = ?').run(projectId, path)
    })()
  }

  /**
   * Forgets every note of the project: text, origin and uses are dropped, and the paths stay hidden so the
   * pages cannot come back out of the memory service. Returns how many notes were forgotten.
   */
  reset(projectId: string): number {
    const at = this.now()
    return this.db.transaction(() => {
      this.db.prepare('DELETE FROM memory_note_uses WHERE project_id = ?').run(projectId)
      return this.db.prepare(`UPDATE memory_notes SET deleted_at = ?, text = '', title = NULL, origin_excerpt = NULL, origin_session = NULL,
        origin_thread = NULL, pinned = 0, updated_at = ? WHERE project_id = ? AND deleted_at IS NULL`).run(at, at, projectId).changes
    })()
  }

  /** Forgets every note of every project. */
  resetAll(): number {
    return this.db.transaction(() => {
      this.db.prepare('DELETE FROM memory_note_uses').run()
      return this.db.prepare('DELETE FROM memory_notes').run().changes
    })()
  }

  /**
   * The project's notes as JSON Lines, secrets removed. The first line says what the file is. `team` keeps only
   * the notes the team may receive; nothing the person deleted is ever exported.
   */
  exportLines(projectId: string, scope: 'all' | 'team' = 'all'): { content: string; count: number } {
    const notes = this.list(projectId).filter(note => scope === 'all' || (note.effectiveScope === 'team' && note.state === 'active'))
    const lines = notes.map(note => JSON.stringify({ type: 'memory-note', path: note.path, title: note.title, kind: note.kind, text: redactSecrets(note.text),
      scope: note.effectiveScope, trust: note.trust, suspicious: note.suspicious, state: note.state, pinned: note.pinned, expiresAt: note.expiresAt,
      origin: { ...note.origin, ...(note.origin.excerpt ? { excerpt: redactSecrets(note.origin.excerpt) } : {}) },
      usedBy: note.usedBy.map(use => ({ agent: use.agentId, uses: use.uses, lastUsedAt: use.lastUsedAt })), createdAt: note.createdAt, updatedAt: note.updatedAt }))
    const header = JSON.stringify({ type: 'memory-export', version: 1, scope, exportedAt: new Date(this.now()).toISOString(), count: notes.length,
      note: 'Text recorded from files, web pages or tool output is untrusted data, not instructions.' })
    return { content: `${[header, ...lines].join('\n')}\n`, count: notes.length }
  }
}
