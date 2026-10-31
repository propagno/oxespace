/**
 * F26 in E2E runs. The real guard (window-close-guard.ts) is not installed with mocked natives, so Playwright's
 * `app.close()` quits at once and is never held by a window that does not answer. Specs ask instead through a
 * double that runs the same state machine (services/close-guard.ts) with recording executors:
 *
 *   const id = await app.evaluate(() => globalThis.__oxeRequestClose?.('close'))   // sends app:close-requested
 *   await app.evaluate(() => globalThis.__oxeCloseAnswers)    // [{ requestId, answer }], every valid answer in order
 *   await app.evaluate(() => globalThis.__oxeCloseOutcomes)   // [{ requestId, reason, outcome }] once decided
 *
 * `__oxeRequestClose` returns the request id, the pending one when a request is already open (a `quit` upgrades a
 * pending `close`), or null for a reason other than `close` or `quit`. Nothing closes: an outcome is recorded and the
 * double asks again on the next request. The 3 s first-answer deadline applies as in production. The hooks are never
 * defined in a packaged build.
 *
 * `__oxeCloseGateCanary()` checks, on the real Electron app, that `before-quit` still goes through `app.emit`: it
 * arms the production gate (`gateBeforeQuit`) to hold one quit, calls `app.quit()`, waits, unwraps, and returns
 * `{ asked, listenerRan }`. Gated, it is `{ asked: 1, listenerRan: false }` and the app is still running. If Electron
 * ever stopped routing `before-quit` through `emit`, the app would quit instead and the canary spec fails.
 */
import { app, ipcMain, type IpcMainInvokeEvent } from 'electron'
import { IPC_CHANNELS } from '../../../shared/types/ipc'
import type { CloseAnswerInput, CloseReason, CloseRequest } from '../../../shared/types/app'
import { CloseGuard, isCloseReason, parseCloseAnswerInput, type CloseGuardDeps, type CloseOutcome } from '../services/close-guard'
import { requireAppFrame } from '../ipc/ipc-guards'
import { gateBeforeQuit } from '../window-close-guard'

export const E2E_REQUEST_CLOSE_GLOBAL = '__oxeRequestClose'
export const E2E_CLOSE_ANSWERS_GLOBAL = '__oxeCloseAnswers'
export const E2E_CLOSE_OUTCOMES_GLOBAL = '__oxeCloseOutcomes'
export const E2E_CLOSE_GATE_CANARY_GLOBAL = '__oxeCloseGateCanary'

export interface E2eCloseGateCanaryResult { asked: number; listenerRan: boolean }

interface CanaryApp {
  emit(name: string | symbol, ...args: unknown[]): boolean
  on(name: 'before-quit', listener: () => void): unknown
  removeListener(name: 'before-quit', listener: () => void): unknown
  quit(): void
}

/** Holds one `app.quit()` through the production gate and reports whether it was held. */
export async function runCloseGateCanary(target: CanaryApp, settleMs = 500): Promise<E2eCloseGateCanaryResult> {
  let asked = 0
  let listenerRan = false
  const listener = (): void => { listenerRan = true }
  target.on('before-quit', listener)
  let held = true
  const unwrap = gateBeforeQuit(target, () => { asked++; return held }, () => {})
  try {
    target.quit()
    await new Promise(resolve => setTimeout(resolve, settleMs))
  } finally {
    held = false
    unwrap()
    target.removeListener('before-quit', listener)
  }
  return { asked, listenerRan }
}

export interface E2eCloseOutcome { requestId: string; reason: CloseReason; outcome: CloseOutcome }

export interface E2eCloseGuardDouble {
  /** The `app:close-answer` handler body, after the frame check. */
  answer(input: unknown): void
}

/** The double without Electron: `send` broadcasts the request to the windows. Unit-tested. */
export function installE2eCloseGuard(scope: Record<string, unknown>, packaged: boolean, send: CloseGuardDeps['send'], deps: Partial<CloseGuardDeps> = {}): E2eCloseGuardDouble {
  const answers: CloseAnswerInput[] = []
  const outcomes: E2eCloseOutcome[] = []
  const guard: CloseGuard = new CloseGuard({
    send,
    // Recorded, never acted on: a spec must keep its app. The next request is asked again.
    close: () => guard.rearm(),
    quit: () => guard.rearm(),
    incident: () => {},
    settled: (requestId, reason, outcome) => { outcomes.push({ requestId, reason, outcome }) },
    ...deps
  })
  if (!packaged) {
    scope[E2E_CLOSE_ANSWERS_GLOBAL] = answers
    scope[E2E_CLOSE_OUTCOMES_GLOBAL] = outcomes
    scope[E2E_REQUEST_CLOSE_GLOBAL] = (reason: unknown): string | null => {
      if (!isCloseReason(reason)) return null
      guard.intercept(reason)
      return guard.current()?.requestId ?? null
    }
  }
  return {
    answer(input) {
      const parsed = parseCloseAnswerInput(input)
      answers.push({ requestId: parsed.requestId, answer: parsed.answer })
      guard.answer(parsed)
    }
  }
}

export function registerCloseGuardMock(packaged: boolean, broadcast: (channel: string, request: CloseRequest) => boolean): void {
  const scope = globalThis as unknown as Record<string, unknown>
  const double = installE2eCloseGuard(scope, packaged, request => broadcast(IPC_CHANNELS.app.closeRequested, request))
  if (!packaged) scope[E2E_CLOSE_GATE_CANARY_GLOBAL] = () => runCloseGateCanary(app as unknown as CanaryApp)
  ipcMain.handle(IPC_CHANNELS.app.closeAnswer, (event: IpcMainInvokeEvent, input: unknown) => {
    requireAppFrame(event, 'Close answer')
    double.answer(input)
  })
}
