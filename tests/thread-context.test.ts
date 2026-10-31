import { describe, expect, it } from 'vitest'
import { normalizeClaudeContext, normalizeCodexTokenUsage } from '../electron/main/services/conversation/thread-context'

describe('thread context normalization', () => {
  it('reads Claude categories, the window and the auto-compact threshold', () => {
    const report = normalizeClaudeContext({
      totalTokens: 15741, maxTokens: 1_000_000, rawMaxTokens: 1_000_000, model: 'claude-x',
      categories: [
        { name: 'System prompt', tokens: 2371, kind: 'used' },
        { name: 'Tools (deferred)', tokens: 13357, isDeferred: true },
        { name: 'Autocompact buffer', tokens: 33000, kind: 'buffer' },
        { name: 'Free space', tokens: 951259, kind: 'free' }
      ]
    }, 5)
    expect(report).toMatchObject({ usedTokens: 15741, windowTokens: 1_000_000, percentage: 2, autoCompactAtTokens: 967_000, capturedAt: 5, source: 'claude-control', model: 'claude-x' })
    expect(report?.categories.map(category => category.kind)).toEqual(['used', 'deferred', 'buffer', 'free'])
  })

  it('drops reports that prove nothing and clamps hostile values', () => {
    expect(normalizeClaudeContext({})).toBeNull()
    expect(normalizeClaudeContext({ totalTokens: 10, maxTokens: 0 })).toBeNull()
    expect(normalizeClaudeContext({ totalTokens: -1, maxTokens: 100 })).toBeNull()
    const many = Array.from({ length: 80 }, (_, index) => ({ name: 'x'.repeat(200) + index, tokens: 1 }))
    const report = normalizeClaudeContext({ totalTokens: 500, maxTokens: 100, categories: [...many, { name: 'bad', tokens: Number.NaN }] })
    expect(report?.percentage).toBe(100)
    expect(report?.categories).toHaveLength(32)
    expect(report?.categories[0].name.length).toBe(64)
  })

  it('uses the last request of a Codex turn as the context size', () => {
    expect(normalizeCodexTokenUsage({ modelContextWindow: 200_000, last: { totalTokens: 50_000 }, total: { totalTokens: 900_000 } }, 'gpt', 7))
      .toMatchObject({ usedTokens: 50_000, windowTokens: 200_000, percentage: 25, categories: [], source: 'codex-token-usage', model: 'gpt' })
    expect(normalizeCodexTokenUsage({ modelContextWindow: null, last: { totalTokens: 1 } }, undefined)).toBeNull()
  })
})
