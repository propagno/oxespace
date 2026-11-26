/**
 * Bounded, append-only view of a PTY's recent output, kept in the main process
 * so a pane's terminal can be re-rendered without respawning its shell.
 *
 * Before this existed, output for a pane whose renderer view was unmounted was
 * broadcast over IPC and dropped on the floor, so the only way to "restore" a
 * terminal was to kill the shell and start a new one — which is exactly what
 * made switching workspaces cost seconds.
 *
 * Deliberately NOT a scrollback replacement: the `scrollback` pref allows 50k
 * lines (~4 MB), and replaying that into a fresh xterm would cost hundreds of
 * milliseconds — reintroducing the latency this whole mechanism removes. This
 * holds the last few screens plus recent context; full scrollback survives by
 * keeping the pane mounted.
 */
import { endsWithHighSurrogate, scanVtState, skipPartialVtSequence, type VtTailState } from '../../../shared/vt-trim'

export interface PtyRingSlice {
  data: string
  /** True when the requested `seq` had already been evicted from the head. */
  truncated: boolean
}

export const DEFAULT_RING_CAPACITY_BYTES = 1024 * 1024

export class PtyRingBuffer {
  /** Retained chunks, oldest first. Head chunk may be trimmed past a partial VT sequence after eviction. */
  private chunks: string[] = []
  private bytes = 0
  /** Total characters ever pushed. Monotonic; survives eviction. */
  private pushed = 0
  /** Total characters evicted from the head. `pushed - dropped` = retained. */
  private dropped = 0
  /** VT parser state at the eviction boundary so survivors never start mid-escape-sequence. */
  private evictedState: VtTailState = 'ground'
  private evictedHighSurrogate = false

  constructor(private readonly capacity = DEFAULT_RING_CAPACITY_BYTES) {}

  /** Monotonic cursor a consumer can hand back to `since()`. */
  get seq(): number {
    return this.pushed
  }

  /** True once at least one character has been evicted from the head of the ring. */
  get evicted(): boolean {
    return this.dropped > 0
  }

  push(data: string): void {
    if (!data) return
    this.chunks.push(data)
    this.bytes += data.length
    this.pushed += data.length

    // Evict WHOLE chunks only while over capacity. After eviction, advance past
    // any partial VT sequence or split surrogate pair left at the head so a
    // reattached terminal never renders orphaned escape parameters as text.
    while (this.bytes > this.capacity && this.chunks.length > 1) {
      const evicted = this.chunks.shift()
      if (evicted === undefined) break
      this.bytes -= evicted.length
      this.dropped += evicted.length
      this.evictedState = scanVtState(evicted, this.evictedState)
      this.evictedHighSurrogate = endsWithHighSurrogate(evicted)
    }

    while (this.chunks.length > 0 && (this.evictedState !== 'ground' || this.evictedHighSurrogate)) {
      const headChunk = this.chunks[0]
      let start = 0
      if (this.evictedHighSurrogate && this.evictedState === 'ground') {
        const code = headChunk.charCodeAt(0)
        if (code >= 0xdc00 && code <= 0xdfff) start = 1
      }
      this.evictedHighSurrogate = false
      const { offset, state } = skipPartialVtSequence(headChunk, this.evictedState, start)
      this.evictedState = state
      if (offset === 0) break
      if (offset >= headChunk.length) {
        this.chunks.shift()
        this.bytes -= headChunk.length
        this.dropped += headChunk.length
      } else {
        this.chunks[0] = headChunk.slice(offset)
        this.bytes -= offset
        this.dropped += offset
        break
      }
    }
  }

  /** Everything currently retained. */
  snapshot(): string {
    return this.chunks.join('')
  }

  /**
   * Output produced after `seq`. A consumer that has been away longer than the
   * buffer is deep gets everything retained plus `truncated: true`, so it can
   * clear its view instead of appending onto a stale, incomplete screen.
   */
  since(seq: number): PtyRingSlice {
    // Everything the consumer missed is already gone: hand back what is left
    // and flag it, so the caller clears its view instead of appending onto a
    // stale screen.
    if (!Number.isFinite(seq) || seq <= this.dropped) {
      return { data: this.snapshot(), truncated: Number.isFinite(seq) && seq > 0 && seq < this.dropped }
    }
    if (seq >= this.pushed) return { data: '', truncated: false }

    const retained = this.snapshot()
    let offset = seq - this.dropped
    // Never start on a lone low surrogate — pull its high half back in. Costs
    // one duplicated code unit and keeps the pair (and the glyph) intact.
    const code = retained.charCodeAt(offset)
    if (code >= 0xdc00 && code <= 0xdfff && offset > 0) offset -= 1
    return { data: retained.slice(offset), truncated: false }
  }

  clear(): void {
    // `pushed` is intentionally NOT reset: a consumer holding an old cursor
    // must not be told "nothing new happened" after a restart.
    this.dropped = this.pushed
    this.chunks = []
    this.bytes = 0
    this.evictedState = 'ground'
    this.evictedHighSurrogate = false
  }
}
