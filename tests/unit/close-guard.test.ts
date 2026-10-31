// @vitest-environment node
import { EventEmitter } from 'node:events'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CLOSE_ANSWER_TIMEOUT_MS, CloseGuard, parseCloseAnswerInput, type CloseGuardDeps } from '../../electron/main/services/close-guard'
import { installE2eCloseGuard, E2E_CLOSE_ANSWERS_GLOBAL, E2E_CLOSE_OUTCOMES_GLOBAL, E2E_REQUEST_CLOSE_GLOBAL } from '../../electron/main/e2e/close-guard-mock'
import { DIAGNOSTICS_INCIDENT_CODES } from '../../shared/types/diagnostics'
import type { CloseRequest } from '../../shared/types/app'

const electron = await vi.hoisted(async () => {
  const { EventEmitter: Emitter } = await import('node:events')
  const handlers = new Map<string, (event: unknown, ...args: unknown[]) => unknown>()
  const app = Object.assign(new Emitter(), { quit: () => {} })
  const powerMonitor = new Emitter()
  const windows = new Set<unknown>()
  return {
    handlers, app, powerMonitor, windows,
    ipcMain: { handle: (channel: string, handler: (event: unknown, ...args: unknown[]) => unknown) => { handlers.set(channel, handler) } },
    BrowserWindow: { fromWebContents: (contents: unknown) => [...windows].find(window => (window as { webContents: unknown }).webContents === contents) ?? null }
  }
})
vi.mock('electron', () => ({ app: electron.app, ipcMain: electron.ipcMain, powerMonitor: electron.powerMonitor, BrowserWindow: electron.BrowserWindow }))
const recordIncident = vi.hoisted(() => vi.fn())
vi.mock('../../electron/main/services/diagnostics/incident-sink', () => ({ recordIncident }))

function harness(overrides: Partial<CloseGuardDeps> = {}) {
  const sent: CloseRequest[] = []
  let id = 0
  const deps = {
    send: vi.fn((request: CloseRequest) => { sent.push(request); return true }),
    close: vi.fn(), quit: vi.fn(), incident: vi.fn(),
    newId: () => `req-${++id}`,
    ...overrides
  }
  return { guard: new CloseGuard(deps), deps, sent }
}

beforeEach(() => { vi.useFakeTimers() })
afterEach(() => { vi.useRealTimers() })

