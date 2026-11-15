import { beforeEach, describe, expect, it, vi } from 'vitest'

beforeEach(() => { localStorage.clear(); vi.resetModules() })

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
