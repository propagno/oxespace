/**
 * OXE-483 · End-to-end node-pty watermark flow controller (100k / 5k + ACKs).
 *
 * Applies real OS/ConPTY backpressure (`pty.pause()` / `pty.resume()`) when an
 * attached renderer falls behind parsing heavy output bursts, and prevents
 * deadlocks on hidden, parked, detached, or unresponsive views:
 * - Starts disabled (`attached = false`) so headless / background agent PTYs never stall.
 * - On `setAttached(false)` (detach, park, unmount), immediately resets unacknowledged
 *   count to 0 and resumes the PTY if paused.
 * - Safety watchdog (`FLOW_CONTROL_WATCHDOG_MS`, default 5 s) force-resumes if a paused
 *   PTY receives no ACK progress while still marked attached.
 */
export const FLOW_CONTROL_HIGH_WATERMARK = 100_000
export const FLOW_CONTROL_LOW_WATERMARK = 5_000
export const FLOW_CONTROL_WATCHDOG_MS = 5_000

export interface PtyFlowControlTarget {
  pause(): void
  resume(): void
}

export interface PtyFlowControlOptions {
  highWatermark?: number
  lowWatermark?: number
  /** Auto-resume watchdog in ms if paused with zero ACK progress (0 disables). Default: 5000 ms. */
  watchdogMs?: number
  /** Initial attached state. Defaults to false so unattached background PTYs never pause. */
  attached?: boolean
  /** Optional hook notified when the safety watchdog force-resumes a stalled PTY. */
  onWatchdogResume?: (unackedChars: number) => void
}

export class PtyFlowControl {
  private readonly highWatermark: number
  private readonly lowWatermark: number
  private readonly watchdogMs: number
  private readonly onWatchdogResume?: (unackedChars: number) => void
  private unackedChars = 0
  private paused = false
  private attached: boolean
  private disposed = false
  private watchdog: ReturnType<typeof setTimeout> | null = null

  constructor(private readonly target: PtyFlowControlTarget, options: PtyFlowControlOptions = {}) {
    this.highWatermark = Math.max(1, options.highWatermark ?? FLOW_CONTROL_HIGH_WATERMARK)
    this.lowWatermark = Math.max(0, Math.min(this.highWatermark - 1, options.lowWatermark ?? FLOW_CONTROL_LOW_WATERMARK))
    this.watchdogMs = Math.max(0, options.watchdogMs ?? FLOW_CONTROL_WATCHDOG_MS)
    this.attached = options.attached ?? false
    this.onWatchdogResume = options.onWatchdogResume
  }

  get isPaused(): boolean {
    return this.paused
  }

  get isAttached(): boolean {
    return this.attached
  }

  get unacknowledgedChars(): number {
    return this.unackedChars
  }

  /** Toggle active renderer attachment. Always resets backlog and resumes if paused. */
  setAttached(attached: boolean): void {
    if (this.disposed) return
    this.attached = attached
    this.resetAndResume()
  }

  /** Account for emitted characters sent downstream; pauses PTY above highWatermark. */
  onData(charCount: number): void {
    if (this.disposed || !this.attached || !Number.isFinite(charCount) || charCount <= 0) return
    this.unackedChars += Math.floor(charCount)
    if (!this.paused && this.unackedChars > this.highWatermark) {
      this.paused = true
      this.armWatchdog()
      try { this.target.pause() } catch { /* exiting */ }
    }
  }

  /** Acknowledge characters processed by xterm; resumes PTY once at or below lowWatermark. */
  ack(charCount: number): void {
    if (this.disposed || !Number.isFinite(charCount) || charCount <= 0) return
    this.unackedChars = Math.max(0, this.unackedChars - Math.floor(charCount))
    if (!this.paused) return
    if (this.unackedChars <= this.lowWatermark) {
      this.paused = false
      this.clearWatchdog()
      try { this.target.resume() } catch { /* exiting */ }
    } else {
      // Renderer is actively draining — keep watchdog pushed forward while progress continues.
      this.armWatchdog()
    }
  }

  /** Immediately clear unacknowledged backlog and resume the PTY if paused. */
  resetAndResume(): void {
    this.unackedChars = 0
    this.clearWatchdog()
    if (this.paused) {
      this.paused = false
      try { this.target.resume() } catch { /* exiting */ }
    }
  }

  dispose(): void {
    this.disposed = true
    this.unackedChars = 0
    this.paused = false
    this.clearWatchdog()
  }

  private armWatchdog(): void {
    this.clearWatchdog()
    if (this.watchdogMs <= 0) return
    this.watchdog = setTimeout(() => {
      this.watchdog = null
      if (this.disposed || !this.paused) return
      const stalled = this.unackedChars
      this.unackedChars = 0
      this.paused = false
      this.onWatchdogResume?.(stalled)
      try { this.target.resume() } catch { /* exiting */ }
    }, this.watchdogMs)
    this.watchdog.unref?.()
  }

  private clearWatchdog(): void {
    if (this.watchdog !== null) {
      clearTimeout(this.watchdog)
      this.watchdog = null
    }
  }
}
