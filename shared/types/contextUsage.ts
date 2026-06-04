import type { AgentProvider } from './agent'

/**
 * Types for the terminal status-bar "context window %" chip — the live `/context`
 * meter that tells the user how full the current conversation's context is, so
 * they know when to `/compact` or `/clear`.
 *
 * The figure is sourced locally (no network) from what each CLI already writes:
 *   - Claude: last-turn tokens in `~/.claude/projects/<enc>/<sid>.jsonl` ÷ model limit.
 *   - Codex:  `last_token_usage` ÷ `model_context_window` in `~/.codex` rollouts.
 *   - Copilot: the `CompactionProcessor: Utilization X% (used/limit tokens)` line in
 *             `~/.copilot/logs/process-*.log` (carries the real window + threshold).
 * Antigravity/Cursor expose no tokens → `available:false` (chip hides).
 */
export interface ContextUsageChip {
  provider: AgentProvider
  /** True only when a real context figure was found (chip renders). */
  available: boolean
  usedTokens: number
  limitTokens: number
  /** 0..100, rounded. */
  usedPct: number
  modelId: string | null
  /** Populated when the source was reachable but failed. */
  error: string | null
}

export function emptyContextUsage(provider: AgentProvider): ContextUsageChip {
  return { provider, available: false, usedTokens: 0, limitTokens: 0, usedPct: 0, modelId: null, error: null }
}

export interface ContextUsageInput {
  provider: AgentProvider
  workspaceRootPath: string
  sessionId?: string | null
}
