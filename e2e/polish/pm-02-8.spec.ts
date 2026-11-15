// Frozen end-to-end acceptance test for 1.5.2 OxeCode/Shell F6 (Jira OXE-246, PM-02·8, CA-4), in the built app on a fresh
// profile with real services (OXESPACE_E2E_MOCK_NATIVE=0). Written by the planner; the executor must not edit it. Red until
// the card's task.
// Contract: with no workspace, in OxeChat, View › Density › Comfortable (the inline menu bar from 1121px) changes the app's
// density: the root's data-density becomes "comfortable".
import { expect, test } from '@playwright/test'
import { launchApp, layoutAtWidth } from '../helpers/launch'

test('PM-02·8 in the app: View › Density works with no workspace', async () => {
  test.setTimeout(180_000)
  const { app, page } = await launchApp({ appearance: 'light', density: 'compact', env: { OXESPACE_E2E_MOCK_NATIVE: '0' } })
  try {
    await layoutAtWidth(app, page, 1440, 900)
    await page.keyboard.press('Control+2')
    await expect.poll(() => page.evaluate(() => document.documentElement.dataset.density ?? 'compact')).toBe('compact')
    await page.getByRole('navigation', { name: 'Menu' }).getByRole('button', { name: 'View', exact: true }).click()
    const density = page.getByRole('menuitem', { name: /^Density/ })
    await expect(density).toBeEnabled()
    await density.hover()
    await density.press('ArrowRight').catch(() => undefined)
    await page.getByRole('menuitem', { name: /comfortable/i }).click()
    await expect.poll(() => page.evaluate(() => document.documentElement.dataset.density)).toBe('comfortable')
  } finally {
    await app.close()
  }
})
