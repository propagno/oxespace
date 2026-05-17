import type { ContextUsageInput, ContextUsageSnapshot } from '../../../shared/types/usage'
import { EMPTY_CONTEXT_USAGE } from '../../../shared/types/usage'
import type { AgentProvider } from '../../../shared/types/agent'
import { ClaudeUsageProvider } from './usage/claudeProvider'
import { CodexUsageProvider } from './usage/codexProvider'
import { GeminiUsageProvider } from './usage/geminiProvider'
import { CursorUsageProvider } from './usage/cursorProvider'
import type { SessionMetadata, UsageProvider } from './usage/types'

/**
 * Dispatches usage queries across registered providers. Claude and Codex have real
 * JSONL backends; Gemini and Cursor are stubs that return EMPTY snapshots so the UI
 * chip hides automatically but provider='gemini'|'cursor' is still acknowledged as
 * supported. Wire a real backend when those vendors expose session logs.
 */
export class UsageService {
  private readonly providers: Map<AgentProvider, UsageProvider>

  constructor(providers?: UsageProvider[]) {
    const defaults: UsageProvider[] = providers ?? [
      new ClaudeUsageProvider(),
      new CodexUsageProvider(),
      new GeminiUsageProvider(),
      new CursorUsageProvider()
    ]
    this.providers = new Map(defaults.map((p) => [p.provider, p]))
  }

  /**
   * Default entry point — kept for backwards compatibility with the old IPC.
   * Tries Claude first (still the most common), falls back to whichever has data.
   */
  getContextUsage(input: ContextUsageInput): ContextUsageSnapshot {
    // Preserve existing behavior: if caller doesn't specify a provider, prefer Claude.
    const claude = this.providers.get('claude')?.getSnapshot(input.workspaceRootPath)
    if (claude && claude.available) return claude

    // Otherwise try each registered provider in order.
    for (const provider of this.providers.values()) {
      if (provider.provider === 'claude') continue
      const snap = provider.getSnapshot(input.workspaceRootPath)
      if (snap.available) return snap
    }
    return EMPTY_CONTEXT_USAGE
  }

  /** Targeted query for a specific provider + optional session id. */
  getSnapshotFor(provider: AgentProvider, workspaceRootPath: string, sessionId?: string | null): ContextUsageSnapshot {
    const p = this.providers.get(provider)
    if (!p) return EMPTY_CONTEXT_USAGE
    return p.getSnapshot(workspaceRootPath, sessionId)
  }

  /** All known sessions for a given provider in a given workspace. */
  listSessionsFor(provider: AgentProvider, workspaceRootPath: string): SessionMetadata[] {
    const p = this.providers.get(provider)
    if (!p) return []
    return p.listSessions(workspaceRootPath)
  }

  /** Which providers have a backend? Useful to gate the UI chip. */
  supportedProviders(): AgentProvider[] {
    return Array.from(this.providers.keys())
  }
}
