import { RESUME_LOAD_MS } from '../agent-state/pane-resume'
import type { ExitedSession, TerminalSession } from './session-output'

const EXITED_SESSION_LIMIT = 32
const EXITED_SESSION_TTL_MS = 30 * 60 * 1000

type LastStart = Pick<TerminalSession, 'workspaceId' | 'agentCommand' | 'cols' | 'rows' | 'resumeAgent'>

/** What is kept of a pane's process once it exits, and what a restart needs of it. */
export class SessionExits {
  private readonly exitedSessions = new Map<string, ExitedSession>()
  /** B17 · Panes whose resumed process exited within RESUME_LOAD_MS: their next start is fresh (failedToLoad). */
  private readonly failedResumes = new Map<string, { agent: 'claude' | 'codex'; sessionId: string }>()
  /** How each pane last started, so a restart can bring back a pane whose process exited by itself. */
  private readonly lastStarts = new Map<string, LastStart>()

  remember(session: TerminalSession, exitCode: number | null): void {
    this.exitedSessions.set(session.paneId, {
      exitCode,
      exitedAt: Date.now(),
      ring: session.ring,
      modes: session.modes
    })
    // Bound both ways: oldest-first eviction plus a TTL, so a long session
    // cannot accumulate dead panes indefinitely.
    const cutoff = Date.now() - EXITED_SESSION_TTL_MS
    for (const [paneId, entry] of this.exitedSessions) {
      if (entry.exitedAt < cutoff) this.exitedSessions.delete(paneId)
    }
    while (this.exitedSessions.size > EXITED_SESSION_LIMIT) {
      const oldest = this.exitedSessions.keys().next().value
      if (oldest === undefined) break
      this.exitedSessions.delete(oldest)
    }
  }

  take(paneId: string): ExitedSession | undefined {
    const entry = this.exitedSessions.get(paneId)
    if (!entry) return undefined
    if (Date.now() - entry.exitedAt > EXITED_SESSION_TTL_MS) {
      this.exitedSessions.delete(paneId)
      return undefined
    }
    return entry
  }

  forget(paneId: string): void {
    this.exitedSessions.delete(paneId)
  }

  recordStart(paneId: string, start: LastStart): void {
    this.lastStarts.set(paneId, start)
  }

  /** The last start of a pane whose process exited by itself. */
  restartable(paneId: string): LastStart | undefined {
    return this.take(paneId) ? this.lastStarts.get(paneId) : undefined
  }

  /** True when the exit is of a resume that ended too soon to have loaded its session. */
  recordFailedResume(session: TerminalSession): boolean {
    if (!session.resumed || Date.now() - session.startedAt >= RESUME_LOAD_MS) return false
    this.failedResumes.set(session.paneId, session.resumed)
    return true
  }

  takeFailedResume(paneId: string): { agent: 'claude' | 'codex'; sessionId: string } | undefined {
    const failed = this.failedResumes.get(paneId)
    this.failedResumes.delete(paneId)
    return failed
  }
}
