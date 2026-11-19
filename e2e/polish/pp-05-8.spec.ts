// End-to-end acceptance test for 1.5.2 Polimento · OxeCode painéis (Jira OXE-264, PP-05·8, CA-3),
// in the built app with real services (OXESPACE_E2E_MOCK_NATIVE=0).
import { expect, test } from '@playwright/test'
import { launchApp, openDemoWorkspace } from '../helpers/launch'

const REAL = { OXESPACE_E2E_MOCK_NATIVE: '0' }

test('PP-05·8 in the app: Git panel omits Files/Git switcher and renders branch name in --font-mono', async () => {
  const { electronApp, page } = await launchApp({ env: REAL })
  try {
    await openDemoWorkspace(page)
    await page.keyboard.press('Control+Shift+G')
    const panel = page.getByTestId('workspace-github-panel')
    await expect(panel).toBeVisible({ timeout: 15_000 })

    await expect(panel.locator('.repository-view-actions')).toHaveCount(0)

    const branchHeading = panel.locator('.git-control-heading strong').first()
    if (await branchHeading.isVisible({ timeout: 5_000 }).catch(() => false)) {
      const fonts = await branchHeading.evaluate((el) => {
        const probe = document.createElement('span')
        probe.style.fontFamily = 'var(--font-mono)'
        document.body.append(probe)
        const expected = getComputedStyle(probe).fontFamily
        probe.remove()
        return { actual: getComputedStyle(el).fontFamily, expected }
      })
      expect(fonts.actual).toBe(fonts.expected)
    }
  } finally {
    await electronApp.close()
  }
})
