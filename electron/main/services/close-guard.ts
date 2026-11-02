/**
 * F26, nothing lost on close: before the main window closes or the app quits, main asks the window
 * (`app:close-requested`) and waits for its answer (`app:close-answer`).
 *
 * - `proceed` lets the close or quit go through: it is issued again and the guard lets it pass, so the existing
 *   quit drain runs as before.
 * - `cancel` keeps the app open.
 * - `hold` means an unsaved-work dialog is open: no deadline from then on, the next `proceed` or `cancel` decides.
 * - No first answer within `CLOSE_ANSWER_TIMEOUT_MS` (a hung, crashed or still loading window) goes ahead and
 *   journals `incident.app.closeUnanswered`. The renderer going away while asked goes ahead and journals
 *   `incident.app.closeRendererGone`. Both are forced: the window is destroyed, not asked to close, because a
 *   `BrowserWindow.close()` waits on the page's `beforeunload`/`unload`, which a busy renderer never runs.
 * - A second close or quit while one is asked reuses it. A quit arriving while a close is asked upgrades it to a quit
 *   (no second request): `proceed` then quits.
 * - `bypass()` (OS shutdown, session end, an update install) stops asking for good, and lets a pending one go.
 *
 * Pure on purpose: no Electron here, so the state machine is unit-tested with fake timers. The window and app
 * binding is in `../window-close-guard.ts`.
 */
import { randomUUID } from 'node:crypto'
import { CLOSE_ANSWERS, CLOSE_REASONS, type CloseAnswerInput, type CloseReason, type CloseRequest } from '../../../shared/types/app'
import type { DiagnosticsIncidentCode } from '../../../shared/types/diagnostics'

export const CLOSE_ANSWER_TIMEOUT_MS = 3000
export const CLOSE_REQUEST_ID_MAX = 100

export type CloseOutcome = 'proceed' | 'cancel' | 'forced' | 'renderer-gone' | 'bypassed' | 'no-window'

export interface CloseGuardDeps {
  /** Sends the request to the window; false when there is no live window to ask (destroyed or crashed). */
  send(request: CloseRequest): boolean
  /**
   * Issues the window close again; the guard lets it pass. `forced` (no first answer in time, or the renderer gone)
   * means the window cannot be trusted to take part: the binding destroys it instead of asking its page to unload.
   */
  close(forced: boolean): void
  /** Issues the app quit again; the guard lets it pass. `forced` as for `close`: the window must not hold the quit. */
  quit(forced: boolean): void
  incident(code: DiagnosticsIncidentCode): void
  /** Told of every decision, for the E2E record. */
  settled?(requestId: string, reason: CloseReason, outcome: CloseOutcome): void
  newId?(): string
  timeoutMs?: number
}

interface Pending {
  requestId: string
  reason: CloseReason
  held: boolean
  timer: ReturnType<typeof setTimeout> | null
}

/** `app:close-answer` input: exactly `{ requestId, answer }`, an id of 1 to 100 characters, one of the three answers. */
export function parseCloseAnswerInput(value: unknown): CloseAnswerInput {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Close answer must be an object')
  const prototype = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null) throw new Error('Close answer must be a plain object')
  const keys = Object.keys(value)
  if (keys.length !== 2 || !keys.includes('requestId') || !keys.includes('answer')) throw new Error('Close answer takes requestId and answer only')
  const { requestId, answer } = value as Record<string, unknown>
  if (typeof requestId !== 'string' || requestId.length === 0 || requestId.length > CLOSE_REQUEST_ID_MAX) throw new Error('Close answer requestId must be 1 to 100 characters')
  if (typeof answer !== 'string' || !(CLOSE_ANSWERS as readonly string[]).includes(answer)) throw new Error(`Close answer must be one of ${CLOSE_ANSWERS.join(', ')}`)
  return { requestId, answer: answer as CloseAnswerInput['answer'] }
}

export function isCloseReason(value: unknown): value is CloseReason {
  return typeof value === 'string' && (CLOSE_REASONS as readonly string[]).includes(value)
}

export class CloseGuard {
  private pending: Pending | null = null
  /** A close or quit was let go: the events it issues again pass. Cleared by `rearm()`. */
  private passing = false
  /** OS shutdown, session end or an update install: never ask again. */
  private bypassed = false
  private failureJournalled = false

