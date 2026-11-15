// Frozen end-to-end acceptance test for 1.5.2 OxeCode/Shell F6 (Jira OXE-184, AG-04c, CA-4), in the built app with real
// services (OXESPACE_E2E_MOCK_NATIVE=0). Written by the planner; the executor must not edit it. Red until T41.
// Contract: the Changes panel's scope badge is a toggle button in the accessibility tree: "Pin the scope", not pressed;
// Enter from the keyboard pins it ("Follow the active pane", pressed); Space unpins it again.
import { expect, test } from '@playwright/test'
import { launchApp, openDemoWorkspace, resizeWindow } from '../helpers/launch'

test('AG-04c in the app: the pin is a toggle with its state, from the keyboard', async () => {
  test.setTimeout(180_000)
  const { app, page, workspaceRoot } = await launchApp({ appearance: 'light', env: { OXESPACE_E2E_MOCK_NATIVE: '0' } })
  try {
    await resizeWindow(app, 1440, 900)
    await openDemoWorkspace(page, workspaceRoot)
    await page.getByTestId('btn-open-tools').click()
    await page.getByRole('menu', { name: 'Panels' }).getByRole('menuitemcheckbox', { name: /^Changes$/ }).click()
    const pin = page.getByRole('button', { name: 'Pin the scope', pressed: false })
    await expect(pin).toHaveCount(1)
    await pin.focus()
    await page.keyboard.press('Enter')
    const follow = page.getByRole('button', { name: 'Follow the active pane', pressed: true })
    await expect(follow).toHaveCount(1)
    await follow.focus()
    await page.keyboard.press('Space')
    await expect(page.getByRole('button', { name: 'Pin the scope', pressed: false })).toHaveCount(1)
  } finally {
    await app.close()
  }
})
