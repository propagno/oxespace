/**
 * F26 binding: hangs `services/close-guard.ts` on the main window's `close` and on the app's `before-quit`, and
 * answers `app:close-answer`. Small and static: it runs on every launch, before the first close can happen.
 *
 * `before-quit` is gated by wrapping `app.emit`, not by a listener. A listener cannot stop the other `before-quit`
 * listeners (the quit drain in index.ts, the service stops), and a quit the person then cancels must not have stopped
 * anything. While the window is asked, no `before-quit` listener runs; once the answer is `proceed`, `app.quit()` is
 * issued again and every listener, the drain included, runs as it always did. Electron looks `emit` up on the object
 * for its native events, so the wrapper sees them (checked against Electron 44).
 *
 * Never asked: an OS shutdown or session end (`query-session-end` / `session-end` on Windows, `powerMonitor`
 * `shutdown` on Linux and macOS), an update install (`bypassCloseGuard()` from the updater), and `app.exit()`, which
 * emits neither event. E2E launches with mocked natives use the double in `e2e/close-guard-mock.ts` instead, so
 * Playwright's `app.close()` is never held.
 */
import { app, ipcMain, powerMonitor, type BrowserWindow, type IpcMainInvokeEvent } from 'electron'
import { IPC_CHANNELS } from '../../shared/types/ipc'
import { CloseGuard, parseCloseAnswerInput } from './services/close-guard'
import { recordIncident } from './services/diagnostics/incident-sink'

let guard: CloseGuard | null = null
let target: BrowserWindow | null = null

/** Asks `window` before it closes and before the app quits. Called for each main window; the last one is asked. */
export function installCloseGuard(window: BrowserWindow): void {
  if (process.env.OXESPACE_E2E_MOCK_NATIVE === '1') return
  target = window
  if (guard) guard.rearm()
  else guard = createGuard()
  const current = guard
  window.on('close', event => { if (current.intercept('close')) event.preventDefault() })
  window.on('query-session-end', () => { current.bypass() })
  window.on('session-end', () => { current.bypass() })
  window.webContents.on('render-process-gone', () => current.rendererGone())
  window.on('closed', () => {
    if (target !== window) return
    target = null
    current.rendererGone()
  })
}

/** The updater's install-and-restart: never ask. Returns the undo for an install that failed to start. */
export function bypassCloseGuard(): () => void {
  return guard?.bypass() ?? (() => {})
}

interface Emitting { emit(name: string | symbol, ...args: unknown[]): boolean }

/**
 * Wraps `target.emit` so `before-quit` reaches no listener while `shouldGate()` says the window is being asked; it
 * then prevents the native event. Fails open: if `shouldGate` (or the prevention) throws, `onError` is told and the
 * event goes to every listener exactly as without the wrapper. If Electron ever stopped routing `before-quit`
 * through `emit`, nothing would be gated and quitting would work as it did before F26; the E2E canary
 * (e2e/close-guard-canary.spec.ts) fails first. Returns the unwrap.
 */
export function gateBeforeQuit(target: Emitting, shouldGate: () => boolean, onError: () => void): () => void {
  const emit = target.emit
  const gated = function (this: Emitting, name: string | symbol, ...args: unknown[]): boolean {
    if (name === 'before-quit') {
      try {
        if (shouldGate()) {
          (args[0] as { preventDefault?: () => void } | undefined)?.preventDefault?.()
          return true
        }
      } catch {
        try { onError() } catch { /* the quit goes on regardless */ }
      }
    }
    return emit.call(this, name, ...args)
  }
  target.emit = gated
  return () => { if (target.emit === gated) target.emit = emit }
}

function createGuard(): CloseGuard {
  const created = new CloseGuard({
    send: request => {
      if (!target || target.isDestroyed() || target.webContents.isDestroyed()) return false
      target.webContents.send(IPC_CHANNELS.app.closeRequested, request)
      return true
    },
    close: () => { if (target && !target.isDestroyed()) target.close() },
    quit: () => app.quit(),
    incident: code => recordIncident(code)
  })
  gateBeforeQuit(app, () => created.intercept('quit'), () => created.failOpen())
  try { powerMonitor.on('shutdown', () => { created.bypass() }) } catch { /* not available before ready, or on this OS */ }
  ipcMain.handle(IPC_CHANNELS.app.closeAnswer, (event: IpcMainInvokeEvent, input: unknown) => {
    if (!target || target.isDestroyed() || event.sender !== target.webContents) throw new Error('Close answer requires the main window')
    created.answer(parseCloseAnswerInput(input))
  })
  return created
}
