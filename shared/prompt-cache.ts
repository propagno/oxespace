import type { ConversationThread, PromptCacheBreakReason, ThreadPromptCacheState, ThreadProvider } from './types/thread'

/**
 * Default prompt-cache idle TTL windows per provider (milliseconds).
 * Anthropic's ephemeral prompt cache expires after 5 minutes of inactivity;
 * OpenAI/Codex and Gemini/Antigravity cached prefixes use the same practical 5-minute window.
 */
export const PROVIDER_CACHE_TTL_MS: Readonly<Record<ThreadProvider, number>> = {
  claude: 5 * 60_000,
  codex: 5 * 60_000,
  antigravity: 5 * 60_000
}

/** Minimum prior cached-prefix size (tokens) before a sharp cache-read drop is flagged as a prefix break. */
export const CACHE_DROP_MIN_BASELINE_TOKENS = 4_000

/** Ratio below which a drop in `cacheReadTokens` within TTL indicates prefix invalidation. */
export const CACHE_DROP_RATIO_THRESHOLD = 0.35

export type PromptCacheStatusKind = 'none' | 'warm' | 'stale' | 'broken'

export interface PromptCacheStatus {
  kind: PromptCacheStatusKind
  reason?: PromptCacheBreakReason
  idleMs?: number
  ttlMs?: number
  expiresInMs?: number
  lastCacheReadTokens?: number
}

export type PromptCacheFingerprintInput = Pick<
  ConversationThread,
  'provider' | 'model' | 'sessionModel' | 'reasoningEffort' | 'mode' | 'access' | 'hooksEnabled' | 'disabledMcpTools' | 'agentProfileId' | 'mcpServers'
>

/**
 * Canonical fingerprint of the conversation settings that shape the provider's prompt prefix
 * (model, reasoning effort, mode/access instructions, hooks, custom agent profile, MCP tool exclusions & servers).
 */
export function computePromptCacheFingerprint(input: PromptCacheFingerprintInput): string {
  const model = (input.model ?? input.sessionModel ?? '').trim()
  const effort = (input.reasoningEffort ?? '').trim()
  const mode = input.mode ?? 'default'
  const access = input.access ?? ''
  const hooks = input.hooksEnabled ? '1' : '0'
  const profile = (input.agentProfileId ?? '').trim()
  const disabledMcp = [...(input.disabledMcpTools ?? [])].map(item => item.trim()).filter(Boolean).sort().join(',')
  const servers = (input.mcpServers?.servers ?? [])
    .map(server => `${server.name}:${server.status}`)
    .sort()
    .join(',')
  return [
    `p=${input.provider}`,
    `m=${model}`,
    `e=${effort}`,
    `mode=${mode}`,
    `acc=${access}`,
    `h=${hooks}`,
    `prof=${profile}`,
    `dmcp=${disabledMcp}`,
    `srv=${servers}`
  ].join('|')
}

export function promptCacheTtlMs(provider: ThreadProvider): number {
  return PROVIDER_CACHE_TTL_MS[provider] ?? 5 * 60_000
}

function hasWarmPrefix(state: ThreadPromptCacheState | undefined): boolean {
  if (!state) return false
  return state.baselineCacheReadTokens > 0 || state.lastCacheReadTokens > 0 || (state.lastCacheCreationTokens ?? 0) > 0
}

/**
 * Updates per-thread prompt-cache telemetry after a finished turn reports token usage.
 * Detects unexpected sharp `cacheReadTokens` drops within the TTL window when configuration did not change.
 */
