/**
 * What to do when the renderer process dies.
 *
 * A crash with a blank window and no way back leaves the user restarting the app
 * by hand, so the window is reloaded. A renderer that dies again straight away
 * would loop forever, so reloads are limited to a few per minute; past that the
 * user is told instead of the app flickering.
 */
export const RENDERER_RELOAD_LIMIT = 3
export const RENDERER_RELOAD_WINDOW_MS = 60_000

/** `clean-exit` is the renderer closing on purpose; `killed` is something external (a task manager, shutdown). */
const NOT_A_CRASH = new Set(['clean-exit', 'killed'])

export type RendererRecovery = 'ignore' | 'reload' | 'give-up'

export class RendererRecoveryPolicy {
  private readonly reloads: number[] = []

  decide(reason: string, now: number = Date.now()): RendererRecovery {
    if (NOT_A_CRASH.has(reason)) return 'ignore'
    while (this.reloads.length && now - this.reloads[0] >= RENDERER_RELOAD_WINDOW_MS) this.reloads.shift()
    if (this.reloads.length >= RENDERER_RELOAD_LIMIT) return 'give-up'
    this.reloads.push(now)
    return 'reload'
  }
}
