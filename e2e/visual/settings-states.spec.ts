import { test, expect } from '@playwright/test'
import { launchApp, resizeWindow, type Appearance } from '../helpers/launch'
import { expectSurface } from '../helpers/visual'

const THEMES: Appearance[] = ['light', 'dark']
/**
 * The Settings pages whose content is the app's own. Agents, Voice and Updates show what
 * this machine has installed (CLIs, the speech engine, an update state), so a baseline of
 * them would compare runners, not the app.
 */
const PAGES = [['general', 'General'], ['appearance', 'Appearance'], ['terminal', 'Terminal'], ['notifications', 'Notifications']] as const

for (const theme of THEMES) {
  test(`settings pages — ${theme}`, async () => {
    test.setTimeout(120_000)
    const { app, page, consoleErrors } = await launchApp({ appearance: theme })
    try {
      await resizeWindow(app, 1280, 800)
      await page.getByRole('button', { name: 'Open settings', exact: true }).click()
      const settings = page.getByRole('dialog', { name: 'Settings', exact: true })
      await expect(settings).toBeVisible()
      await settings.getByRole('group', { name: 'Settings scope' }).getByRole('button', { name: 'Application', exact: true }).click()
      for (const [id, label] of PAGES) {
        await settings.getByRole('navigation', { name: 'Settings categories' }).getByRole('button', { name: new RegExp(`^${label}`) }).click()
        await expect(settings.locator('.settings-center-content')).toBeVisible()
        await expectSurface(page, `settings-${id}-${theme}`, { target: settings })
      }
      expect(consoleErrors).toEqual([])
    } finally {
      await app.close()
    }
  })
}
