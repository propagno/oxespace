import type { AgentProvider } from '../../../../shared/types/agent'
import { emptyContextUsage, type ContextUsageChip } from '../../../../shared/types/contextUsage'
import { UsageService } from '../usage.service'
import { readCopilotContext } from './copilotContext'

/**
 * Computes the live "context window %" for a pane's provider — the `/context`
 * meter. Reuses the existing UsageService (which already parses Claude/Codex
 * transcripts into lastTurn tokens + contextLimit); Copilot is read from its
 * process logs. Cached briefly since the chip polls ~every 5s.
 */
const TTL_MS = 3_000

export class ContextUsageService {
  private readonly usage: UsageService
  private cache = new Map<string, { value: ContextUsageChip; at: number }>()

  constructor(usage?: UsageService) {
    this.usage = usage ?? new UsageService()
  }

  get(provider: AgentProvider, workspaceRootPath: string, sessionId?: string | null, force = false): ContextUsageChip {
    const key = `${provider}|${workspaceRootPath}|${sessionId ?? ''}`
    const hit = this.cache.get(key)
    if (!force && hit && Date.now() - hit.at < TTL_MS) return hit.value
    const value = this.compute(provider, workspaceRootPath, sessionId)
    this.cache.set(key, { value, at: Date.now() })
    return value
  }

  private compute(provider: AgentProvider, workspaceRootPath: string, sessionId?: string | null): ContextUsageChip {
    const base = emptyContextUsage(provider)
    try {
      if (provider === 'copilot' || provider === 'gh-copilot') {
        const reading = readCopilotContext(workspaceRootPath)
        if (!reading) return base
        return { ...base, available: true, ...reading }
      }

      // Claude / Codex: reuse the transcript-parsing providers. lastTurn tokens
      // represent the current context fill (input + cache + output reloaded next turn).
      const snap = this.usage.getSnapshotFor(provider, workspaceRootPath, sessionId)
      if (!snap.available || !snap.contextLimit || snap.contextLimit <= 0) return base
      const usedTokens =
        snap.lastTurnInputTokens +
        snap.lastTurnCacheCreationTokens +
        snap.lastTurnCacheReadTokens +
        snap.lastTurnOutputTokens
      if (usedTokens <= 0) return base
      return {
        ...base,
        available: true,
        usedTokens,
        limitTokens: snap.contextLimit,
        usedPct: clampPct((usedTokens / snap.contextLimit) * 100),
        modelId: snap.modelId
      }
    } catch (err) {
      return { ...base, error: err instanceof Error ? err.message : String(err) }
    }
  }
}

function clampPct(n: number): number {
  if (!Number.isFinite(n)) return 0
  return Math.max(0, Math.min(100, Math.round(n)))
}
