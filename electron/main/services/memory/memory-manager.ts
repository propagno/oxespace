import type { MemoryContext, MemoryReply, MemorySettings } from '../../../../shared/types/memory'
import type { MemoryProvider } from './memory-provider'

/** No terminal dependency. Failure is data, and every operation has a bounded deadline. */
export class MemoryManager {
  private readonly activity = new Map<string, { lastSuccessAt: number | null; lastFailureAt: number | null; lastWriteAt: number | null; lastReadAt: number | null }>()
  observations(projectId: string) {
    return { source: 'oxespace-provider-replies', retained: 'application-lifetime', lastSuccessAt: null, lastFailureAt: null,
      lastWriteAt: null, lastReadAt: null, ...this.activity.get(projectId) }
  }
  constructor(private readonly provider: () => MemoryProvider, private readonly settings: (projectId: string) => MemorySettings, private readonly deadlineMs = 3000) {}
  async run<T>(context: MemoryContext, operation: (provider: MemoryProvider) => Promise<T>, kind?: 'read' | 'write'): Promise<MemoryReply<T>> {
    if (!this.settings(context.projectId).enabled) return { status: 'disabled', message: 'Project memory is disabled' }
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      const value = await Promise.race([operation(this.provider()), new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('Memory deadline exceeded')), this.deadlineMs)
      })])
      const metrics = this.activity.get(context.projectId) ?? { lastSuccessAt: null, lastFailureAt: null, lastWriteAt: null, lastReadAt: null }
      metrics.lastSuccessAt = Date.now()
      if (kind === 'write') metrics.lastWriteAt = metrics.lastSuccessAt
      if (kind === 'read') metrics.lastReadAt = metrics.lastSuccessAt
      if (this.activity.size >= 512 && !this.activity.has(context.projectId)) this.activity.delete(this.activity.keys().next().value!)
      this.activity.set(context.projectId, metrics)
      return { status: 'ok', value }
    } catch {
      const metrics = this.activity.get(context.projectId) ?? { lastSuccessAt: null, lastFailureAt: null, lastWriteAt: null, lastReadAt: null }
      metrics.lastFailureAt = Date.now()
      if (this.activity.size >= 512 && !this.activity.has(context.projectId)) this.activity.delete(this.activity.keys().next().value!)
      this.activity.set(context.projectId, metrics)
      return { status: 'unavailable', message: 'Project memory is temporarily unavailable. Agent execution can continue.' }
    }
    finally { if (timer) clearTimeout(timer) }
  }
}
