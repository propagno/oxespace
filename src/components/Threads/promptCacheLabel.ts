import type { TFunction } from 'i18next'
import type { PromptCacheStatus } from '../../../shared/prompt-cache'

const compact = (tokens: number): string =>
  tokens >= 1_000_000 ? `${(tokens / 1_000_000).toFixed(1)}M` : tokens >= 1_000 ? `${Math.round(tokens / 1_000)}k` : String(tokens)

/** Formats a calm, localized one-line status hint for prompt cache liveness/invalidation. */
export function formatPromptCacheHint(status: PromptCacheStatus, t: TFunction<'thread'>): string | null {
  if (status.kind === 'none') return null
  if (status.kind === 'warm') {
    const tokens = compact(status.lastCacheReadTokens ?? 0)
    return t('usage.cacheWarm', { tokens })
  }
  if (status.kind === 'stale') {
    const minutes = Math.max(1, Math.floor((status.idleMs ?? status.ttlMs ?? 300_000) / 60_000))
    return t('usage.cacheStale', { minutes })
  }
  switch (status.reason) {
    case 'model-changed':
      return t('usage.cacheBrokenModel')
    case 'mcp-tools-changed':
      return t('usage.cacheBrokenMcp')
    case 'prefix-drop':
      return t('usage.cacheBrokenPrefix')
    default:
      return t('usage.cacheBrokenConfig')
  }
}
