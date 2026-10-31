import type { AppDatabase } from '../../db'
import { NATIVE_SESSION_ID } from './native-session-files'

export type ResumableAgent = 'claude' | 'codex'

/** Session ids are provider-generated UUIDs (Claude Code, Codex); anything else is never recorded nor resumed. */
const SESSION_ID = NATIVE_SESSION_ID

/** What a pane's first start in this app run finds: the session recorded for it and whether the person wants it back. */
export type PaneResumeRecord = { agent: ResumableAgent; sessionId: string; wanted: boolean } | 'none'

/** The arguments that reopen a session, matching the pane's manual "restore session" action. */
export function resumeArgs(agent: ResumableAgent, sessionId: string): string[] {
  return agent === 'claude' ? ['--resume', sessionId] : ['resume', sessionId, '--no-alt-screen']
}

/**
 * The native session of the agent in each Code pane, as its hooks report it, so
 * the pane can reopen it after the app restarts (herdr's "native agent session
 * restore"). A pane is resumed at most once per app run: a later restart of the
 * pane is the person's choice and starts fresh.
 */
export class PaneAgentSessions {
  private readonly resumedThisRun = new Set<string>()

  constructor(private readonly db: AppDatabase, private readonly now: () => number = Date.now) {}

  record(paneId: string, agent: ResumableAgent, sessionId: string): void {
    if (!SESSION_ID.test(sessionId)) return
    try {
      this.db.prepare(`INSERT INTO pane_agent_sessions (pane_id, agent, session_id, updated_at) VALUES (?, ?, ?, ?)
        ON CONFLICT(pane_id) DO UPDATE SET agent = excluded.agent, session_id = excluded.session_id, updated_at = excluded.updated_at`).run(paneId, agent, sessionId, this.now())
    } catch { /* a pane that is not in the database (a Thread or container shell) has nothing to resume */ }
  }

  clear(paneId: string): void {
    try { this.db.prepare('DELETE FROM pane_agent_sessions WHERE pane_id = ?').run(paneId) } catch { /* best effort */ }
  }

  /**
   * Called on every start of a pane. Only the pane's first start in this app run gets an answer (null after that):
   * the session recorded for the pane, with whether the person wants agents resumed, or `none`.
   */
  take(paneId: string, wanted: boolean, again = false): PaneResumeRecord | null {
    // `again`: a restart of the pane asks again (B17); a plain later start does not.
    if (this.resumedThisRun.has(paneId) && !again) return null
    this.resumedThisRun.add(paneId)
    const row = this.db.prepare('SELECT agent, session_id FROM pane_agent_sessions WHERE pane_id = ?').get(paneId) as { agent: ResumableAgent; session_id: string } | undefined
    return row && (row.agent === 'claude' || row.agent === 'codex') && SESSION_ID.test(row.session_id) ? { agent: row.agent, sessionId: row.session_id, wanted } : 'none'
  }
}
