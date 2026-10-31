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
