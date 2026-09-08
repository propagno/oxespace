import type { MemoryContext, MemoryHandoff, MemoryHealth, MemoryInput, MemoryResult, MemorySession, ProjectContext } from '../../../../shared/types/memory'

export interface MemoryProvider {
  start(): Promise<void>
  stop(): Promise<void>
  health(): Promise<MemoryHealth>
  remember(context: MemoryContext, memory: MemoryInput): Promise<void>
  search(context: MemoryContext, query: string): Promise<MemoryResult[]>
  recent(context: MemoryContext): Promise<MemoryResult[]>
  getRelevantContext(context: MemoryContext, task?: string): Promise<ProjectContext>
  getRecentSessions(context: MemoryContext): Promise<MemorySession[]>
  listHandoffs(context: MemoryContext): Promise<MemoryHandoff[]>
  acceptHandoff(context: MemoryContext): Promise<unknown>
}