describe('close guard state machine (F26)', () => {
  it('asks once, and proceed closes; the close it issues again passes', () => {
    const { guard, deps, sent } = harness()
    expect(guard.intercept('close')).toBe(true)
    expect(sent).toEqual([{ requestId: 'req-1', reason: 'close' }])
    guard.answer({ requestId: 'req-1', answer: 'proceed' })
    expect(deps.close).toHaveBeenCalledTimes(1)
    expect(deps.quit).not.toHaveBeenCalled()
    expect(guard.intercept('close')).toBe(false)
    expect(guard.intercept('quit')).toBe(false) // window-all-closed → app.quit → the drain, unasked
    expect(deps.incident).not.toHaveBeenCalled()
  })

  it('cancel keeps the app open, and the next close asks again', () => {
    const { guard, deps, sent } = harness()
    guard.intercept('quit')
    guard.answer({ requestId: 'req-1', answer: 'cancel' })
    vi.advanceTimersByTime(10_000)
    expect(deps.close).not.toHaveBeenCalled()
    expect(deps.quit).not.toHaveBeenCalled()
    expect(deps.incident).not.toHaveBeenCalled()
    expect(guard.intercept('close')).toBe(true)
    expect(sent.map(request => request.requestId)).toEqual(['req-1', 'req-2'])
  })

  it('hold has no deadline: after 60 s it still waits, then proceed closes', () => {
    const { guard, deps } = harness()
    guard.intercept('close')
    guard.answer({ requestId: 'req-1', answer: 'hold' })
    vi.advanceTimersByTime(60_000)
    expect(guard.isHeld()).toBe(true)
    expect(deps.close).not.toHaveBeenCalled()
    expect(deps.incident).not.toHaveBeenCalled()
    guard.answer({ requestId: 'req-1', answer: 'proceed' })
    expect(deps.close).toHaveBeenCalledTimes(1)
  })

  it('hold then cancel stays open', () => {
    const { guard, deps } = harness()
    guard.intercept('quit')
    guard.answer({ requestId: 'req-1', answer: 'hold' })
    vi.advanceTimersByTime(60_000)
    guard.answer({ requestId: 'req-1', answer: 'cancel' })
    vi.advanceTimersByTime(60_000)
    expect(deps.quit).not.toHaveBeenCalled()
    expect(guard.current()).toBeNull()
  })

  it('no first answer within 3 s forces the close and journals closeUnanswered', () => {
    const { guard, deps } = harness()
    guard.intercept('close')
    vi.advanceTimersByTime(CLOSE_ANSWER_TIMEOUT_MS - 1)
    expect(deps.close).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(deps.incident).toHaveBeenCalledWith('incident.app.closeUnanswered')
    expect(deps.close).toHaveBeenCalledTimes(1)
    // A late answer to the forced request does nothing.
    guard.answer({ requestId: 'req-1', answer: 'cancel' })
    expect(guard.intercept('close')).toBe(false)
  })

  it('the renderer going away while held proceeds and journals closeRendererGone', () => {
    const { guard, deps } = harness()
    guard.intercept('quit')
    guard.answer({ requestId: 'req-1', answer: 'hold' })
    guard.rendererGone()
    expect(deps.incident).toHaveBeenCalledWith('incident.app.closeRendererGone')
    expect(deps.quit).toHaveBeenCalledTimes(1)
  })

  it('a renderer gone with nothing asked does nothing', () => {
    const { guard, deps } = harness()
    guard.rendererGone()
    expect(deps.incident).not.toHaveBeenCalled()
    expect(deps.close).not.toHaveBeenCalled()
  })

  it('a second close reuses the pending request instead of stacking', () => {
    const { guard, sent } = harness()
    guard.intercept('close')
    guard.answer({ requestId: 'req-1', answer: 'hold' })
    expect(guard.intercept('close')).toBe(true)
    expect(sent).toHaveLength(1)
    expect(guard.current()).toEqual({ requestId: 'req-1', reason: 'close' })
  })

  it('a quit while a close is pending upgrades it: no second event, proceed quits', () => {
    const { guard, deps, sent } = harness()
    guard.intercept('close')
    expect(guard.intercept('quit')).toBe(true)
    expect(sent).toHaveLength(1)
    expect(guard.current()?.reason).toBe('quit')
    expect(guard.intercept('close')).toBe(true) // never downgraded
    expect(guard.current()?.reason).toBe('quit')
    guard.answer({ requestId: 'req-1', answer: 'proceed' })
    expect(deps.quit).toHaveBeenCalledTimes(1)
    expect(deps.close).not.toHaveBeenCalled()
  })

  it('bypass (session end, update install) never asks, and lets a pending one go without an incident', () => {
    const { guard, deps, sent } = harness()
    guard.intercept('close')
    guard.bypass()
    expect(deps.close).toHaveBeenCalledTimes(1)
    expect(guard.intercept('quit')).toBe(false)
    expect(sent).toHaveLength(1)
    expect(deps.incident).not.toHaveBeenCalled()
  })

  it('a bypass undone (an install that failed to start) asks again', () => {
    const { guard } = harness()
    const undo = guard.bypass()
    expect(guard.intercept('quit')).toBe(false)
    undo()
    guard.rearm()
    expect(guard.intercept('quit')).toBe(true)
  })

  it('no window to ask lets the close through at once', () => {
    const { guard, deps } = harness({ send: vi.fn(() => false) })
    expect(guard.intercept('quit')).toBe(false)
    expect(deps.incident).not.toHaveBeenCalled()
  })

  it('an unknown or stale requestId is ignored', () => {
    const { guard, deps } = harness()
    guard.answer({ requestId: 'nobody', answer: 'proceed' })
    guard.intercept('close')
    guard.answer({ requestId: 'req-0', answer: 'proceed' })
    guard.answer({ requestId: 'req-0', answer: 'hold' })
    expect(deps.close).not.toHaveBeenCalled()
    expect(guard.isHeld()).toBe(false)
    vi.advanceTimersByTime(CLOSE_ANSWER_TIMEOUT_MS) // the real one is still bound by the deadline
    expect(deps.close).toHaveBeenCalledTimes(1)
  })
})

