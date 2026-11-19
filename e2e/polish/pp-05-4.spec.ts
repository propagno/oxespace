// End-to-end acceptance test for 1.5.2 Polimento · OxeCode painéis (Jira OXE-261, PP-05·4, CA-4),
// in the built app with real services (OXESPACE_E2E_MOCK_NATIVE=0).
import { expect, test } from '@playwright/test'
import { launchApp, openDemoWorkspace } from '../helpers/launch'

const REAL = { OXESPACE_E2E_MOCK_NATIVE: '0' }

test('PP-05·4 in the app: keyboard navigation reveals the 24 px close target and closes an editor tab', async () => {
  const { electronApp, page } = await launchApp({ env: REAL })
  try {
    await openDemoWorkspace(page)
    await page.keyboard.press('Control+e')
    await expect(page.getByTestId('workspace-editor-panel')).toBeVisible({ timeout: 15_000 })

    const firstFile = page.locator('.editor-browser-file').first()
    await expect(firstFile).toBeVisible({ timeout: 10_000 })
    await firstFile.click()

    const tabs = page.getByTestId('editor-tabs')
    const tab = tabs.getByRole('tab').first()
    await expect(tab).toBeVisible({ timeout: 10_000 })

    await tab.focus()
    await expect(tab).toBeFocused()

    const closeBtn = tab.locator('.editor-tab-close')
    const metrics = await closeBtn.evaluate((el) => {
      const style = getComputedStyle(el)
      const rect = el.getBoundingClientRect()
      return { opacity: Number(style.opacity), width: rect.width, height: rect.height }
    })
    expect(metrics.opacity).toBeGreaterThan(0)
    expect(metrics.width).toBeGreaterThanOrEqual(24)
    expect(metrics.height).toBeGreaterThanOrEqual(24)

    const countBefore = await tabs.getByRole('tab').count()
    await page.keyboard.press('Delete')
    await expect(tabs.getByRole('tab')).toHaveCount(countBefore - 1)
  } finally {
    await electronApp.close()
  }
})
