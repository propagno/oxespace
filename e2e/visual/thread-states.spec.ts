import { test, expect } from '@playwright/test'
import { freezeClock, launchApp, openDemoWorkspace, resizeWindow, type Appearance } from '../helpers/launch'
import { installThreadFixtures, openThreadWithState, registerThreadProject, setThreadState, THREAD_STATES, type ThreadStateName } from '../helpers/thread-fixtures'
import { expectSurface } from '../helpers/visual'

const THEMES: Appearance[] = ['light', 'dark']
const STATES = Object.keys(THREAD_STATES) as ThreadStateName[]

for (const theme of THEMES) {
  test(`thread states — ${theme}`, async () => {
    test.setTimeout(180_000)
    const { app, page, workspaceRoot, consoleErrors } = await launchApp({ appearance: theme })
    try {
      // Verbose view shows every action row, which keeps the catalogue deterministic.
      await page.evaluate(() => localStorage.setItem('oxe.thread.viewMode', 'verbose'))
      await page.reload()
      await page.waitForLoadState('load')
      await freezeClock(page)
      await resizeWindow(app, 1280, 800)
      await installThreadFixtures(app, workspaceRoot)
      await openDemoWorkspace(page, workspaceRoot)
      await registerThreadProject(app, page, workspaceRoot)
      await openThreadWithState(app, page, workspaceRoot, STATES[0])

      for (const state of STATES) {
        await setThreadState(app, workspaceRoot, state)
        // The timeline re-renders from the pushed snapshot; wait for the title it carries.
        await expect(page.locator('.thread-view')).toContainText(THREAD_STATES[state].title.split(' ')[0])
        await expectSurface(page, `thread-${state}-${theme}`, {
          // Time is frozen, so ages and countdowns are stable. Code terminals stay mounted
          // behind Thread: masking `.xterm` here would hide the conversation itself.
          hide: [page.locator('.app-statusbar [class*="path"]')]
        })
        expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false)
      }
      expect(consoleErrors).toEqual([])
    } finally {
      await app.close()
    }
  })
}