describe('close answer input', () => {
  it('accepts exactly { requestId, answer }', () => {
    expect(parseCloseAnswerInput({ requestId: 'a', answer: 'hold' })).toEqual({ requestId: 'a', answer: 'hold' })
    expect(parseCloseAnswerInput({ answer: 'cancel', requestId: 'x'.repeat(100) }).answer).toBe('cancel')
  })

  it.each([
    ['null', null], ['a string', 'proceed'], ['an array', ['r', 'proceed']], ['an empty object', {}],
    ['a missing answer', { requestId: 'r' }], ['an extra key', { requestId: 'r', answer: 'proceed', force: true }],
    ['a number id', { requestId: 1, answer: 'proceed' }], ['an empty id', { requestId: '', answer: 'proceed' }],
    ['a 101-character id', { requestId: 'x'.repeat(101), answer: 'proceed' }],
    ['an answer outside the three', { requestId: 'r', answer: 'quit' }], ['a cased answer', { requestId: 'r', answer: 'Proceed' }],
    ['a non-string answer', { requestId: 'r', answer: 1 }], ['a class instance', Object.assign(new (class Answer {})(), { requestId: 'r', answer: 'hold' })]
  ])('throws on %s', (_label, value) => {
    expect(() => parseCloseAnswerInput(value)).toThrow()
  })
})

describe('incident codes', () => {
  it('journals both close incidents in the app area', () => {
    expect(DIAGNOSTICS_INCIDENT_CODES['incident.app.closeUnanswered']).toBe('app')
    expect(DIAGNOSTICS_INCIDENT_CODES['incident.app.closeRendererGone']).toBe('app')
  })
})

type FakeWindow = EventEmitter & {
  webContents: EventEmitter & { send: ReturnType<typeof vi.fn>; isDestroyed(): boolean; mainFrame: object }
  close: ReturnType<typeof vi.fn>
  isDestroyed(): boolean
}

function fakeWindow(): FakeWindow {
  const webContents = Object.assign(new EventEmitter(), { send: vi.fn(), isDestroyed: () => false, mainFrame: {} })
  const window = Object.assign(new EventEmitter(), { webContents, close: vi.fn(), isDestroyed: () => false }) as FakeWindow
  electron.windows.add(window)
  return window
}

function preventable() {
  return { preventDefault: vi.fn() }
}

