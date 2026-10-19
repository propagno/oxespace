import type { ThreadEvent } from '../../../../shared/types/thread'

type Reasoning = Extract<ThreadEvent, { type: 'reasoning' }>

/** Longest reasoning kept per block; the start is dropped, as the latest thought is what the person follows. */
export const REASONING_MAX_CHARS = 32_000
const EMIT_INTERVAL_MS = 500

/**
 * Accumulates streamed reasoning per block and re-emits it whole, at most every
 * 500 ms while it grows, then once more when the block completes. A block never
 * completed explicitly is closed by `completeAll` when the turn ends, so nothing
 * stays "thinking" in the history.
 */
export class ReasoningStream {
  private readonly blocks = new Map<string, { text: string; startedAt: number; emittedAt: number }>()

  constructor(private readonly emit: (event: Reasoning) => void, private readonly now: () => number = Date.now) {}

  begin(id: string): void {
    if (!this.blocks.has(id)) this.blocks.set(id, { text: '', startedAt: this.now(), emittedAt: 0 })
  }

  append(id: string, delta: string): void {
    if (!delta) return
    this.begin(id)
    const block = this.blocks.get(id)!
    block.text = (block.text + delta).slice(-REASONING_MAX_CHARS)
    const now = this.now()
    if (now - block.emittedAt < EMIT_INTERVAL_MS) return
    block.emittedAt = now
    this.emit({ type: 'reasoning', id, text: block.text, startedAt: block.startedAt })
  }

  /** Closes the block; `text` replaces what streamed when the provider sends the whole thought at the end. */
  complete(id: string, text?: string): void {
    const block = this.blocks.get(id)
    this.blocks.delete(id)
    const final = (text || block?.text || '').slice(-REASONING_MAX_CHARS)
    if (!final.trim()) return
    const now = this.now()
    this.emit({ type: 'reasoning', id, text: final, startedAt: block?.startedAt ?? now, completedAt: now })
  }

  has(id: string): boolean { return this.blocks.has(id) }

  completeAll(): void { for (const id of [...this.blocks.keys()]) this.complete(id) }

  clear(): void { this.blocks.clear() }
}
