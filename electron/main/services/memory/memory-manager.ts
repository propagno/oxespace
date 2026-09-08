import type { MemoryContext, MemoryReply, MemorySettings } from '../../../../shared/types/memory'
import type { MemoryProvider } from './memory-provider'

/** No terminal dependency. Failure is data, and every operation has a bounded deadline. */
export class MemoryManager {
  constructor(private readonly provider: () => MemoryProvider, private readonly settings: (projectId: string) => MemorySettings, private readonly deadlineMs = 3000) {}
  async run<T>(context: MemoryContext, operation: (provider: MemoryProvider) => Promise<T>): Promise<MemoryReply<T>> {
    if (!this.settings(context.projectId).enabled) return { status: 'disabled', message: 'Project memory is disabled' }
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      const value = await Promise.race([operation(this.provider()), new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('Memory deadline exceeded')), this.deadlineMs)
      })])
      return { status: 'ok', value }
    } catch { return { status: 'unavailable', message: 'Project memory is temporarily unavailable. Agent execution can continue.' } }
    finally { if (timer) clearTimeout(timer) }
  }
}