describe('window and app binding', () => {
  let binding: typeof import('../../electron/main/window-close-guard')
  const originalEmit = electron.app.emit

  beforeEach(async () => {
    vi.resetModules()
    electron.handlers.clear()
    electron.windows.clear()
    electron.app.removeAllListeners()
    electron.powerMonitor.removeAllListeners()
    electron.app.emit = originalEmit
    electron.app.quit = vi.fn()
    recordIncident.mockClear()
    delete process.env.OXESPACE_E2E_MOCK_NATIVE
    binding = await import('../../electron/main/window-close-guard')
  })

  const answer = (window: FakeWindow, input: unknown) => electron.handlers.get('app:close-answer')!({ sender: window.webContents, senderFrame: window.webContents.mainFrame }, input)
  const requestIdOf = (window: FakeWindow) => (window.webContents.send.mock.calls.at(-1)![1] as CloseRequest).requestId

  it('holds the window close, asks, and closes on proceed', () => {
    const window = fakeWindow()
    binding.installCloseGuard(window as never)
    const event = preventable()
    window.emit('close', event)
    expect(event.preventDefault).toHaveBeenCalled()
    expect(window.webContents.send).toHaveBeenCalledWith('app:close-requested', { requestId: expect.any(String), reason: 'close' })
    answer(window, { requestId: requestIdOf(window), answer: 'proceed' })
    expect(window.close).toHaveBeenCalledTimes(1)
    const again = preventable()
    window.emit('close', again)
    expect(again.preventDefault).not.toHaveBeenCalled()
  })

  it('gates before-quit for every listener (the drain included) until proceed, then quits again', () => {
    const window = fakeWindow()
    binding.installCloseGuard(window as never)
    const drain = vi.fn()
    electron.app.on('before-quit', drain)
    const event = preventable()
    expect(electron.app.emit('before-quit', event)).toBe(true)
    expect(event.preventDefault).toHaveBeenCalled()
    expect(drain).not.toHaveBeenCalled()
    answer(window, { requestId: requestIdOf(window), answer: 'proceed' })
    expect(electron.app.quit).toHaveBeenCalledTimes(1)
    electron.app.emit('before-quit', preventable())
    expect(drain).toHaveBeenCalledTimes(1)
  })

  it('cancel on a quit leaves every before-quit listener unrun', () => {
    const window = fakeWindow()
    binding.installCloseGuard(window as never)
    const drain = vi.fn()
    electron.app.on('before-quit', drain)
    electron.app.emit('before-quit', preventable())
    answer(window, { requestId: requestIdOf(window), answer: 'cancel' })
    expect(drain).not.toHaveBeenCalled()
    expect(electron.app.quit).not.toHaveBeenCalled()
  })

  it('a quit while a close is pending upgrades it and quits on proceed', () => {
    const window = fakeWindow()
    binding.installCloseGuard(window as never)
    window.emit('close', preventable())
    electron.app.emit('before-quit', preventable())
    expect(window.webContents.send).toHaveBeenCalledTimes(1)
    answer(window, { requestId: requestIdOf(window), answer: 'proceed' })
    expect(electron.app.quit).toHaveBeenCalledTimes(1)
    expect(window.close).not.toHaveBeenCalled()
  })

  it.each(['query-session-end', 'session-end'])('never asks after %s', name => {
    const window = fakeWindow()
    binding.installCloseGuard(window as never)
    window.emit(name, preventable())
    const event = preventable()
    window.emit('close', event)
    expect(event.preventDefault).not.toHaveBeenCalled()
    expect(window.webContents.send).not.toHaveBeenCalled()
  })

  it('never asks after a Linux or macOS shutdown (powerMonitor)', () => {
    const window = fakeWindow()
    binding.installCloseGuard(window as never)
    electron.powerMonitor.emit('shutdown', preventable())
    const event = preventable()
    electron.app.emit('before-quit', event)
    expect(event.preventDefault).not.toHaveBeenCalled()
  })

  it('never asks on the updater quit', () => {
    const window = fakeWindow()
    binding.installCloseGuard(window as never)
    binding.bypassCloseGuard()
    const drain = vi.fn()
    electron.app.on('before-quit', drain)
    electron.app.emit('before-quit', preventable())
    expect(drain).toHaveBeenCalledTimes(1)
    expect(window.webContents.send).not.toHaveBeenCalled()
  })

  it('a renderer gone while asked proceeds and journals it', () => {
    const window = fakeWindow()
    binding.installCloseGuard(window as never)
    window.emit('close', preventable())
    answer(window, { requestId: requestIdOf(window), answer: 'hold' })
    window.webContents.emit('render-process-gone', {}, { reason: 'crashed' })
    expect(recordIncident).toHaveBeenCalledWith('incident.app.closeRendererGone')
    expect(window.close).toHaveBeenCalledTimes(1)
  })

  it('a window destroyed while a quit is asked quits and journals it', () => {
    const window = fakeWindow()
    binding.installCloseGuard(window as never)
    electron.app.emit('before-quit', preventable())
    window.emit('closed')
    expect(recordIncident).toHaveBeenCalledWith('incident.app.closeRendererGone')
    expect(electron.app.quit).toHaveBeenCalledTimes(1)
  })

  it('no first answer in 3 s forces the close and journals it', () => {
    const window = fakeWindow()
    binding.installCloseGuard(window as never)
    window.emit('close', preventable())
    vi.advanceTimersByTime(CLOSE_ANSWER_TIMEOUT_MS)
    expect(recordIncident).toHaveBeenCalledWith('incident.app.closeUnanswered')
    expect(window.close).toHaveBeenCalledTimes(1)
  })

  it('refuses an answer from a sub-frame, another window or a non-app sender', () => {
    const window = fakeWindow()
    const other = fakeWindow()
    binding.installCloseGuard(window as never)
    window.emit('close', preventable())
    const input = { requestId: requestIdOf(window), answer: 'proceed' }
    const handler = electron.handlers.get('app:close-answer')!
    expect(() => handler({ sender: window.webContents, senderFrame: {} }, input)).toThrow(/main frame/)
    expect(() => handler({ sender: other.webContents, senderFrame: other.webContents.mainFrame }, input)).toThrow(/main window/)
    expect(() => handler({ sender: { id: 9 }, senderFrame: null }, input)).toThrow(/main frame/)
    expect(window.close).not.toHaveBeenCalled()
  })

  it('refuses malformed input through the handler', () => {
    const window = fakeWindow()
    binding.installCloseGuard(window as never)
    expect(() => answer(window, { requestId: 'r', answer: 'proceed', extra: 1 })).toThrow()
    expect(() => answer(window, { requestId: 'r', answer: 'later' })).toThrow()
  })

  it('is not installed with mocked natives, so app.close() in E2E is never held', () => {
    process.env.OXESPACE_E2E_MOCK_NATIVE = '1'
    try {
      const window = fakeWindow()
      binding.installCloseGuard(window as never)
      const event = preventable()
      window.emit('close', event)
      electron.app.emit('before-quit', event)
      expect(event.preventDefault).not.toHaveBeenCalled()
      expect(electron.handlers.has('app:close-answer')).toBe(false)
    } finally {
      delete process.env.OXESPACE_E2E_MOCK_NATIVE
    }
  })
})

