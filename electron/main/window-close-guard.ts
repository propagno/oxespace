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
import { requireAppFrame } from './ipc/ipc-guards'

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
  const emit = app.emit
  app.emit = function (this: typeof app, name: string | symbol, ...args: unknown[]): boolean {
    if (name === 'before-quit' && created.intercept('quit')) {
      (args[0] as Electron.Event | undefined)?.preventDefault()
      return true
    }
    return emit.call(this, name, ...args)
  } as typeof app.emit
  try { powerMonitor.on('shutdown', () => { created.bypass() }) } catch { /* not available before ready, or on this OS */ }
  ipcMain.handle(IPC_CHANNELS.app.closeAnswer, (event: IpcMainInvokeEvent, input: unknown) => {
    requireAppFrame(event, 'Close answer')
    if (!target || target.isDestroyed() || event.sender !== target.webContents) throw new Error('Close answer requires the main window')
    created.answer(parseCloseAnswerInput(input))
  })
  return created
}
