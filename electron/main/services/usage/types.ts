import type { AgentProvider } from '../../../../shared/types/agent'
import type { ContextUsageSnapshot } from '../../../../shared/types/usage'

export interface UsageProvider {
  /** Which AgentProvider this maps to (e.g. 'claude', 'codex'). */
  readonly provider: AgentProvider

  /** Returns the latest usage snapshot for the most-recently-touched session of this workspace. */
  getSnapshot(workspaceRootPath: string, sessionId?: string | null): ContextUsageSnapshot

  /** Returns metadata for all known sessions in this workspace, newest first. */
  listSessions(workspaceRootPath: string): SessionMetadata[]

  /** The same list read without blocking the main process; `onPartial` gets the sessions read so far (OXE-157). */
  listSessionsAsync?(workspaceRootPath: string, onPartial?: (sessions: SessionMetadata[]) => void): Promise<SessionMetadata[]>
}

export interface SessionMetadata {
  sessionId: string
  lastUpdatedMs: number
  sessionStartedAtMs: number
  modelId: string | null
  requestCount: number
  snapshot?: ContextUsageSnapshot
  summary?: string | null
  /** The first user message, short (Claude's async list reads it with the transcript). */
  firstMessagePreview?: string | null
  workspaceRootPath?: string | null
}
