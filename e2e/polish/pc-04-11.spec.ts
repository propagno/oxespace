// Acceptance test for 1.5.2 Polimento · OxeCode superfície (Jira OXE-257, PC-04·11, CA-4), in the built app with real
// services (OXESPACE_E2E_MOCK_NATIVE=0).
// Contract: with two side-by-side terminals, dragging starting 10 px away from the divider line resizes the panes.
import { expect, test } from '@playwright/test'
import { launchApp, layoutAtWidth, openDemoWorkspace } from '../helpers/launch'

test('PC-04·11 in the app: dragging 10 px from the divider line resizes two side-by-side terminals', async () => {
  test.setTimeout(180_000)
  const { app, page, workspaceRoot } = await launchApp({
    appearance: 'light',
    env: { OXESPACE_E2E_MOCK_NATIVE: '0' }
  })
  try {
    await layoutAtWidth(app, page, 1440, 900)
    await openDemoWorkspace(page, workspaceRoot)

    const panes = page.locator('[data-testid="pane-container"]')
    await expect(panes.first()).toBeVisible({ timeout: 20_000 })

    // Split vertically if the workspace starts with a single pane so two terminals sit side by side.
    if ((await panes.count()) < 2) {
      await page.keyboard.press('Control+Shift+D')
      await expect(panes).toHaveCount(2, { timeout: 10_000 })
    }

    const handle = page.locator('[data-testid="split-resize-handle"][aria-orientation="vertical"]').first()
    await expect(handle).toBeVisible()

    const beforePane = await panes.first().boundingBox()
    const handleBox = await handle.boundingBox()
    expect(beforePane).not.toBeNull()
    expect(handleBox).not.toBeNull()
    expect(handleBox!.width).toBeGreaterThanOrEqual(24)

    const centerX = handleBox!.x + handleBox!.width / 2
    const centerY = handleBox!.y + handleBox!.height / 2
    // Grab 10 px to the right of the divider line and drag 80 px further right.
    await page.mouse.move(centerX + 10, centerY)
    await page.mouse.down()
    await page.mouse.move(centerX + 90, centerY, { steps: 6 })
    await page.mouse.up()

    const afterPane = await panes.first().boundingBox()
    expect(afterPane).not.toBeNull()
    expect(Math.abs(afterPane!.width - beforePane!.width)).toBeGreaterThan(20)
  } finally {
    await app.close()
  }
})
