// Frozen end-to-end acceptance test for 1.5.2 OxeCode/Shell F6 (Jira OXE-84, BRD-15), in the built app with real
// terminals and git (OXESPACE_E2E_MOCK_NATIVE=0). Written by the planner; the executor must not edit it. Red until T34.
// Contract: Changes and Browser opened from the Panels menu (btn-open-tools, the path the conformance scene takes) are each
// one [data-ui=dock-panel] region named by its title, with that title in an h2 of its header and the close control last.
import { expect, test } from '@playwright/test'
import { launchApp, layoutAtWidth, openDemoWorkspace } from '../../helpers/launch'

test('BRD-15 in the app: Changes and Browser are DockPanels', async () => {
  test.setTimeout(180_000)
  const { app, page, workspaceRoot } = await launchApp({ appearance: 'light', env: { OXESPACE_E2E_MOCK_NATIVE: '0' } })
  try {
    await layoutAtWidth(app, page, 1440, 900)
    await openDemoWorkspace(page, workspaceRoot)
    for (const name of ['Changes', 'Browser']) {
      await page.getByTestId('btn-open-tools').click()
      await page.getByRole('menu', { name: 'Panels' }).getByRole('menuitemcheckbox', { name: new RegExp(`^${name}$`) }).click()
      const panel = page.locator(`[data-ui="dock-panel"][aria-label="${name}"]`)
      await expect(panel).toHaveCount(1)
      await expect(panel.locator('header h2')).toHaveText(name)
      const last = panel.locator('header').locator('button, [role="button"]').last()
      await expect(last).toHaveAttribute('aria-label', 'Collapse panel')
    }
  } finally {
    await app.close()
  }
})
