import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ThreadSnapshot } from '../shared/types/thread'

beforeEach(() => { localStorage.clear(); vi.resetModules() })

const snapshot = (createdAt: number, answered = true): ThreadSnapshot => ({
  thread: { id: 't', workspaceId: 'ws', projectId: 'p', rootPath: '/repo', provider: 'codex', title: 'T', pinned: false, status: 'idle', nativeSessionId: null, createdAt, updatedAt: createdAt },
  events: answered ? [{ type: 'message', id: 'u', role: 'user', text: 'Hi' }, { type: 'message', id: 'a', role: 'assistant', text: 'Hello' }] : [{ type: 'message', id: 'u', role: 'user', text: 'Hi' }]
})

function stubDiagnostics() {
  const recordFirstAnswer = vi.fn(async () => undefined)
  Object.defineProperty(window, 'oxe', { configurable: true, value: { diagnostics: { recordFirstAnswer } } })
  return recordFirstAnswer
}

describe('first-run preferences', () => {
  it('persists completed steps and dismissal, and ignores corrupt values', async () => {
    const { useNavigationPrefs } = await import('../src/store/navigation-prefs.store')
    useNavigationPrefs.getState().completeFirstRunStep('github')
    useNavigationPrefs.getState().completeFirstRunStep('agents')
    useNavigationPrefs.getState().dismissFirstRun()
    vi.resetModules()
    const reloaded = (await import('../src/store/navigation-prefs.store')).useNavigationPrefs.getState().firstRun
    expect(reloaded).toEqual({ done: ['agents', 'github'], dismissed: true, startedAt: null, firstAnswerMs: null })

    const { firstRunState } = await import('../src/store/navigation-prefs.store')
    expect(firstRunState({ done: ['agents', 'nope', 7], dismissed: 'yes', startedAt: -5, firstAnswerMs: 'fast' }))
      .toEqual({ done: ['agents'], dismissed: false, startedAt: null, firstAnswerMs: null })
  })

  it('starts the clock once and keeps the first answer only', async () => {
    const { useNavigationPrefs } = await import('../src/store/navigation-prefs.store')
    useNavigationPrefs.getState().startFirstRunClock(1000)
    useNavigationPrefs.getState().startFirstRunClock(9000)
    useNavigationPrefs.getState().recordFirstAnswer(4200.4)
    useNavigationPrefs.getState().recordFirstAnswer(99)
    expect(useNavigationPrefs.getState().firstRun).toMatchObject({ startedAt: 1000, firstAnswerMs: 4200 })
  })
})

describe('time to first answer', () => {
  it('records the first Thread answer locally and stops watching', async () => {
    const record = stubDiagnostics()
    vi.spyOn(Date, 'now').mockReturnValue(10_000)
    const { useNavigationPrefs } = await import('../src/store/navigation-prefs.store')
    const { useThreadStore } = await import('../src/store/thread.store')
    const { watchFirstAnswer } = await import('../src/components/Onboarding/firstAnswer')
    useNavigationPrefs.getState().startFirstRunClock(4_000)
    watchFirstAnswer()
    // A conversation from before the guide appeared does not count, nor does one with no answer yet.
    useThreadStore.setState({ snapshot: snapshot(1_000) })
    useThreadStore.setState({ snapshot: snapshot(5_000, false) })
    expect(useNavigationPrefs.getState().firstRun.firstAnswerMs).toBeNull()
    useThreadStore.setState({ snapshot: snapshot(5_000) })
    expect(useNavigationPrefs.getState().firstRun).toMatchObject({ firstAnswerMs: 6_000, done: ['folder'] })
    expect(record).toHaveBeenCalledWith({ durationMs: 6_000, kind: 'thread' })
    useThreadStore.setState({ snapshot: snapshot(6_000) })
    expect(record).toHaveBeenCalledTimes(1)
    vi.restoreAllMocks()
  })

  it('counts a finished agent turn in a Code pane, and does nothing before the clock starts', async () => {
    const record = stubDiagnostics()
    const { useNavigationPrefs } = await import('../src/store/navigation-prefs.store')
    const { useTerminalStore } = await import('../src/store/terminal.store')
    const { watchFirstAnswer } = await import('../src/components/Onboarding/firstAnswer')
    watchFirstAnswer()
    useTerminalStore.setState({ panes: { pane: { agentState: 'done' } as never } })
    expect(record).not.toHaveBeenCalled()
    useNavigationPrefs.getState().startFirstRunClock(Date.now() - 2_000)
    watchFirstAnswer()
    useTerminalStore.setState({ panes: { pane: { agentState: 'working' } as never } })
    expect(record).not.toHaveBeenCalled()
    useTerminalStore.setState({ panes: { pane: { agentState: 'done' } as never } })
    expect(record).toHaveBeenCalledWith({ durationMs: expect.any(Number), kind: 'code' })
    expect(useNavigationPrefs.getState().firstRun.firstAnswerMs).toBeGreaterThanOrEqual(2_000)
  })
})
