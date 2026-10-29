import { test } from '@playwright/test'
import { launchApp, setAppearance } from './helpers/launch'

test('notifications shots', async () => {
  test.setTimeout(120_000)
  const { app, page } = await launchApp()
  try {
    for (const mode of ['light', 'dark'] as const) {
      await setAppearance(page, mode)
      await page.getByTestId('btn-new-workspace').first().waitFor()
      await page.waitForTimeout(800)
      await page.keyboard.press('Control+k')
      await page.locator('[cmdk-item][data-value="cmd-settings.notifications"]').click()
      await page.waitForTimeout(800)
      await page.screenshot({ path: `test-results/offer-shots/${mode}-settings-notifications.png` })
      await page.keyboard.press('Escape')
    }
  } finally {
    await Promise.race([app.close().catch(() => undefined), new Promise(resolve => setTimeout(resolve, 4000))])
  }
})
