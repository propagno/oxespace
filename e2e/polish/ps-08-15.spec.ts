// End-to-end acceptance test for 1.5.2 Polimento · Configurações (Jira OXE-242, PS-08·15, CA-3),
// in the built app with real services (OXESPACE_E2E_MOCK_NATIVE=0).
import { expect, test } from '@playwright/test'
import { launchApp, openDemoWorkspace } from '../helpers/launch'
import { openSettings } from '../helpers/settings'

const REAL = { OXESPACE_E2E_MOCK_NATIVE: '0' }

test('PS-08·15 in the app: the workspace terminal Switch is saved and back the same on reopen', async () => {
  const { electronApp, page } = await launchApp({ env: REAL })
  try {
    await openDemoWorkspace(page)
    await openSettings(page)

    const scopeSeg = page.locator('[data-ui="settings-scope"]')
    await scopeSeg.getByRole('radio').nth(1).click()

    const terminalSection = page.locator('section[aria-labelledby="ws-section-terminal"]')
    await expect(terminalSection).toBeVisible({ timeout: 10_000 })
    await expect(terminalSection.locator('input[type="checkbox"]')).toHaveCount(0)

    const sw = terminalSection.getByRole('switch')
    await expect(sw).toHaveAttribute('aria-checked', 'false')
    await sw.click()
    await expect(sw).toHaveAttribute('aria-checked', 'true')

    await page.keyboard.press('Escape')
    await openSettings(page)
    await page.locator('[data-ui="settings-scope"]').getByRole('radio').nth(1).click()

    const swReopened = page.locator('section[aria-labelledby="ws-section-terminal"]').getByRole('switch')
    await expect(swReopened).toHaveAttribute('aria-checked', 'true')
  } finally {
    await electronApp.close()
  }
})
