import type { AppDatabase } from '../../db'
import { NATIVE_SESSION_ID } from './native-session-files'

export type ResumableAgent = 'claude' | 'codex'

/** Session ids are provider-generated UUIDs (Claude Code, Codex); anything else is never recorded nor resumed. */
const SESSION_ID = NATIVE_SESSION_ID

/** T54 · Claude Code's own permission modes, as its hooks report `permission_mode`; anything else is never stored. */
export const CLAUDE_PERMISSION_MODES = ['default', 'acceptEdits', 'plan', 'bypassPermissions'] as const
export type ClaudePermissionMode = typeof CLAUDE_PERMISSION_MODES[number]
export const isClaudePermissionMode = (value: unknown): value is ClaudePermissionMode =>
  typeof value === 'string' && (CLAUDE_PERMISSION_MODES as readonly string[]).includes(value)

/**
 * What a pane's first start in this app run finds: the session recorded for it, whether the person wants it back, and
 * the permission mode it started in (T54), if one was recorded.
 */
export type PaneResumeRecord = { agent: ResumableAgent; sessionId: string; wanted: boolean; permissionMode?: ClaudePermissionMode } | 'none'

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
/** The command that reopens a session from a terminal, for Terminal details' "Copy resume command" (ids are UUIDs). */
export function resumeCommand(agent: ResumableAgent, sessionId: string): string {
  return [agent, ...resumeArgs(agent, sessionId)].join(' ')
}

export type PaneSessionSource = 'launch' | 'hook' | 'recorded'

export class PaneAgentSessions {
  private readonly resumedThisRun = new Set<string>()
  /** How each pane's session was learned in this app run; a row from an earlier run reads as `recorded`. */
  private readonly sources = new Map<string, Exclude<PaneSessionSource, 'recorded'>>()

  constructor(private readonly db: AppDatabase, private readonly now: () => number = Date.now) {}

  /**
   * `permissionMode`: what a Claude SessionStart reported (T54). Only a SessionStart sets it; any later event of the same
   * session keeps it, so a mode changed during the session (Shift+Tab) never becomes what a resume starts in. A different
   * session starts with none until its own SessionStart.
   */
  record(paneId: string, agent: ResumableAgent, sessionId: string, source: Exclude<PaneSessionSource, 'recorded'> = 'hook', permissionMode?: ClaudePermissionMode): void {
    if (!SESSION_ID.test(sessionId)) return
    const mode = agent === 'claude' && isClaudePermissionMode(permissionMode) ? permissionMode : null
    try {
      this.db.prepare(`INSERT INTO pane_agent_sessions (pane_id, agent, session_id, updated_at, permission_mode) VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(pane_id) DO UPDATE SET agent = excluded.agent, session_id = excluded.session_id, updated_at = excluded.updated_at,
          permission_mode = CASE WHEN excluded.permission_mode IS NOT NULL THEN excluded.permission_mode
            WHEN pane_agent_sessions.session_id = excluded.session_id THEN pane_agent_sessions.permission_mode ELSE NULL END`).run(paneId, agent, sessionId, this.now(), mode)
      this.sources.set(paneId, source)
    } catch { /* a pane that is not in the database (a Thread or container shell) has nothing to resume */ }
  }

  clear(paneId: string): void {
    this.sources.delete(paneId)
    try { this.db.prepare('DELETE FROM pane_agent_sessions WHERE pane_id = ?').run(paneId) } catch { /* best effort */ }
  }

  /** The session the pane is in now and where it came from, for Terminal details; null when none is recorded. */
  current(paneId: string): { agent: ResumableAgent; sessionId: string; source: PaneSessionSource; permissionMode?: ClaudePermissionMode } | null {
    let row: { agent: ResumableAgent; session_id: string; permission_mode: string | null } | undefined
    try { row = this.db.prepare('SELECT agent, session_id, permission_mode FROM pane_agent_sessions WHERE pane_id = ?').get(paneId) as typeof row } catch { return null }
    if (!row || (row.agent !== 'claude' && row.agent !== 'codex') || !SESSION_ID.test(row.session_id)) return null
    return { agent: row.agent, sessionId: row.session_id, source: this.sources.get(paneId) ?? 'recorded', ...modeOf(row) }
  }

  /**
   * Called on every start of a pane. Only the pane's first start in this app run gets an answer (null after that):
   * the session recorded for the pane, with whether the person wants agents resumed, or `none`.
   */
  take(paneId: string, wanted: boolean, again = false): PaneResumeRecord | null {
    // `again`: a restart of the pane asks again (B17); a plain later start does not.
    if (this.resumedThisRun.has(paneId) && !again) return null
    this.resumedThisRun.add(paneId)
    const row = this.db.prepare('SELECT agent, session_id, permission_mode FROM pane_agent_sessions WHERE pane_id = ?').get(paneId) as { agent: ResumableAgent; session_id: string; permission_mode: string | null } | undefined
    return row && (row.agent === 'claude' || row.agent === 'codex') && SESSION_ID.test(row.session_id) ? { agent: row.agent, sessionId: row.session_id, wanted, ...modeOf(row) } : 'none'
  }
}

/** A stored mode, read back only for Claude and only if it is one of its four. */
function modeOf(row: { agent: ResumableAgent; permission_mode: string | null }): { permissionMode?: ClaudePermissionMode } {
  return row.agent === 'claude' && isClaudePermissionMode(row.permission_mode) ? { permissionMode: row.permission_mode } : {}
}
