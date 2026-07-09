export interface PtyInputTarget {
  write(data: string): void
}

export const DEFAULT_INPUT_HIGH_WATERMARK = 16 * 1024 * 1024
export const DEFAULT_INPUT_RESUME_WATERMARK = 8 * 1024 * 1024

/**
 * Serializes terminal input so rapid renderer/IPC messages cannot overwhelm
 * node-pty. Clipboard pastes remain ordered and complete while normal typing
 * still writes its first chunk immediately.
 */
export class PtyInputQueue {
  private pending: string[] = []
  private pendingBytes = 0
  private readonly backpressureWaiters: Array<() => void> = []
  private timer: ReturnType<typeof setTimeout> | null = null
  private disposed = false

  constructor(
    private readonly target: PtyInputTarget,
    private readonly chunkSize = 8 * 1024,
    private readonly yieldMs = 1,
    private readonly highWatermark = DEFAULT_INPUT_HIGH_WATERMARK,
    private readonly resumeWatermark = DEFAULT_INPUT_RESUME_WATERMARK
  ) {
    if (resumeWatermark > highWatermark) {
      throw new Error('Input resume watermark must not exceed the high watermark')
    }
  }

  enqueue(data: string): Promise<void> {
    if (this.disposed || !data) return Promise.resolve()
    const shouldApplyBackpressure = this.pendingBytes >= this.highWatermark || this.pendingBytes + data.length > this.highWatermark
    this.pending.push(data)
    this.pendingBytes += data.length
    this.drain()
    if (!shouldApplyBackpressure) return Promise.resolve()
    return new Promise((resolve) => this.backpressureWaiters.push(resolve))
  }

  dispose(): void {
    this.disposed = true
    this.pending = []
    this.pendingBytes = 0
    this.releaseBackpressureWaiters()
    if (this.timer !== null) clearTimeout(this.timer)
    this.timer = null
  }

  private drain(): void {
    if (this.timer !== null || this.disposed) return
    this.writeNext()
  }

  private writeNext = (): void => {
    this.timer = null
    if (this.disposed || this.pendingBytes === 0) return

    const chunk = this.takeChunk()
    this.target.write(chunk)

    if (this.pendingBytes <= this.resumeWatermark) this.releaseBackpressureWaiters()
    if (this.pendingBytes > 0) this.timer = setTimeout(this.writeNext, this.yieldMs)
  }

  private takeChunk(): string {
    let remaining = this.chunkSize
    const chunks: string[] = []
    while (remaining > 0 && this.pending.length > 0) {
      const head = this.pending[0]
      if (head.length <= remaining) {
        chunks.push(head)
        this.pending.shift()
        this.pendingBytes -= head.length
        remaining -= head.length
      } else {
        chunks.push(head.slice(0, remaining))
        this.pending[0] = head.slice(remaining)
        this.pendingBytes -= remaining
        remaining = 0
      }
    }
    return chunks.join('')
  }

  private releaseBackpressureWaiters(): void {
    for (const resolve of this.backpressureWaiters.splice(0)) resolve()
  }
}
