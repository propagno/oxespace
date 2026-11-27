import { EMPTY_CONTEXT_USAGE, type ContextUsageSnapshot } from '../../../../shared/types/usage'
import { listAntigravitySessions, listAntigravitySessionsSync } from './antigravity-sessions'
import type { SessionMetadata, UsageProvider } from './types'

/**
 * Discovers local Antigravity CLI sessions stored under `<antigravityHome>/brain/<uuid>`
 * (indexed by `conversation_summaries.db` and `history.jsonl`) scoped strictly to the
 * active workspace root path. Usage token snapshots remain `EMPTY_CONTEXT_USAGE` because
 * live context usage is reported over ACP `usage_update` frames.
 */
export class AntigravityUsageProvider implements UsageProvider {
  readonly provider = 'antigravity' as const

  constructor(private readonly antigravityHome?: string) {}

  getSnapshot(_workspaceRootPath: string, _sessionId?: string | null): ContextUsageSnapshot {
    return EMPTY_CONTEXT_USAGE
  }

  listSessions(workspaceRootPath: string): SessionMetadata[] {
    return listAntigravitySessionsSync(workspaceRootPath, this.antigravityHome)
  }

  async listSessionsAsync(workspaceRootPath: string, onPartial?: (sessions: SessionMetadata[]) => void): Promise<SessionMetadata[]> {
    return listAntigravitySessions(workspaceRootPath, { antigravityHome: this.antigravityHome, onPartial })
  }
}
