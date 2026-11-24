/**
 * OXE-392: node-pty 1.1.0 hands a terminal's exit to JS from its waitpid thread (SetupExitCallback, a
 * ThreadSafeFunction). If that exit arrives while the JS environment is going away, the `cb.Call` inside CallJS throws
 * a C++ Napi::Error nobody catches and the app aborts (SIGABRT). The newest release (1.2.0-beta.18) has the same code.
 * So on quit every terminal is stopped and its exit is waited for while JS still runs: then no exit is left to arrive
 * during teardown. A terminal still running after the grace is SIGKILLed; the deadline bounds the wait for one that
 * never reports, and that case is logged once per quit (a count, never the terminal's output).
 */
export const QUIT_DRAIN_GRACE_MS = 1_500
export const QUIT_DRAIN_DEADLINE_MS = 3_000
/**
 * On quit, the SIGTERM grace a terminal's process tree gets before SIGKILL (process-tree.ts uses 500 ms otherwise). Before
 * the drain the app exited about 100 to 230 ms after quit and the exit hook SIGKILLed whatever was left, so a tree had
 * about that long; keeping it there keeps an ordinary quit as fast as it was.
 */
export const QUIT_TREE_GRACE_MS = 150

export interface QuitDrainResult {
  /** Terminals whose exit reached JS during the drain. */
  exited: number
  /** Terminals still running at the deadline. */
  pending: number
  ms: number
}

export interface QuitDrainOptions<P> {
  graceMs?: number
  deadlineMs?: number
  /** Ends a terminal still running after the grace. */
  forceKill: (pty: P) => void
  warn?: (message: string) => void
  now?: () => number
}

/** The terminals whose exit has not reached JS yet. */
export class PtyExitDrain<P extends object> {
  private readonly open = new Map<P, { done: Promise<void>; settle: () => void }>()

  /** A process just started: its exit is now awaited by [drain]. */
  track(pty: P): void {
    let settle: () => void = () => undefined
    const done = new Promise<void>(resolve => { settle = resolve })
    this.open.set(pty, { done, settle })
  }

  /** Its exit reached JS (node-pty's onExit). */
  settle(pty: P): void {
    const entry = this.open.get(pty)
    if (!entry) return
    this.open.delete(pty)
    entry.settle()
  }

  get size(): number {
    return this.open.size
  }

  /** Waits for every open terminal's exit, SIGKILLs those left after the grace, and gives up at the deadline. */
  async drain(options: QuitDrainOptions<P>): Promise<QuitDrainResult> {
    const now = options.now ?? Date.now
    const started = now()
    const waiting = [...this.open.entries()]
    if (!waiting.length) return { exited: 0, pending: 0, ms: 0 }
    const graceMs = options.graceMs ?? QUIT_DRAIN_GRACE_MS
    const deadlineMs = Math.max(graceMs, options.deadlineMs ?? QUIT_DRAIN_DEADLINE_MS)
    const grace = setTimeout(() => {
      for (const [pty] of waiting) {
        if (!this.open.has(pty)) continue
        try { options.forceKill(pty) } catch { /* already gone */ }
      }
    }, graceMs)
    let deadline: ReturnType<typeof setTimeout> | undefined
    await Promise.race([
      Promise.all(waiting.map(([, entry]) => entry.done)),
      new Promise<void>(resolve => { deadline = setTimeout(resolve, deadlineMs) })
    ])
    clearTimeout(grace)
    if (deadline) clearTimeout(deadline)
    const pending = waiting.filter(([pty]) => this.open.has(pty)).length
    if (pending) (options.warn ?? console.warn)(`[terminal] quit: ${pending} terminal(s) still running after ${deadlineMs} ms`)
    return { exited: waiting.length - pending, pending, ms: now() - started }
  }
}
