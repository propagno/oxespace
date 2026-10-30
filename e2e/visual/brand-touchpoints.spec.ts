import { expect, test } from '@playwright/test'
import { launchApp, resizeWindow } from '../helpers/launch'
import { expectSurface } from '../helpers/visual'

/**
 * Brand touchpoints that only show for a moment or by accident (docs/design/brand.md): the boot splash, drawn from
 * index.html and the stylesheet before any script runs, in the operating system's mode as System would choose.
 * The window is reloaded with its scripts blocked, so the splash stays on screen to be compared.
 */
for (const scheme of ['light', 'dark'] as const) {
  test(`boot splash — ${scheme}`, async () => {
    const { app, page } = await launchApp({ appearance: scheme })
    try {
      await resizeWindow(app, 960, 640)
      await page.emulateMedia({ colorScheme: scheme })
      await page.route(/\.js(\?.*)?$/, route => route.abort())
      await page.reload()
      const splash = page.locator('.oxe-splash')
      await expect(splash).toBeVisible()
      await expect(splash).toHaveAttribute('role', 'status')
      // No script ran: the mode comes from the stylesheet's fallback, not from data-mode.
      expect(await page.evaluate(() => document.documentElement.dataset.mode ?? null)).toBeNull()
      await expectSurface(page, `splash-${scheme}`)
    } finally {
      await app.close()
    }
  })
}
