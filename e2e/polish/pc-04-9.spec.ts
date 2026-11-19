// Acceptance test for 1.5.2 Polimento · OxeCode superfície (Jira OXE-255, PC-04·9, CA-3), in the built app with real
// services (OXESPACE_E2E_MOCK_NATIVE=0).
// Contract: with a workspace open and the OxeCode sidebar expanded, the accessibility tree has exactly one
// Collapse sidebar button.
import { expect, test } from '@playwright/test'
import { launchApp, layoutAtWidth, openDemoWorkspace } from '../helpers/launch'

test('PC-04·9 in the app: the open sidebar has exactly one Collapse sidebar button', async () => {
  test.setTimeout(180_000)
  const { app, page, workspaceRoot } = await launchApp({
    appearance: 'light',
    env: { OXESPACE_E2E_MOCK_NATIVE: '0' }
  })
  try {
    await layoutAtWidth(app, page, 1440, 900)
    await openDemoWorkspace(page, workspaceRoot)
    const sidebar = page.locator('aside.sidebar')
    await expect(sidebar).toBeVisible()
    const collapseButtons = sidebar.getByRole('button', { name: /^Collapse (the )?sidebar/i })
    await expect(collapseButtons).toHaveCount(1)
    await expect(sidebar.locator('[data-ui="sidebar-header"]').getByRole('button', { name: /^Collapse (the )?sidebar/i })).toHaveCount(1)
  } finally {
    await app.close()
  }
})
