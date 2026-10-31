import { expect, test } from '@playwright/test'
import { launchApp, resizeWindow } from '../helpers/launch'
import { expectSurface } from '../helpers/visual'

/**
 * Brand touchpoints that only show for a moment or by accident (docs/design/brand.md): the boot splash, drawn from
 * index.html and the stylesheet before the app's scripts run, in the mode saved in Settings (public/boot-appearance.js).
 * The window is reloaded with the app's bundle blocked, so the splash stays on screen to be compared.
 */
for (const scheme of ['light', 'dark'] as const) {
  test(`boot splash — ${scheme}`, async () => {
    const { app, page } = await launchApp({ appearance: scheme })
    try {
      await resizeWindow(app, 960, 640)
      await page.emulateMedia({ colorScheme: scheme })
      // The app's bundle stays out; the boot script (the saved appearance) runs, as on a cold start.
      await page.route(/[\\/]assets[\\/].*\.js(\?.*)?$/, route => route.abort())
      await page.reload()
      const splash = page.locator('.oxe-splash')
      await expect(splash).toBeVisible()
      await expect(splash).toHaveAttribute('role', 'status')
      // Only the boot script ran: the mode is the one saved in Settings.
      expect(await page.evaluate(() => document.documentElement.dataset.mode)).toBe(scheme)
      await expectSurface(page, `splash-${scheme}`)
    } finally {
      await app.close()
    }
  })
}
