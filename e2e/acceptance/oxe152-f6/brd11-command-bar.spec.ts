// Frozen end-to-end acceptance test for 1.5.2 OxeCode/Shell F6 (Jira OXE-75, BRD-11), in the built app with real
// terminals (OXESPACE_E2E_MOCK_NATIVE=0). Written by the planner; the executor must not edit it. Red until T30 lands.
// Contract: Ctrl+K opens [data-ui=command-bar] with one [data-ui=command-hints] line and no example cards; ">" lists only
// commands, every result a one-line [data-ui=command-row]; Esc closes it.
// The other palette shortcut (Ctrl+Shift+P) opening the same bar is T30b's (coordination 15/11).
import { expect, test } from '@playwright/test'
import { launchApp, openDemoWorkspace, resizeWindow } from '../../helpers/launch'

test('BRD-11 in the app: one command bar, a hints line, ">" for commands', async () => {
  test.setTimeout(180_000)
  const { app, page, workspaceRoot } = await launchApp({ appearance: 'light', env: { OXESPACE_E2E_MOCK_NATIVE: '0' } })
  try {
    await resizeWindow(app, 1440, 900)
    await openDemoWorkspace(page, workspaceRoot)
    await page.locator('[data-testid="pane-container"]').first().click()
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+K' : 'Control+K')
    const bar = page.locator('[data-ui="command-bar"]')
    await expect(bar).toHaveCount(1)
    await expect(bar.locator('[data-ui="command-hints"]')).toHaveCount(1)
    await expect(bar.getByText('@Codex write tests for the Pix webhook')).toHaveCount(0)
    await page.keyboard.type('>')
    const options = bar.getByRole('option')
    await expect.poll(() => options.count()).toBeGreaterThan(0)
    const commands = bar.getByRole('group', { name: 'Commands' })
    expect(await options.count()).toBe(await commands.getByRole('option').count())
    for (const option of await options.all()) await expect(option).toHaveAttribute('data-ui', 'command-row')
    await page.keyboard.press('Escape')
    await expect(bar).toHaveCount(0)
  } finally {
    await app.close()
  }
})
