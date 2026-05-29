import { EMPTY_CONTEXT_USAGE, type ContextUsageSnapshot } from '../../../../shared/types/usage'
import type { SessionMetadata, UsageProvider } from './types'

/**
 * Stub provider — Antigravity CLI does not currently emit a machine-readable session log
 * comparable to Claude's ~/.claude transcripts or Codex's ~/.codex/sessions JSONL.
 * Registering this stub keeps `UsageService.supportedProviders()` honest (the provider
 * exists in the system) while the UI gracefully hides the chip via `available: false`.
 * Replace with a real implementation once the tool ships an exportable session format.
 */
export class AntigravityUsageProvider implements UsageProvider {
  readonly provider = 'antigravity' as const

  getSnapshot(_workspaceRootPath: string, _sessionId?: string | null): ContextUsageSnapshot {
    return EMPTY_CONTEXT_USAGE
  }

  listSessions(_workspaceRootPath: string): SessionMetadata[] {
    return []
  }
}
