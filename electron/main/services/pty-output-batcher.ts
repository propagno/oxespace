export interface PtyOutputEvent {
  paneId: string
  data: string
}

/** Batches PTY output into bounded renderer messages while preserving order. */
export class PtyOutputBatcher {
  private pending = ''
  private timer: ReturnType<typeof setTimeout> | null = null

  constructor(
    private readonly paneId: string,
    private readonly emit: (event: PtyOutputEvent) => void,
    private readonly flushMs = 16,
    private readonly flushBytes = 32 * 1024
  ) {}

  push(data: string): void {
    if (!data) return
    this.pending += data
    if (this.pending.length >= this.flushBytes) {
      this.flush()
      return
    }
    if (this.timer === null) this.timer = setTimeout(() => this.flush(), this.flushMs)
  }

  flush(): void {
    if (this.timer !== null) clearTimeout(this.timer)
    this.timer = null
    if (!this.pending) return
    const data = this.pending
    this.pending = ''
    this.emit({ paneId: this.paneId, data })
  }

  dispose(): void {
    if (this.timer !== null) clearTimeout(this.timer)
    this.timer = null
    this.pending = ''
  }
}
