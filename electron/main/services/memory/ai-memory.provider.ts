import { createHash } from 'node:crypto'
import { MEMORY_KINDS, type MemoryContext, MemoryHandoff, MemoryHealth, MemoryInput, MemoryResult, MemorySession, ProjectContext } from '../../../../shared/types/memory'
import type { MemoryProvider } from './memory-provider'
import { AiMemoryClient, MemoryClientError } from './ai-memory.client'

export class AiMemoryProvider implements MemoryProvider {
  /**
   * Page writes go one at a time: AI Memory 2.6 creates a project's folders on first write, and two writes
   * at once can both try to, so one fails with "file already exists" (os error 183 on Windows).
   */
  private writes: Promise<unknown> = Promise.resolve()
  constructor(private readonly client: AiMemoryClient) {}
  withSignal(signal: AbortSignal): AiMemoryProvider { return new AiMemoryProvider(this.client.withSignal(signal)) }
  async start(): Promise<void> { await this.client.initialize() }
  async stop(): Promise<void> { /* Client only: runtime owns the server. */ }
  async health(): Promise<MemoryHealth> {
    // A successful API probe does not confirm ingestion or background work.
    const pipeline = { capture: 'unknown', delivery: 'unknown', consolidation: 'unknown' } as const
    try { await this.client.request('/admin/status'); return { status: 'ready', pipeline } }
    catch (error) { return { status: 'unavailable', message: 'AI Memory is not reachable or authentication failed',
      errorCode: error instanceof MemoryClientError ? error.code : 'transport', pipeline } }
  }
  private scope(ctx: MemoryContext): { workspace: string; project: string } {
    if (!ctx.workspace || !ctx.project || !ctx.projectId) throw new Error('Explicit memory scope required')
    return { workspace: ctx.workspace, project: ctx.project }
  }
  private base(ctx: MemoryContext): string {
    this.scope(ctx)
    return `/api/v1/workspaces/${encodeURIComponent(ctx.workspace)}/projects/${encodeURIComponent(ctx.project)}`
  }
  async remember(ctx: MemoryContext, input: MemoryInput): Promise<{ path: string }> {
    if (!input.text.trim() || input.text.length > 16000) throw new Error('Memory text must contain 1–16000 characters')
    if (input.kind !== undefined && !MEMORY_KINDS.includes(input.kind)) throw new Error('Unknown memory kind')
    if (input.supersedes !== undefined && !PAGE_PATH.test(input.supersedes)) throw new Error('supersedes must be the path of an OXESpace memory page')
    // The same note written twice lands on the same page; different wording stays a different page.
    const id = createHash('sha256').update(JSON.stringify([ctx.projectId, input.kind ?? '', input.supersedes ?? '', input.title ?? '', input.text.trim()])).digest('hex').slice(0, 32)
    const path = `decisions/oxe-${id}.md`
    if (input.supersedes === path) throw new Error('A note cannot supersede itself')
    const header = [input.kind && `Kind: ${input.kind}`, input.supersedes && `Supersedes: ${input.supersedes}`].filter(Boolean).join('\n')
    const write = this.writes.catch(() => {}).then(() => this.client.tool('memory_write_page', { ...this.scope(ctx), path,
      body: `# ${input.title?.slice(0, 160) || 'Project learning'}\n\n${header ? `${header}\n\n` : ''}${input.text}\n\nSource: ${ctx.agentId ?? 'oxespace'}; session: ${ctx.sessionId ?? 'unbound'}; checkout: ${ctx.cwd}`,
      tier: 'semantic', tags: ['oxespace', ...(input.kind ? [input.kind] : [])] }))
    this.writes = write
    await write
    return { path }
  }
  /** Only when the server advertises a page-deletion tool; this build of AI Memory is not assumed to have one. */
  async erase(ctx: MemoryContext, path: string): Promise<boolean> {
    if (!(await this.client.capabilities()).deletePage) return false
    await this.client.tool('memory_delete_page', { ...this.scope(ctx), path })
    return true
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
    // Fencing is loaded when a brief is built, not at start-up.
    return (await import('./memory-context')).buildProjectContext(items, handoffs)
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
  async acceptHandoff(ctx: MemoryContext, handoffId: string): Promise<unknown> {
    if (!handoffId.trim()) throw new Error('A handoff id is required; list the offers first')
    // An older server would ignore the id and consume whichever offer it likes.
    if (!(await this.client.capabilities()).exactHandoff) throw new Error('This memory server cannot accept a specific handoff; nothing was consumed')
    const offer = (await this.listHandoffs(ctx)).find(handoff => handoff.id === handoffId)
    if (!offer) throw new Error('Handoff offer not found for this project; it may have been consumed elsewhere. List the offers again')
    if (offer.state === 'accepted') throw new Error('Handoff offer was already accepted; list the offers again')
    return this.client.tool('memory_handoff_accept', { ...this.scope(ctx), cwd: ctx.cwd, handoff_id: handoffId })
  }
}

const PAGE_PATH = /^decisions\/oxe-[0-9a-f-]{8,36}\.md$/

function results(value: unknown): MemoryResult[] {
  // Keep provider-native provenance and bounded snippets, never a global union.
  const object = value && typeof value === 'object' ? value as Record<string, unknown> : {}
  const list = Array.isArray(value) ? value : [object.hits, object.pages, object.recent, object.raw_hits].find(items => Array.isArray(items) && items.length) ?? []
  if (!Array.isArray(list)) return []
  const seen = new Set<string>()
  return list.filter(item => {
    const path = (item as Record<string, unknown> | null)?.path
    if (typeof path !== 'string') return true
    if (seen.has(path)) return false
    seen.add(path)
    return true
  }).slice(0, 8).map(item => {
    const row = item as Record<string, unknown>
    const snippet = typeof row.snippet === 'string' ? row.snippet.replace(/<\/?mark>/g, '') : JSON.stringify(item)
    const updated = row.updated_at ?? row.updated
    return { source: 'ai-memory', path: typeof row.path === 'string' ? row.path : undefined, text: snippet.slice(0, 2000),
      ...(typeof row.title === 'string' ? { title: row.title.slice(0, 160) } : {}),
      ...(typeof updated === 'string' ? { updatedAt: updated.slice(0, 40) } : {}),
      ...(typeof row.score === 'number' && Number.isFinite(row.score) ? { score: row.score } : {}) }
  })
}
