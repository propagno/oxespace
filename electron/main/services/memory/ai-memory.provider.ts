import { randomUUID } from 'node:crypto'
import type { MemoryContext, MemoryHandoff, MemoryHealth, MemoryInput, MemoryResult, MemorySession, ProjectContext } from '../../../../shared/types/memory'
import type { MemoryProvider } from './memory-provider'
import { AiMemoryClient } from './ai-memory.client'

export class AiMemoryProvider implements MemoryProvider {
  constructor(private readonly client: AiMemoryClient) {}
  async start(): Promise<void> { await this.client.initialize() }
  async stop(): Promise<void> { /* Client only: runtime owns the server. */ }
  async health(): Promise<MemoryHealth> {
    try { await this.client.request('/admin/status'); return { status: 'ready' } }
    catch { return { status: 'unavailable', message: 'AI Memory is not reachable or authentication failed' } }
  }
  private scope(ctx: MemoryContext): { workspace: string; project: string } {
    if (!ctx.workspace || !ctx.project || !ctx.projectId) throw new Error('Explicit memory scope required')
    return { workspace: ctx.workspace, project: ctx.project }
  }
  private base(ctx: MemoryContext): string {
    this.scope(ctx)
    return `/api/v1/workspaces/${encodeURIComponent(ctx.workspace)}/projects/${encodeURIComponent(ctx.project)}`
  }
  async remember(ctx: MemoryContext, input: MemoryInput): Promise<void> {
    if (!input.text.trim() || input.text.length > 16000) throw new Error('Memory text must contain 1–16000 characters')
    await this.client.tool('memory_write_page', { ...this.scope(ctx), path: `decisions/oxe-${randomUUID()}.md`,
      body: `# ${input.title?.slice(0, 160) || 'Project learning'}\n\n${input.text}\n\nSource: ${ctx.agentId ?? 'oxespace'}; session: ${ctx.sessionId ?? 'unbound'}; checkout: ${ctx.cwd}`, tier: 'semantic', tags: ['oxespace'] })
  }
  async search(ctx: MemoryContext, query: string): Promise<MemoryResult[]> {
    if (!query.trim() || query.length > 1000) throw new Error('Query must contain 1–1000 characters')
    const result = await this.client.tool('memory_query', { ...this.scope(ctx), query, limit: 8 })
    return results(result)
  }
  async recent(ctx: MemoryContext): Promise<MemoryResult[]> {
    return results(await this.client.tool('memory_recent', { ...this.scope(ctx), limit: 8 }))
  }
  async getRelevantContext(ctx: MemoryContext, task?: string): Promise<ProjectContext> {
    const [items, history] = await Promise.all([
      task ? this.search(ctx, task) : this.recent(ctx),
      this.listHandoffs(ctx).catch(() => [])
    ])
    const terms = task?.toLowerCase().split(/\s+/).filter(term => term.length > 2)
    const handoffs = history.filter(h => h.summary && (!terms?.length || terms.some(term => h.summary.toLowerCase().includes(term)))).slice(0, 2)
    return { text: [items.map(i => i.text).join('\n\n').slice(0, 2400),
      ...handoffs.map(h => `Historical handoff (${h.cwd ?? 'unknown checkout'}; state: ${h.state}; read-only): ${[h.summary, ...h.nextSteps, ...h.openQuestions].join('\n').slice(0, 650)}`)].filter(Boolean).join('\n\n').slice(0, 4000),
    sources: [...items.map(i => i.path ?? i.source), ...handoffs.map(h => `handoff:${h.id}`)] }
  }
  async getRecentSessions(ctx: MemoryContext): Promise<MemorySession[]> {
    const result = await this.client.request(`${this.base(ctx)}/sessions?limit=20&include_open=true`) as { sessions?: Record<string, unknown>[] }
    return (result.sessions ?? []).map(s => ({ sessionId: String(s.session_id ?? ''), agentId: String(s.agent ?? s.agent_kind ?? ''), cwd: String(s.cwd ?? ''), ended: !!s.ended_at }))
  }
  async listHandoffs(ctx: MemoryContext): Promise<MemoryHandoff[]> {
    const result = await this.client.request(`${this.base(ctx)}/handoffs?limit=20`) as { handoffs?: Record<string, unknown>[] }
    const strings = (value: unknown): string[] => Array.isArray(value) ? value.filter((s): s is string => typeof s === 'string').slice(0, 20) : []
    return (result.handoffs ?? []).map(h => ({ id: String(h.id), summary: String(h.summary ?? ''), cwd: typeof h.cwd === 'string' ? h.cwd : undefined,
      state: String(h.state), nextSteps: strings(h.next_steps), openQuestions: strings(h.open_questions), filesTouched: strings(h.files_touched) }))
  }
  async acceptHandoff(ctx: MemoryContext): Promise<unknown> {
    return this.client.tool('memory_handoff_accept', { ...this.scope(ctx), cwd: ctx.cwd })
  }
}

function results(value: unknown): MemoryResult[] {
  // Keep provider-native provenance and bounded snippets, never a global union.
  const object = value && typeof value === 'object' ? value as Record<string, unknown> : {}
  const list = Array.isArray(value) ? value : [object.hits, object.pages, object.recent, object.raw_hits].find(items => Array.isArray(items) && items.length) ?? []
  if (!Array.isArray(list)) return []
  return list.slice(0, 8).map(item => {
    const row = item as Record<string, unknown>
    const snippet = typeof row.snippet === 'string' ? row.snippet.replace(/<\/?mark>/g, '') : JSON.stringify(item)
    return { source: 'ai-memory', path: typeof row.path === 'string' ? row.path : undefined, text: snippet.slice(0, 2000) }
  })
}
