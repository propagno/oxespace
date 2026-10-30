import type { MemoryContext, MemoryHandoff, MemoryHealth, MemoryInput, MemoryResult, MemorySession, ProjectContext } from '../../../../shared/types/memory'

export interface MemoryProvider {
  withSignal?(signal: AbortSignal): MemoryProvider
  start(): Promise<void>
  stop(): Promise<void>
  health(): Promise<MemoryHealth>
  /** The page the note was written to, when the provider knows it. */
  remember(context: MemoryContext, memory: MemoryInput): Promise<{ path: string } | void>
  search(context: MemoryContext, query: string): Promise<MemoryResult[]>
  recent(context: MemoryContext): Promise<MemoryResult[]>
  getRelevantContext(context: MemoryContext, task?: string): Promise<ProjectContext>
  getRecentSessions(context: MemoryContext): Promise<MemorySession[]>
  listHandoffs(context: MemoryContext): Promise<MemoryHandoff[]>
  /** Erases one page from the store, when the service offers a way; false when it does not (the page is then only hidden). */
  erase?(context: MemoryContext, path: string): Promise<boolean>
  /** Accepts exactly the offer with this ID; never falls back to another eligible offer. */
  acceptHandoff(context: MemoryContext, handoffId: string): Promise<unknown>
}
