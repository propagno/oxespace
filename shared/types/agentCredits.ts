import type { AgentProvider } from './agent'

/**
 * Types for the per-provider usage/quota counter shown in the terminal status
 * bar — the same "AI credits" concept as the Copilot chip, but for the other
 * agents the app drives (Claude, Codex; Antigravity is a stub for now).
 *
 * Each provider has a different authoritative source for subscription quota
 * (distinct from the token/cost data the `usage/*Provider` files already track):
 *   - Codex  → `rate_limits` inside `token_count` events in
 *              `~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl` (local, no auth).
 *   - Claude → undocumented `GET https://api.anthropic.com/api/oauth/usage`,
 *              authed with the OAuth token in `~/.claude/.credentials.json`.
 * Both expose two windows (a short 5h window + a weekly window); the chip shows
 * the weekly one, matching Copilot's periodically-renewing credits.
 */

export type CreditsTone = 'ok' | 'warning' | 'critical' | 'idle'

/** One rate-limit window: the short 5h ("session") one, or the weekly one. */
export interface CreditsWindow {
  kind: 'session' | 'weekly'
  /** 0..100 of the window's allowance consumed. */
  usedPct: number
  /** When the window resets (epoch ms), or null if unknown. */
  resetsAtMs: number | null
}

/** Account-wide quota snapshot for one provider. */
export interface AgentCreditsSnapshot {
  provider: AgentProvider
  /** True when we have a usable window to display (chip renders). */
  available: boolean
  /** The CLI / credentials needed for this provider were found on the machine. */
  installed: boolean
  /** Plan/tier label, e.g. Claude's `subscriptionType`. Null when unknown. */
  planLabel: string | null
  /** The window shown on the chip (weekly). Null when unavailable. */
  display: CreditsWindow | null
  /** Every parsed window (for the tooltip: session + weekly). */
  windows: CreditsWindow[]
  /** Populated when the source was reachable but failed (not when simply absent). */
  error: string | null
}

export function emptyAgentCredits(provider: AgentProvider): AgentCreditsSnapshot {
  return {
    provider,
    available: false,
    installed: false,
    planLabel: null,
    display: null,
    windows: [],
    error: null
  }
}

export interface AgentCreditsInput {
  provider: AgentProvider
  force?: boolean
}
