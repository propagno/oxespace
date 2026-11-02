import { expect, test } from '@playwright/test'
import { launchApp, openDemoWorkspace } from '../helpers/launch'

/**
 * F35 (S6) · The Team button leaves the title bar; Team is one shortcut away.
 * Roadmap acceptance: Team opens from the command palette and from the project/workspace menu; the title bar has no
 * Team button; the activity bell stays.
 */
test('F35: Team is off the title bar and opens from the palette and the workspace menu', async () => {
  const { app, page, workspaceRoot } = await launchApp({ locale: 'en-US' })
  try {
    await openDemoWorkspace(page, workspaceRoot)
    const titleBar = page.locator('[data-testid="title-bar"], header').first()
    await expect(titleBar).toBeVisible()
    expect(await titleBar.getByRole('button', { name: /^Team\b/i }).count(), 'no Team button in the title bar').toBe(0)
    await expect(page.getByTestId('activity-bell'), 'the activity bell stays').toBeVisible()

    await page.keyboard.press('Control+k')
    await page.keyboard.type('Team')
    await page.getByRole('option', { name: /Team/ }).first().click()
    const team = page.getByRole('dialog', { name: /Team/ })
    await expect(team, 'the palette opens Team').toBeVisible()
    await page.keyboard.press('Escape')
    await expect(team).toHaveCount(0)

    await page.getByRole('button', { name: /^Actions for / }).locator('visible=true').first().click()
    await page.getByRole('menuitem', { name: /Team/ }).click()
    await expect(page.getByRole('dialog', { name: /Team/ }), 'the workspace menu opens Team').toBeVisible()
  } finally { await app.close() }
})
