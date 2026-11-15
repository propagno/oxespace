// Frozen end-to-end acceptance test for 1.5.2 OxeCode/Shell F6 (Jira OXE-82, BRD-14), in the built app with real
// terminals (OXESPACE_E2E_MOCK_NATIVE=0). Written by the planner; the executor must not edit it. Red until T33 lands.
// Contract: every terminal's header is [data-ui=pane-header]; no terminal has the command-line footer
// (.terminal-cmd-input); the pane the person clicks is the focused one (its header data-focused="true", one at a time);
// no header says "Branch unavailable".
import { expect, test } from '@playwright/test'
import { launchApp, openDemoWorkspace, resizeWindow } from '../../helpers/launch'

test('BRD-14 in the app: PaneHeader on every terminal, no command-line footer, one focused pane', async () => {
  test.setTimeout(180_000)
  const { app, page, workspaceRoot } = await launchApp({ appearance: 'light', env: { OXESPACE_E2E_MOCK_NATIVE: '0' } })
  try {
    await resizeWindow(app, 1440, 900)
    await openDemoWorkspace(page, workspaceRoot)
    const containers = page.locator('[data-testid="pane-container"]')
    await expect.poll(() => containers.count()).toBeGreaterThan(1)
    const count = await containers.count()
    await expect(page.locator('[data-testid="pane-container"] [data-ui="pane-header"]')).toHaveCount(count)
    await expect(page.locator('.terminal-cmd-input')).toHaveCount(0)
    await containers.nth(1).click()
    await expect(containers.nth(1).locator('[data-ui="pane-header"]')).toHaveAttribute('data-focused', 'true')
    await expect(page.locator('[data-ui="pane-header"][data-focused="true"]')).toHaveCount(1)
    await expect(page.locator('[data-ui="pane-header"]').filter({ hasText: /branch unavailable/i })).toHaveCount(0)
  } finally {
    await app.close()
  }
})
