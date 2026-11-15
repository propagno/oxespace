// Frozen end-to-end acceptance test for 1.5.2 OxeCode/Shell F6 (Jira OXE-250, PM-02·13, CA-3), in the built app with real
// services (OXESPACE_E2E_MOCK_NATIVE=0). An unpackaged build has no update feed, so main announces a new version the way
// its updater does, on the app:update-state channel the preload listens to. Written by the planner; the executor must not
// edit it. Red until the card's task.
// Contract: in the compact density, with a new version available, the title bar's update trigger is 24px tall
// (--control-sm) and has no border.
import { expect, test } from '@playwright/test'
import { launchApp, layoutAtWidth } from '../helpers/launch'

test('PM-02·13 in the app: the update indicator is a 24px ghost button', async () => {
  test.setTimeout(180_000)
  const { app, page } = await launchApp({ appearance: 'light', density: 'compact', env: { OXESPACE_E2E_MOCK_NATIVE: '0' } })
  try {
    await layoutAtWidth(app, page, 1440, 900)
    await app.evaluate(({ BrowserWindow }) => {
      const state = { status: 'available', installMode: 'manual', currentVersion: '1.5.1', availableVersion: '9.9.9', progress: null, error: null, lastCheckedAt: Date.now() }
      for (const win of BrowserWindow.getAllWindows()) win.webContents.send('app:update-state', state)
    })
    const trigger = page.getByRole('button', { name: /9\.9\.9/ }).first()
    await expect(trigger).toBeVisible()
    const style = await trigger.evaluate(el => { const s = getComputedStyle(el); return { height: el.getBoundingClientRect().height, border: s.borderTopWidth } })
    expect(Math.round(style.height)).toBe(24)
    expect(style.border).toBe('0px')
  } finally {
    await app.close()
  }
})
