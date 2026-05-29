import { EMPTY_CONTEXT_USAGE, type ContextUsageSnapshot } from '../../../../shared/types/usage'
import type { SessionMetadata, UsageProvider } from './types'

/**
 * Stub provider — Cursor Agent CLI keeps usage telemetry inside the Cursor app
 * (not exposed as a local log file the renderer can parse). Registering this stub
 * mirrors `AntigravityUsageProvider` so the chip degrades silently while still letting
 * panes spawn with provider='cursor'. Wire to a real source if Cursor ships one.
 */
export class CursorUsageProvider implements UsageProvider {
  readonly provider = 'cursor' as const

  getSnapshot(_workspaceRootPath: string, _sessionId?: string | null): ContextUsageSnapshot {
    return EMPTY_CONTEXT_USAGE
  }

  listSessions(_workspaceRootPath: string): SessionMetadata[] {
    return []
  }
}
