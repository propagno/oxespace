import { test, expect } from '@playwright/test'
import { launchApp, openDemoWorkspace, resizeWindow, type Appearance } from '../helpers/launch'
import { expectSurface } from '../helpers/visual'

// Anchor surfaces get the full theme x viewport matrix; everything else in the
// catalogue (see the 1.0 plan) runs in a single combination.
const THEMES: Appearance[] = ['light', 'dark']
const VIEWPORTS = [
  { name: 'compact', width: 900, height: 600 },
  { name: 'desktop', width: 1280, height: 800 }
] as const

for (const theme of THEMES) {
  for (const viewport of VIEWPORTS) {
    test(`empty state and workspace home — ${theme} ${viewport.name}`, async () => {
      const { app, page, workspaceRoot, consoleErrors } = await launchApp({ appearance: theme })
      try {
        await resizeWindow(app, viewport.width, viewport.height)
        await page.waitForSelector('[data-testid="btn-new-workspace"]')
        await expectSurface(page, `empty-${theme}-${viewport.name}`)

        await openDemoWorkspace(page, workspaceRoot)
        // Relative times ("Just now"), the random temp path and terminal
        // output change between runs. Terminals are hidden by expectSurface.
        await expectSurface(page, `workspace-${theme}-${viewport.name}`, {
          hide: [page.locator('.pane-row-time'), page.locator('.app-statusbar [class*="path"]')]
        })

        expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false)
        expect(consoleErrors).toEqual([])
      } finally {
        await app.close()
      }
    })
  }
}

/**
 * The anchor surfaces in the settings people change most, once each at desktop size in light mode: Portuguese (longer
 * labels must not clip), Comfortable density (taller controls) and forced colors (Windows high contrast, where only
 * system colors remain). A layout that breaks in one of these breaks for everyone who uses it.
 */
const VARIANTS: Array<{ name: string; launch: Parameters<typeof launchApp>[0]; forcedColors?: boolean }> = [
  { name: 'pt-BR', launch: { appearance: 'light', locale: 'pt-BR' } },
  { name: 'comfortable', launch: { appearance: 'light', density: 'comfortable' } },
  { name: 'forced-colors', launch: { appearance: 'light' }, forcedColors: true }
]

for (const variant of VARIANTS) {
  test(`empty state and workspace home — light desktop ${variant.name}`, async () => {
    const { app, page, workspaceRoot, consoleErrors } = await launchApp(variant.launch)
    try {
      await resizeWindow(app, 1280, 800)
      if (variant.forcedColors) await page.emulateMedia({ forcedColors: 'active' })
      await page.waitForSelector('[data-testid="btn-new-workspace"]')
      await expectSurface(page, `empty-light-desktop-${variant.name}`)
      await openDemoWorkspace(page, workspaceRoot)
      await expectSurface(page, `workspace-light-desktop-${variant.name}`, {
        hide: [page.locator('.pane-row-time'), page.locator('.app-statusbar [class*="path"]')]
      })
      expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false)
      expect(consoleErrors).toEqual([])
    } finally {
      await app.close()
    }
  })
}

/**
 * Forced colors on the surfaces where a choice used to vanish (F31): Settings › Appearance (mode cards and segmented
 * controls, the scope rows), the OxePod engine switch, and a new connection set to Production with Read-only on
 * (engine cards, Host/URL, environment, the switch). Once each at desktop size, over a light and a dark base.
 */
for (const theme of THEMES) {
  test(`forced colors: chosen options and the Read-only switch — ${theme} desktop`, async () => {
    test.setTimeout(120_000)
    const { app, page, workspaceRoot, consoleErrors } = await launchApp({ appearance: theme })
    try {
      await resizeWindow(app, 1280, 800)
      await openDemoWorkspace(page, workspaceRoot)
      await page.emulateMedia({ forcedColors: 'active' })
      await page.getByRole('button', { name: 'Open settings', exact: true }).click()
      const settings = page.getByRole('dialog', { name: 'Settings', exact: true })
      await settings.getByRole('group', { name: 'Settings scope' }).getByRole('button', { name: 'Application', exact: true }).click()
      await settings.getByRole('navigation', { name: 'Settings categories' }).getByRole('button', { name: /^Appearance/ }).click()
      await expect(settings.getByRole('radiogroup', { name: 'Density' })).toBeVisible()
      await page.mouse.move(0, 0)
      await expectSurface(page, `forced-colors-settings-appearance-${theme}`, { target: settings })
      await page.keyboard.press('Escape')

      const views = page.getByRole('navigation', { name: 'Application view' })
      await views.getByRole('button', { name: 'OxePod', exact: true }).click()
      const pod = page.getByRole('complementary', { name: /OxePod/ })
      await expect(pod.getByRole('radiogroup', { name: 'Container engine' })).toBeVisible()
      await expectSurface(page, `forced-colors-oxepod-sidebar-${theme}`, { target: pod })

      await views.getByRole('button', { name: 'OxeQuery', exact: true }).click()
      await page.getByRole('button', { name: 'New connection' }).first().click()
      const form = page.getByRole('dialog', { name: 'New connection' })
      await form.getByRole('radiogroup', { name: 'Environment' }).getByRole('radio', { name: 'Production' }).click()
      await expect(form.getByRole('switch', { name: 'Read-only' })).toHaveAttribute('aria-checked', 'true')
      await page.mouse.move(0, 0)
      await page.waitForTimeout(300)
      await expectSurface(page, `forced-colors-new-connection-production-${theme}`, { target: form })
      expect(consoleErrors).toEqual([])
    } finally {
      await app.close()
    }
  })
}
