// Acceptance test for 1.5.2 Polimento · OxeCode superfície (Jira OXE-256, PC-04·10, CA-3), in the built app with real
// services (OXESPACE_E2E_MOCK_NATIVE=0) in pt-BR.
// Contract: when the app opens a workspace in pt-BR, the first sidebar row is marked as current (aria-current="true")
// and displays "Terminal 1" (never "terminal 1").
import { expect, test } from '@playwright/test'
import { launchApp, layoutAtWidth, openDemoWorkspace } from '../helpers/launch'

test('PC-04·10 in the app: in pt-BR the first sidebar row is current at start and says Terminal 1', async () => {
  test.setTimeout(180_000)
  const { app, page, workspaceRoot } = await launchApp({
    appearance: 'light',
    locale: 'pt-BR',
    env: { OXESPACE_E2E_MOCK_NATIVE: '0' }
  })
  try {
    await layoutAtWidth(app, page, 1440, 900)
    await openDemoWorkspace(page, workspaceRoot)
    const firstRow = page.locator('aside.sidebar [data-ui="sidebar-row"]').first()
    await expect(firstRow).toBeVisible()
    await expect(firstRow).toHaveAttribute('aria-current', 'true')
    await expect(firstRow).toContainText('Terminal 1')
    await expect(firstRow).not.toContainText('terminal 1')
  } finally {
    await app.close()
  }
})
