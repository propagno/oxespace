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
        // Relative times ("Just now"), the random temp path and blinking terminal
        // cursors change between runs. Terminal rendering gets its own spec.
        await expectSurface(page, `workspace-${theme}-${viewport.name}`, {
          mask: [page.locator('.pane-row-time'), page.locator('.app-statusbar [class*="path"]'), page.locator('.xterm')]
        })

        expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false)
        expect(consoleErrors).toEqual([])
      } finally {
        await app.close()
      }
    })
  }
}
