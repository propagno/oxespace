import type { ThreadContextReport, ThreadEvent } from '../../../shared/types/thread'

/** Where the provider's context categories go in the session panel. */
export type SessionContextBucket = 'messages' | 'tools' | 'mcp' | 'system' | 'skills'
export const SESSION_CONTEXT_BUCKETS: SessionContextBucket[] = ['messages', 'tools', 'mcp', 'system', 'skills']

export interface SessionContext {
  used: number
  window: number
  /** As the report says it; the panel never recomputes it, so it matches the composer's ring. */
  percent: number
  free: number
  /** Kept aside for compaction (Claude's auto-compact buffer). */
  reserved: number
  autoCompactAt?: number
  /** Used tokens per bucket, in SESSION_CONTEXT_BUCKETS order, zero ones left out. */
  rows: Array<{ bucket: SessionContextBucket; tokens: number }>
  /** Used tokens the report counts but does not itemize. */
  unattributed: number
  /** Loaded only when the agent asks for them; not part of `used`. */
  deferred: number
  /** The provider broke the context down by category (Claude does; Codex reports only the total). */
  itemized: boolean
  model?: string
  capturedAt: number
}

const count = (value: number): number => Number.isFinite(value) && value > 0 ? Math.round(value) : 0

/** Claude's /context names: "Messages", "System tools", "MCP tools", "Skills", "System prompt", "Memory files"… */
export function contextBucket(name: string): SessionContextBucket {
  if (/\bmcp\b/i.test(name)) return 'mcp'
  if (/skill/i.test(name)) return 'skills'
  if (/message|conversation/i.test(name)) return 'messages'
  if (/tool/i.test(name)) return 'tools'
  return 'system'
}

/**
 * The context the latest usage event reported, grouped for the panel. Pure: the same report the composer's
 * ring reads (thread.contextReport, written from each `context-usage` event), so the two never disagree.
 */
export function sessionContext(report: ThreadContextReport | undefined | null): SessionContext | null {
  if (!report) return null
  const window = count(report.windowTokens)
  if (!window) return null
  const used = count(report.usedTokens)
  const totals = new Map<SessionContextBucket, number>()
  let deferred = 0, reserved = 0, free: number | null = null, itemizedTotal = 0
  for (const category of report.categories ?? []) {
    const tokens = count(category.tokens)
    if (category.kind === 'deferred') deferred += tokens
    else if (category.kind === 'buffer') reserved += tokens
    else if (category.kind === 'free') free = (free ?? 0) + tokens
    else {
      const bucket = contextBucket(category.name)
      totals.set(bucket, (totals.get(bucket) ?? 0) + tokens)
      itemizedTotal += tokens
    }
  }
  return {
    used, window,
    percent: Math.max(0, Math.min(100, Math.round(report.percentage))),
    free: free ?? Math.max(0, window - used - reserved),
    reserved,
    ...(report.autoCompactAtTokens !== undefined ? { autoCompactAt: report.autoCompactAtTokens } : {}),
    rows: SESSION_CONTEXT_BUCKETS.flatMap(bucket => totals.get(bucket) ? [{ bucket, tokens: totals.get(bucket)! }] : []),
    unattributed: Math.max(0, used - itemizedTotal),
    deferred,
    itemized: itemizedTotal > 0,
    ...(report.model ? { model: report.model } : {}),
    capturedAt: report.capturedAt
  }
}

/** The report a run of usage events leaves on the thread: the newest one wins, as in the orchestrator. */
export function latestContextReport(events: ThreadEvent[], previous?: ThreadContextReport): ThreadContextReport | undefined {
  return events.reduce<ThreadContextReport | undefined>((current, event) => event.type === 'context-usage' ? event.report : current, previous)
}

/** Tools this conversation called, most used first. MCP tools (`mcp__server__tool`) keep their server. */
export function sessionToolUse(events: ThreadEvent[]): Array<{ name: string; calls: number; failed: number; mcpServer?: string }> {
  const byName = new Map<string, { name: string; calls: number; failed: number; mcpServer?: string }>()
  for (const event of events) {
    if (event.type !== 'tool' || !event.name.trim()) continue
    const name = event.name.trim()
    const mcp = /^mcp__(.+?)__(.+)$/.exec(name)
    const entry = byName.get(name) ?? { name: mcp ? mcp[2] : name, calls: 0, failed: 0, ...(mcp ? { mcpServer: mcp[1] } : {}) }
    entry.calls += 1
    if (event.state === 'failed') entry.failed += 1
    byName.set(name, entry)
  }
  return [...byName.values()].sort((a, b) => b.calls - a.calls || a.name.localeCompare(b.name))
}

/** Background work the provider reported and has not finished. */
export function sessionBackground(events: ThreadEvent[], reported?: { running: number }): { agents: number; tasks: number } {
  const agents = events.filter(event => event.type === 'subagent' && event.state === 'running').length
  return { agents, tasks: Math.max(0, reported?.running ?? 0) }
}

export type SessionSectionId = 'environment' | 'context' | 'tools' | 'outputs' | 'background'
export const SESSION_SECTIONS: SessionSectionId[] = ['environment', 'context', 'tools', 'outputs', 'background']
const ORDER_KEY = 'oxe.thread.sessionPanel.order'

/** Known sections in the stored order, then any the stored order lacks. Unknown and repeated ids are dropped. */
export function normalizeSectionOrder(value: unknown): SessionSectionId[] {
  const stored = Array.isArray(value) ? value.filter((id): id is SessionSectionId => SESSION_SECTIONS.includes(id as SessionSectionId)) : []
  const unique = [...new Set(stored)]
  return [...unique, ...SESSION_SECTIONS.filter(id => !unique.includes(id))]
}

/** Per viewer; storage can be missing or full (private mode, previews), and then the default order is used. */
export function readSectionOrder(): SessionSectionId[] {
  try { return normalizeSectionOrder(JSON.parse(localStorage.getItem(ORDER_KEY) ?? 'null')) } catch { return [...SESSION_SECTIONS] }
}

export function writeSectionOrder(order: SessionSectionId[]): void {
  try { localStorage.setItem(ORDER_KEY, JSON.stringify(normalizeSectionOrder(order))) } catch { /* storage unavailable: the order lasts for this view */ }
}

/** `id` moved to `index` (clamped); the others keep their relative order. */
export function moveSection(order: SessionSectionId[], id: SessionSectionId, index: number): SessionSectionId[] {
  const rest = order.filter(item => item !== id)
  if (rest.length === order.length) return order
  const target = Math.max(0, Math.min(rest.length, index))
  return [...rest.slice(0, target), id, ...rest.slice(target)]
}
