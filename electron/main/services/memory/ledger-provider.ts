import { redactSecrets } from '../../../../shared/secrets'
import type { MemoryContext, MemoryHandoff, MemoryHealth, MemoryInput, MemoryOriginKind, MemoryResult, MemorySession, ProjectContext } from '../../../../shared/types/memory'
import { buildProjectContext } from './memory-context'
import type { MemoryLedger } from './memory-ledger'
import type { MemoryProvider } from './memory-provider'

/**
 * Wraps a memory provider so that every note passes through the app's ledger (roadmap M3, M5, M7): what an agent
 * records is stored with its origin and marked untrusted, what it reads has removed, wrong and expired notes
 * taken out, and what it is given is fenced as data. The ledger is local, so these rules hold whichever memory
 * service sits underneath.
 */
export class LedgerProvider implements MemoryProvider {
  constructor(private readonly inner: MemoryProvider, private readonly ledger: MemoryLedger) {}

  withSignal(signal: AbortSignal): LedgerProvider {
    return new LedgerProvider(this.inner.withSignal?.(signal) ?? this.inner, this.ledger)
  }
  start(): Promise<void> { return this.inner.start() }
  stop(): Promise<void> { return this.inner.stop() }
  health(): Promise<MemoryHealth> { return this.inner.health() }
  getRecentSessions(context: MemoryContext): Promise<MemorySession[]> { return this.inner.getRecentSessions(context) }
  listHandoffs(context: MemoryContext): Promise<MemoryHandoff[]> { return this.inner.listHandoffs(context) }
  acceptHandoff(context: MemoryContext, handoffId: string): Promise<unknown> { return this.inner.acceptHandoff(context, handoffId) }
  async erase(context: MemoryContext, path: string): Promise<boolean> { return (await this.inner.erase?.(context, path)) ?? false }

  /** `origin` is decided by the app, never by the agent: an agent’s note is untrusted until a person reviews it. */
  async remember(context: MemoryContext, input: MemoryInput & { origin?: MemoryOriginKind }): Promise<{ path: string } | void> {
    // Secrets never reach the store, whatever the agent was told to leave out.
    const text = redactSecrets(input.text)
    const written = await this.inner.remember(context, { text, ...(input.title ? { title: input.title } : {}), ...(input.kind ? { kind: input.kind } : {}),
      ...(input.supersedes ? { supersedes: input.supersedes } : {}) })
    if (written && 'path' in written) {
      this.ledger.record(context.projectId, { path: written.path, text, title: input.title, kind: input.kind, supersedes: input.supersedes,
        origin: { kind: input.origin ?? 'agent', agentId: context.agentId, sessionId: context.sessionId, threadId: context.threadId, excerpt: context.originExcerpt } })
    }
    return written
  }

  private seen(context: MemoryContext, results: MemoryResult[]): MemoryResult[] {
    const kept = this.ledger.annotate(context.projectId, results, { audience: context.audience, automatic: context.automatic })
    // Only an agent is counted; a person looking in Settings is not a use.
    if (context.agentId) this.ledger.touch(context.projectId, kept.flatMap(item => item.path ? [item.path] : []), context.agentId, context.sessionId)
    return kept
  }

  async search(context: MemoryContext, query: string): Promise<MemoryResult[]> {
    return this.seen(context, await this.inner.search(context, query))
  }
  async recent(context: MemoryContext): Promise<MemoryResult[]> {
    return this.seen(context, await this.inner.recent(context))
  }

  async getRelevantContext(context: MemoryContext, task?: string): Promise<ProjectContext> {
    const options = { audience: context.audience, automatic: context.automatic }
    // The inner search is not counted as a use: only what is finally given to the agent is.
    const found = this.ledger.annotate(context.projectId, task ? await this.inner.search(context, task) : await this.inner.recent(context), options)
    const pinned = this.ledger.pinned(context.projectId, options)
    const items = [...pinned, ...found.filter(item => !pinned.some(note => note.path === item.path))]
    const terms = task?.toLowerCase().split(/\s+/).filter(term => term.length > 2)
    const handoffs = (await this.inner.listHandoffs(context).catch(() => []))
      .filter(h => h.summary && (!terms?.length || terms.some(term => h.summary.toLowerCase().includes(term)))).slice(0, 2)
    const brief = buildProjectContext(items, handoffs)
    if (context.agentId) this.ledger.touch(context.projectId, brief.sources.filter(source => !source.startsWith('handoff:')), context.agentId, context.sessionId)
    return brief
  }
}