export function recordPromptCacheTurn(
  previous: ThreadPromptCacheState | undefined,
  input: {
    provider: ThreadProvider
    fingerprint: string
    cacheReadTokens?: number
    cacheCreationTokens?: number
    inputTokens?: number
    now: number
  }
): ThreadPromptCacheState | undefined {
  const cacheRead = Math.max(0, Math.round(input.cacheReadTokens ?? 0))
  const cacheCreation = Math.max(0, Math.round(input.cacheCreationTokens ?? 0))
  const uncachedInput = Math.max(0, Math.round(input.inputTokens ?? 0))
  const ttlMs = promptCacheTtlMs(input.provider)

  const hadWarm = hasWarmPrefix(previous)
  const withinTtl = Boolean(previous && (input.now - previous.lastCachedAt) < (previous.ttlMs || ttlMs))
  const sameFingerprint = Boolean(previous && previous.fingerprint === input.fingerprint)

  // Detect sudden prefix drop within TTL while configuration stayed unchanged.
  if (
    previous &&
    hadWarm &&
    withinTtl &&
    sameFingerprint &&
    previous.baselineCacheReadTokens >= CACHE_DROP_MIN_BASELINE_TOKENS &&
    cacheRead < previous.baselineCacheReadTokens * CACHE_DROP_RATIO_THRESHOLD &&
    (uncachedInput + cacheCreation) >= Math.floor(CACHE_DROP_MIN_BASELINE_TOKENS / 2)
  ) {
    return {
      fingerprint: input.fingerprint,
      lastCachedAt: input.now,
      ttlMs,
      lastCacheReadTokens: cacheRead,
      ...(cacheCreation > 0 ? { lastCacheCreationTokens: cacheCreation } : {}),
      baselineCacheReadTokens: Math.max(cacheRead, cacheCreation, previous.baselineCacheReadTokens),
      breakReason: 'prefix-drop',
      brokenAt: input.now
    }
  }

  // Turn established or read a warm prefix: clear any prior break marker.
  if (cacheRead > 0 || cacheCreation > 0) {
    return {
      fingerprint: input.fingerprint,
      lastCachedAt: input.now,
      ttlMs,
      lastCacheReadTokens: cacheRead,
      ...(cacheCreation > 0 ? { lastCacheCreationTokens: cacheCreation } : {}),
      baselineCacheReadTokens: Math.max(cacheRead, cacheCreation)
    }
  }

  // No cache telemetry on this turn; keep previous state if one already existed.
  return previous
}

/**
 * Flags a prompt-cache prefix break when conversation configuration changes after a warm cached turn.
 */
export function recordPromptCacheConfigChange(
  previous: ThreadPromptCacheState | undefined,
  before: PromptCacheFingerprintInput,
  after: PromptCacheFingerprintInput,
  now: number
): ThreadPromptCacheState | undefined {
  if (!previous || !hasWarmPrefix(previous)) return previous
  const nextFingerprint = computePromptCacheFingerprint(after)
  if (nextFingerprint === previous.fingerprint) return previous

  let reason: PromptCacheBreakReason = 'configuration-changed'
  const beforeModel = (before.model ?? before.sessionModel ?? '').trim()
  const afterModel = (after.model ?? after.sessionModel ?? '').trim()
  const beforeMcp = [...(before.disabledMcpTools ?? [])].sort().join(',')
  const afterMcp = [...(after.disabledMcpTools ?? [])].sort().join(',')

  if (beforeModel !== afterModel) {
    reason = 'model-changed'
  } else if (beforeMcp !== afterMcp) {
    reason = 'mcp-tools-changed'
  }

  return {
    ...previous,
    breakReason: reason,
    brokenAt: now
  }
}

/**
 * Evaluates the current prompt-cache status for UI display (warm, stale after TTL, or broken).
 */
export function evaluatePromptCacheStatus(
  state: ThreadPromptCacheState | undefined,
  now: number,
  currentFingerprint?: string
): PromptCacheStatus {
  if (!state || !hasWarmPrefix(state)) return { kind: 'none' }

  const idleMs = Math.max(0, now - state.lastCachedAt)
  const ttlMs = state.ttlMs > 0 ? state.ttlMs : 5 * 60_000

  if (state.breakReason) {
    return {
      kind: 'broken',
      reason: state.breakReason,
      idleMs,
      ttlMs,
      lastCacheReadTokens: state.lastCacheReadTokens
    }
  }

  if (currentFingerprint && currentFingerprint !== state.fingerprint) {
    return {
      kind: 'broken',
      reason: 'configuration-changed',
      idleMs,
      ttlMs,
      lastCacheReadTokens: state.lastCacheReadTokens
    }
  }

  if (idleMs >= ttlMs) {
    return {
      kind: 'stale',
      idleMs,
      ttlMs,
      lastCacheReadTokens: state.lastCacheReadTokens
    }
  }

  return {
    kind: 'warm',
    idleMs,
    ttlMs,
    expiresInMs: Math.max(0, ttlMs - idleMs),
    lastCacheReadTokens: state.lastCacheReadTokens
  }
}
