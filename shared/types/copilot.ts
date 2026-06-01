/**
 * Types for the global GitHub Copilot AI-Credits counter.
 *
 * Source: the same data VS Code's Copilot status menu shows — the internal
 * `GET https://api.github.com/copilot_internal/user` endpoint, read through the
 * already-authenticated `gh` CLI (`gh api copilot_internal/user`). The endpoint
 * is undocumented and may change, so the service parses defensively and every
 * field is optional/nullable.
 */

/** One quota bucket from `quota_snapshots` (premium_interactions / chat / completions). */
export interface CopilotQuotaBucket {
  /** 0..100, derived as 100 - percent_remaining. */
  usedPct: number
  remaining: number
  entitlement: number
  unlimited: boolean
  overagePermitted: boolean
}

/** Global Copilot credits snapshot for the gh-authenticated account. */
export interface CopilotCredits {
  /** True when we parsed a usable snapshot. */
  available: boolean
  /** `gh` resolved on the machine. */
  installed: boolean
  /** copilot_plan, e.g. 'business' | 'individual' | 'enterprise'. */
  plan: string | null
  /** access_type_sku, e.g. 'free_limited_copilot'. */
  sku: string | null
  /** premium_interactions bucket — the "AI Credits" the new plan meters. */
  premium: CopilotQuotaBucket | null
  /** quota_reset_date (YYYY-MM-DD) — the "Resets …" line. */
  resetDate: string | null
  tokenBasedBilling: boolean
  /** Populated when gh/the endpoint failed (not when gh is simply absent). */
  error: string | null
}

export const EMPTY_COPILOT_CREDITS: CopilotCredits = {
  available: false,
  installed: false,
  plan: null,
  sku: null,
  premium: null,
  resetDate: null,
  tokenBasedBilling: false,
  error: null
}
