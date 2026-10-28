import { test, expect } from '@playwright/test'
import { launchApp, resizeWindow } from '../helpers/launch'
import { expectSurface } from '../helpers/visual'

/**
 * The design system viewer renders every primitive and state in light and dark side by side, so one baseline per
 * section catches a regression in any of them, in both modes, before it reaches a screen.
 */
test('the design system viewer: components and states in both modes', async () => {
  test.setTimeout(120_000)
  const { app, page, consoleErrors } = await launchApp({ appearance: 'light' })
  try {
    await resizeWindow(app, 1280, 900)
    await page.keyboard.press('Control+k')
    await expect(page.locator('[cmdk-root]')).toBeVisible()
    await page.keyboard.insertText('Design System')
    await page.locator('[cmdk-item]', { hasText: 'Design System: Open Viewer' }).click()
    const viewer = page.getByRole('dialog', { name: 'Design system' })
    await expect(viewer).toBeVisible()
    const nav = viewer.getByRole('navigation', { name: 'Design system sections' })
    // The viewer scrolls inside the window; a tall viewport lets one capture hold a whole section.
    await page.setViewportSize({ width: 1280, height: 2600 })
    for (const [section, name] of [['Components', 'components'], ['States', 'states']] as const) {
      await nav.getByRole('button', { name: section, exact: true }).click()
      await expect(viewer.getByRole('heading', { level: 2, name: section })).toBeVisible()
      await expectSurface(page, `design-system-${name}`, { target: viewer.locator('main') })
    }
    expect(consoleErrors).toEqual([])
  } finally {
    await app.close()
  }
})
