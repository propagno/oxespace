import { EMPTY_CONTEXT_USAGE, type ContextUsageSnapshot } from '../../../../shared/types/usage'
import type { SessionMetadata, UsageProvider } from './types'

/**
 * Stub provider — Gemini CLI does not currently emit a machine-readable session log
 * comparable to Claude's ~/.claude transcripts or Codex's ~/.codex/sessions JSONL.
 * Registering this stub keeps `UsageService.supportedProviders()` honest (the provider
 * exists in the system) while the UI gracefully hides the chip via `available: false`.
 * Replace with a real implementation once Google ships an exportable session format.
 */
export class GeminiUsageProvider implements UsageProvider {
  readonly provider = 'gemini' as const

  getSnapshot(_workspaceRootPath: string, _sessionId?: string | null): ContextUsageSnapshot {
    return EMPTY_CONTEXT_USAGE
  }

  listSessions(_workspaceRootPath: string): SessionMetadata[] {
    return []
  }
}