describe('E2E close guard double', () => {
  it('requests through the hook, records answers in order and outcomes, and never closes', () => {
    const scope: Record<string, unknown> = {}
    const sent: CloseRequest[] = []
    let id = 0
    const double = installE2eCloseGuard(scope, false, request => { sent.push(request); return true }, { newId: () => `e2e-${++id}` })
    const request = scope[E2E_REQUEST_CLOSE_GLOBAL] as (reason: unknown) => string | null
    expect(request('close')).toBe('e2e-1')
    expect(request('quit')).toBe('e2e-1') // upgraded, not stacked
    expect(request('reboot')).toBeNull()
    double.answer({ requestId: 'e2e-1', answer: 'hold' })
    double.answer({ requestId: 'e2e-1', answer: 'proceed' })
    expect(scope[E2E_CLOSE_ANSWERS_GLOBAL]).toEqual([{ requestId: 'e2e-1', answer: 'hold' }, { requestId: 'e2e-1', answer: 'proceed' }])
    expect(scope[E2E_CLOSE_OUTCOMES_GLOBAL]).toEqual([{ requestId: 'e2e-1', reason: 'quit', outcome: 'proceed' }])
    expect(request('close')).toBe('e2e-2') // asks again
    expect(sent).toEqual([{ requestId: 'e2e-1', reason: 'close' }, { requestId: 'e2e-2', reason: 'close' }])
    expect(() => double.answer({ requestId: 'e2e-2' })).toThrow()
    expect(scope[E2E_CLOSE_ANSWERS_GLOBAL]).toHaveLength(2)
  })

  it('applies the 3 s deadline as in production', () => {
    const scope: Record<string, unknown> = {}
    installE2eCloseGuard(scope, false, () => true)
    ;(scope[E2E_REQUEST_CLOSE_GLOBAL] as (reason: unknown) => string | null)('close')
    vi.advanceTimersByTime(CLOSE_ANSWER_TIMEOUT_MS)
    expect((scope[E2E_CLOSE_OUTCOMES_GLOBAL] as Array<{ outcome: string }>)[0].outcome).toBe('forced')
  })

  it('defines no hooks in a packaged build', () => {
    const scope: Record<string, unknown> = {}
    installE2eCloseGuard(scope, true, () => true)
    expect(Object.keys(scope)).toEqual([])
  })
})