  constructor(private readonly deps: CloseGuardDeps) {}

  /**
   * A close or quit is starting. True means the caller must prevent it: the window is being asked (or already was).
   * False lets it through.
   *
   * Fails open: the guard must never make the app unquittable. Every path that returns true has either the 3 s
   * timer armed or a `hold` given by a valid answer from the live main frame (whose loss `rendererGone()` covers).
   * An inconsistent state or a throw lets the close or quit through and journals `incident.app.closeGuardFailed`.
   */
  intercept(reason: CloseReason): boolean {
    try {
      if (this.passing || this.bypassed) return false
      const current = this.pending
      if (current) {
        if (typeof current.requestId !== 'string' || !current.requestId || (!current.held && !current.timer)) return this.failOpen()
        if (reason === 'quit') current.reason = 'quit'
        return true
      }
      const requestId = (this.deps.newId ?? randomUUID)()
      if (typeof requestId !== 'string' || !requestId) return this.failOpen()
      const pending: Pending = { requestId, reason, held: false, timer: null }
      // Armed before the request leaves, so no path prevents without a deadline.
      pending.timer = setTimeout(() => {
        if (this.pending !== pending || pending.held) return
        this.deps.incident('incident.app.closeUnanswered')
        this.go('forced')
      }, this.deps.timeoutMs ?? CLOSE_ANSWER_TIMEOUT_MS)
      pending.timer.unref?.()
      this.pending = pending
      let sent = false
      try { sent = this.deps.send({ requestId, reason }) } catch { sent = false }
      if (!sent) {
        // No window to ask (none open, or it is already destroyed): nothing on screen can be lost, go ahead.
        this.clearTimer(pending)
        this.pending = null
        this.passing = true
        this.deps.settled?.(requestId, reason, 'no-window')
        return false
      }
      return true
    } catch {
      return this.failOpen()
    }
  }

  /** Lets this close or quit, and the ones it issues, through; journalled once per guard. */
  failOpen(): false {
    try {
      if (this.pending) this.clearTimer(this.pending)
      this.pending = null
      this.passing = true
      if (!this.failureJournalled) {
        this.failureJournalled = true
        this.deps.incident('incident.app.closeGuardFailed')
      }
    } catch { /* still open */ }
    return false
  }

  /** The window's answer, already parsed. An unknown or stale id does nothing. */
  answer(input: CloseAnswerInput): void {
    const pending = this.pending
    if (!pending || pending.requestId !== input.requestId) return
    if (input.answer === 'hold') {
      pending.held = true
      this.clearTimer(pending)
      return
    }
    if (input.answer === 'cancel') {
      this.clearTimer(pending)
      this.pending = null
      this.deps.settled?.(pending.requestId, pending.reason, 'cancel')
      return
    }
    this.go('proceed')
  }

  /** The renderer process went away or the window was destroyed while asked: go ahead. */
  rendererGone(): void {
    if (!this.pending) return
    this.deps.incident('incident.app.closeRendererGone')
    this.go('renderer-gone')
  }

  /** OS shutdown, session end, an update install: stop asking, and let a pending close or quit go. */
  bypass(): () => void {
    this.bypassed = true
    if (this.pending) this.go('bypassed')
    return () => { this.bypassed = false }
  }

  /** Asking again from now: a new main window, or the E2E double after it recorded an outcome. */
  rearm(): void {
    this.passing = false
  }

  /** The request being asked, for the E2E hook. */
  current(): CloseRequest | null {
    return this.pending ? { requestId: this.pending.requestId, reason: this.pending.reason } : null
  }

  isHeld(): boolean {
    return this.pending?.held === true
  }

  private go(outcome: CloseOutcome): void {
    const pending = this.pending
    if (!pending) return
    this.clearTimer(pending)
    this.pending = null
    this.passing = true
    this.deps.settled?.(pending.requestId, pending.reason, outcome)
    const forced = outcome === 'forced' || outcome === 'renderer-gone'
    if (pending.reason === 'quit') this.deps.quit(forced)
    else this.deps.close(forced)
  }

  private clearTimer(pending: Pending): void {
    if (pending.timer) clearTimeout(pending.timer)
    pending.timer = null
  }
}
