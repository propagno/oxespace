export interface ContextUsageSnapshot {
  available: boolean
  sessionId: string | null
  modelId: string | null
  // Cumulative across the whole session (used for cost + total transferred).
  inputTokens: number
  cacheCreationTokens: number
  cacheReadTokens: number
  outputTokens: number
  // Snapshot of the LAST turn — represents the current context window fill
  // (input + cache + output of the most recent assistant turn, which is what the
  // next request will reload). Use this for the context % meter.
  lastTurnInputTokens: number
  lastTurnCacheCreationTokens: number
  lastTurnCacheReadTokens: number
  lastTurnOutputTokens: number
  requestCount: number
  estimatedCostUsd: number
  contextLimit: number | null
  lastUpdatedMs: number | null
  sessionStartedAtMs: number | null
}

export interface ContextUsageInput {
  workspaceRootPath: string
}

export const EMPTY_CONTEXT_USAGE: ContextUsageSnapshot = {
  available: false,
  sessionId: null,
  modelId: null,
  inputTokens: 0,
  cacheCreationTokens: 0,
  cacheReadTokens: 0,
  outputTokens: 0,
  lastTurnInputTokens: 0,
  lastTurnCacheCreationTokens: 0,
  lastTurnCacheReadTokens: 0,
  lastTurnOutputTokens: 0,
  requestCount: 0,
  estimatedCostUsd: 0,
  contextLimit: null,
  lastUpdatedMs: null,
  sessionStartedAtMs: null
}
