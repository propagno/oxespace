import type { ConversationThread, ThreadConfiguration } from '../../../../shared/types/thread'
import {
  computePromptCacheFingerprint,
  recordPromptCacheConfigChange,
  recordPromptCacheTurn
} from '../../../../shared/prompt-cache'
import type { TurnCost } from './thread-cost'

/** Updates per-thread prompt cache state after a provider turn finishes and reports token usage. */
export function updateThreadPromptCacheOnCost(thread: ConversationThread, cost: TurnCost, now: number): void {
  const next = recordPromptCacheTurn(thread.promptCache, {
    provider: thread.provider,
    fingerprint: computePromptCacheFingerprint(thread),
    cacheReadTokens: cost.cacheReadTokens,
    cacheCreationTokens: cost.cacheCreationTokens,
    inputTokens: cost.inputTokens,
    now
  })
  if (next) thread.promptCache = next
}

/** Flags prompt cache prefix invalidation when model, MCP tools, or mode/access configuration changes. */
export function updateThreadPromptCacheOnConfig(
  thread: ConversationThread,
  before: ThreadConfiguration,
  after: ThreadConfiguration,
  now: number
): void {
  const beforeView = { ...thread, ...before }
  const afterView = { ...thread, ...after }
  const next = recordPromptCacheConfigChange(thread.promptCache, beforeView, afterView, now)
  if (next) thread.promptCache = next
}
