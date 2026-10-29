import { ipcMain, type BrowserWindow } from 'electron'
import { performance } from 'node:perf_hooks'
import { IPC_CHANNELS } from '../../shared/types/ipc'
import { requireAppFrame } from './ipc/ipc-guards'
import { recordRuntime, type STARTUP_PHASES } from './services/runtime-diagnostics'

export type StartupPhase = typeof STARTUP_PHASES[number]

/**
 * Startup timeline of the main process. Each phase becomes a `performance.measure` named `oxe:<phase>`
 * (readable from tests through the process-wide performance timeline) and a `startup-phase` runtime
 * diagnostics event carrying only the phase name and its duration.
 *
 * Offsets measured from process start (performance.timeOrigin) say how long the user waited; the
 * others (ipc-handlers, window-create) say which step that time went to.
 */
function publish(phase: StartupPhase, start: number, end = performance.now()): void {
  try { performance.measure(`oxe:${phase}`, { start, end }) } catch { /* timeline full: the diagnostics event still lands */ }
  recordRuntime('startup-phase', { phase, durationMs: end - start })
}

/** Times `run`, sync or async, as one startup phase and returns its result untouched. */
export function measureStartup<T>(phase: StartupPhase, run: () => T): T {
  const start = performance.now()
  const result = run()
  if (result instanceof Promise) return result.finally(() => publish(phase, start)) as T
  publish(phase, start)
  return result
}

let interactiveReported = false
let windowTracked = false

/**
 * Process start to app.whenReady (Electron and module loading, before any OXESpace code runs), and the channel
 * the renderer reports its first painted screen on. Call it before any other IPC registration: the E2E mock
 * claims every remaining channel with a catch-all handler.
 */
export function markAppReady(): void {
  publish('app-ready', 0)
  ipcMain.handle(IPC_CHANNELS.diagnostics.reportInteractive, (event) => {
    requireAppFrame(event, 'Startup timing')
    // A renderer reload (recovery, dev refresh) would report again; only the cold start counts.
    if (interactiveReported) return
    interactiveReported = true
    publish('interactive', 0)
  })
}

/** Times the first window to its first frame, from process start. Later windows (macOS reactivation) are not startup. */
export function trackWindowStartup(window: BrowserWindow): BrowserWindow {
  if (windowTracked) return window
  windowTracked = true
  window.once('ready-to-show', () => publish('ready-to-show', 0))
  return window
}
