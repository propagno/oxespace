// #858 (OXE-77): the local "time to first answer" clock starts when the first run appears (it used to start with the
// first-run checklist, removed with BRD-12), and a dismissed first run never starts it.
import { cleanup, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

beforeEach(() => { localStorage.clear(); vi.resetModules() })
afterEach(cleanup)

async function mountFirstRun(): Promise<typeof import('../src/store/navigation-prefs.store')['useNavigationPrefs']> {
  const { useNavigationPrefs } = await import('../src/store/navigation-prefs.store')
  const { FirstRun } = await import('../src/components/Onboarding/FirstRun')
  render(<FirstRun folder={null} agents={[]} onOpenFolder={vi.fn()} onSignIn={vi.fn()} onCancelSignIn={vi.fn()} onNewConversation={vi.fn()} onOpenMode={vi.fn()} />)
  return useNavigationPrefs
}

describe('time to first answer starts with the first run', () => {
  it('starts the clock when the first run appears, once', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(5_000)
    const prefs = await mountFirstRun()
    expect(prefs.getState().firstRun.startedAt).toBe(5_000)
    expect(prefs.getState().firstRun.firstAnswerMs).toBeNull()
    vi.restoreAllMocks()
  })

  it('does not start the clock for a dismissed first run', async () => {
    const { useNavigationPrefs } = await import('../src/store/navigation-prefs.store')
    useNavigationPrefs.getState().dismissFirstRun()
    await mountFirstRun()
    expect(useNavigationPrefs.getState().firstRun.startedAt).toBeNull()
  })
})
