/**
 * OXE-483 · Origin-side PTY output batcher (5 ms / 32 KiB).
 *
 * Coalesces raw node-pty chunks in the utility PTY host and detached PTY daemon
 * before crossing IPC / socket boundaries or feeding headless xterm, cutting
 * high-frequency IPC message bursts by 10x–50x while keeping interactive latency <= 5 ms.
 *
 * Callers MUST call `flush()` synchronously before `resize` or `exit` to preserve
 * strict stream ordering.
 */
export const ORIGIN_BATCH_MS = 5
export const ORIGIN_BATCH_MAX_BYTES = 32 * 1024

export interface PtyOriginBatcherOptions {
  /** Maximum coalesce window in milliseconds before flushing buffered chunks (default: 5 ms). */
  flushMs?: number
  /** Maximum buffered characters before forcing an immediate synchronous flush (default: 32 KiB). */
  maxBytes?: number
  /** Invoked with the coalesced payload whenever a batch flushes. */
  onFlush: (data: string) => void
}

export class PtyOriginBatcher {
  private readonly flushMs: number
  private readonly maxBytes: number
  private readonly onFlush: (data: string) => void
  private chunks: string[] = []
  private pendingBytes = 0
  private timer: ReturnType<typeof setTimeout> | null = null
  private disposed = false

  constructor(options: PtyOriginBatcherOptions) {
    this.flushMs = Math.max(0, options.flushMs ?? ORIGIN_BATCH_MS)
    this.maxBytes = Math.max(1, options.maxBytes ?? ORIGIN_BATCH_MAX_BYTES)
    this.onFlush = options.onFlush
  }

  push(data: string): void {
    if (this.disposed || !data) return
    this.chunks.push(data)
    this.pendingBytes += data.length
    if (this.pendingBytes >= this.maxBytes) {
      this.flush()
      return
    }
    if (this.timer === null) {
      this.timer = setTimeout(() => {
        this.timer = null
        this.flush()
      }, this.flushMs)
    }
  }

  flush(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer)
      this.timer = null
    }
    if (this.pendingBytes === 0) return
    const data = this.chunks.length === 1 ? this.chunks[0] : this.chunks.join('')
    this.chunks = []
    this.pendingBytes = 0
    this.onFlush(data)
  }

  dispose(): void {
    this.disposed = true
    if (this.timer !== null) {
      clearTimeout(this.timer)
      this.timer = null
    }
    this.chunks = []
    this.pendingBytes = 0
  }

  pendingLength(): number {
    return this.pendingBytes
  }
}
