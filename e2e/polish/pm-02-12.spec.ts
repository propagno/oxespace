// Frozen end-to-end acceptance test for 1.5.2 OxeCode/Shell F6 (Jira OXE-249, PM-02·12, CA-3), in the built app with real
// services (OXESPACE_E2E_MOCK_NATIVE=0). Written by the planner; the executor must not edit it. Red until the card's task
// (group C, after OxeCode F5).
// Contract: in OxeQuery (whose collapsed sidebar is the NavigationRail) with the sidebar collapsed from its own footer, the
// rail's footer has the theme button, and using it switches the app's theme (the root's data-mode).
import { expect, test } from '@playwright/test'
import { launchApp, layoutAtWidth } from '../helpers/launch'

test('PM-02·12 in the app: the collapsed rail switches the theme', async () => {
  test.setTimeout(180_000)
  const { app, page } = await launchApp({ appearance: 'light', env: { OXESPACE_E2E_MOCK_NATIVE: '0' } })
  try {
    await layoutAtWidth(app, page, 1440, 900)
    await page.keyboard.press('Control+3')
    await page.getByRole('button', { name: 'Collapse sidebar' }).first().click()
    const rail = page.locator('.nav-rail[data-collapsed]')
    await expect(rail).toBeVisible()
    const theme = rail.locator('footer').getByRole('button', { name: 'Switch to dark mode' })
    await expect(theme).toBeVisible()
    await theme.click()
    await expect.poll(() => page.evaluate(() => document.documentElement.dataset.mode)).toBe('dark')
  } finally {
    await app.close()
  }
})
