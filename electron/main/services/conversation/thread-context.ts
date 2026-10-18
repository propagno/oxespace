import type { ThreadContextCategory, ThreadContextReport } from '../../../../shared/types/thread'

const MAX_CATEGORIES = 32
const MAX_NAME = 64
const KINDS = new Set<ThreadContextCategory['kind']>(['used', 'deferred', 'buffer', 'free'])

function count(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.round(value) : null
}
function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

/** Claude `get_context_usage` response. A report that proves nothing (no window, no usage) is dropped. */
export function normalizeClaudeContext(raw: unknown, now = Date.now()): ThreadContextReport | null {
  const value = record(raw)
  const windowTokens = count(value.rawMaxTokens) ?? count(value.maxTokens)
  const usedTokens = count(value.totalTokens)
  if (!windowTokens || usedTokens === null) return null
  const categories: ThreadContextCategory[] = []
  for (const item of Array.isArray(value.categories) ? value.categories : []) {
    const category = record(item), tokens = count(category.tokens)
    const name = typeof category.name === 'string' ? category.name.trim().slice(0, MAX_NAME) : ''
    if (!name || tokens === null || categories.length >= MAX_CATEGORIES) continue
    const kind = KINDS.has(category.kind as ThreadContextCategory['kind']) ? category.kind as ThreadContextCategory['kind'] : category.isDeferred === true ? 'deferred' : 'used'
    categories.push({ name, tokens, kind })
  }
  const buffer = categories.find(category => category.kind === 'buffer')
  return {
    ...(typeof value.model === 'string' && value.model ? { model: value.model.slice(0, 120) } : {}),
    usedTokens, windowTokens,
    percentage: Math.min(100, Math.round(usedTokens / windowTokens * 100)),
    ...(buffer && buffer.tokens < windowTokens ? { autoCompactAtTokens: windowTokens - buffer.tokens } : {}),
    categories, capturedAt: now, source: 'claude-control'
  }
}

/** Codex `thread/tokenUsage/updated`. `last` is what the next request carries, so it is the context size. */
export function normalizeCodexTokenUsage(raw: unknown, model: string | undefined, now = Date.now()): ThreadContextReport | null {
  const value = record(raw)
  const windowTokens = count(value.modelContextWindow)
  const usedTokens = count(record(value.last).totalTokens)
  if (!windowTokens || usedTokens === null) return null
  return { ...(model ? { model } : {}), usedTokens, windowTokens, percentage: Math.min(100, Math.round(usedTokens / windowTokens * 100)), categories: [], capturedAt: now, source: 'codex-token-usage' }
}
