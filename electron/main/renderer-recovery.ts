import type { App, BrowserWindow, MessageBoxOptions } from 'electron'

/**
 * What to do when the renderer process dies.
 *
 * A crash with a blank window and no way back leaves the user restarting the app
 * by hand, so the window is reloaded. A renderer that dies again straight away
 * would loop forever, so reloads are limited to a few per minute; past that the
 * user is told instead of the app flickering, and chooses the way back.
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

/** Electron and the translations come from the caller, so this module loads without Electron (unit tests). */
export interface RendererGiveUpDeps {
  app: Pick<App, 'relaunch' | 'quit'>
  /** Opens the native dialog on the window. The call itself stays in index.ts, one of the two places main may open one. */
  show: (options: MessageBoxOptions) => Promise<{ response: number }>
  t: (key: `crash.rendererGone.${'title' | 'message' | 'detail' | 'restart' | 'reload' | 'close'}`) => string
}

/** Button order of the give-up dialog; Close is the cancel answer (Esc, closing the dialog). */
const RESTART = 0
const RELOAD = 1
const CLOSE = 2

/**
 * The dialog shown once reloading was given up: Restart OXESpace (relaunch, then quit), Try reloading (one more
 * reload of the window, asked for by the person) or Close, which leaves the app as it is. Never rejects.
 */
export async function showRendererGiveUp(window: BrowserWindow, deps: RendererGiveUpDeps): Promise<void> {
  try {
    const plain: MessageBoxOptions = {
      type: 'error',
      title: deps.t('crash.rendererGone.title'),
      message: deps.t('crash.rendererGone.message'),
      detail: deps.t('crash.rendererGone.detail'),
      buttons: [deps.t('crash.rendererGone.restart'), deps.t('crash.rendererGone.reload'), deps.t('crash.rendererGone.close')],
      defaultId: RESTART,
      cancelId: CLOSE
    }
    // The icon module loads on demand; without it the dialog shows plain rather than not at all.
    const options = await import('./dialog-icon').then(({ withDialogIcon }) => { try { return withDialogIcon(plain) } catch { return plain } }, () => plain)
    if (window.isDestroyed()) return
    const { response } = await deps.show(options)
    if (response === RESTART) {
      deps.app.relaunch()
      deps.app.quit()
    } else if (response === RELOAD && !window.isDestroyed()) {
      window.webContents.reload()
    }
  } catch { /* a dialog that cannot be shown must not take the main process down */ }
}
