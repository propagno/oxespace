import { test, expect, type ElectronApplication, type Locator, type Page } from '@playwright/test'
import { launchApp, resizeWindow } from '../helpers/launch'
import { togglePanel } from '../helpers/panels'
import { seedGitRepo } from '../helpers/seed'
import { installThreadFixtures, openThreadWithState, registerThreadProject } from '../helpers/thread-fixtures'
import { expectSurface } from '../helpers/visual'

/**
 * The layout floor and the wide end (docs/design/layout.md): the six anchor screens at a 960×640 window with the
 * interface at 125% (a 768px viewport, the smallest the app supports) and at 1920×1080 at 100%. Each screen must
 * fit without horizontal scroll and keep its primary controls whole. The scale is set the way a person sets it,
 * Settings › Appearance › Interface scale, which zooms the window (webContents.setZoomFactor) and is kept in the
 * settings store, so it survives the rest of the run.
 */
const MATRIX = [
  { name: 'floor-125', width: 960, height: 640, scale: '125%', factor: 1.25 },
  { name: 'wide-100', width: 1920, height: 1080, scale: '100%', factor: 1 }
] as const

const zoomFactor = (app: ElectronApplication) => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.getZoomFactor())
// Live text that changes between runs: the temp path and the sidebar ages.
const liveText = (page: Page) => [page.locator('.app-statusbar [class*="path"]'), page.locator('.pane-row-time')]

/** No horizontal scroll on the page. */
async function expectNoHorizontalScroll(page: Page): Promise<void> {
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false)
}

/**
 * Each control is visible, inside the window, and not cut by an ancestor that clips its overflow
 * (a header or toolbar too narrow for it). One pixel of tolerance absorbs subpixel layout at 125%.
 */
async function expectUnclipped(controls: Locator[]): Promise<void> {
  for (const control of controls) {
    await expect(control).toBeVisible()
    const clipped = await control.evaluate(element => {
      const box = element.getBoundingClientRect()
      const outside = (outer: { left: number; top: number; right: number; bottom: number }) =>
        box.left < outer.left - 1 || box.top < outer.top - 1 || box.right > outer.right + 1 || box.bottom > outer.bottom + 1
      if (outside({ left: 0, top: 0, right: innerWidth, bottom: innerHeight })) return 'outside the window'
      for (let parent = element.parentElement; parent; parent = parent.parentElement) {
        const style = getComputedStyle(parent)
        if (style.overflowX === 'visible' && style.overflowY === 'visible') continue
        // Scroll areas only clip what is scrolled out of view; the controls checked here are in view.
        if (/auto|scroll/.test(style.overflowX + style.overflowY)) continue
        if (outside(parent.getBoundingClientRect())) return `clipped by ${parent.tagName.toLowerCase()}.${[...parent.classList].join('.')}`
      }
      return null
    })
    expect(clipped, `${control}`).toBeNull()
  }
}

for (const size of MATRIX) {
  test(`responsive matrix — ${size.name}`, async () => {
    test.setTimeout(240_000)
    const { app, page, workspaceRoot, consoleErrors } = await launchApp({ appearance: 'light' })
    try {
      seedGitRepo(workspaceRoot, { withBranchChanges: true })
      await installThreadFixtures(app, workspaceRoot)
      await resizeWindow(app, size.width, size.height)
      await page.waitForSelector('[data-testid="btn-new-workspace"]')

      // 1. Settings (Appearance, the page it opens on), where the scale is chosen.
      await page.getByRole('button', { name: 'Open settings', exact: true }).click()
      const settings = page.getByRole('dialog', { name: 'Settings', exact: true })
      await expect(settings).toBeVisible()
      await settings.getByRole('group', { name: 'Settings scope' }).getByRole('button', { name: 'Application', exact: true }).click()
      await settings.getByRole('radio', { name: size.scale, exact: true }).click()
      await expect.poll(() => zoomFactor(app)).toBe(size.factor)
      await expect.poll(() => page.evaluate(() => innerWidth)).toBe(Math.round(size.width / size.factor))
      await expectNoHorizontalScroll(page)
      await expectUnclipped([settings.getByRole('button', { name: 'Back to work' }), settings.getByRole('group', { name: 'Settings scope' })])
      await expectSurface(page, `matrix-settings-${size.name}`)
      await settings.getByRole('button', { name: 'Back to work' }).click()
      await expect(settings).toHaveCount(0)

      // 2. Empty state.
      await expectNoHorizontalScroll(page)
      await expectUnclipped([page.getByTestId('btn-new-workspace')])
      await expectSurface(page, `matrix-empty-${size.name}`)

      // 3. Workspace home (Code).
      await page.getByTestId('btn-new-workspace').click()
      await page.getByTestId('wizard-dir-input').fill(workspaceRoot)
      await page.getByTestId('wizard-launch-btn').click()
      await page.waitForSelector('[data-testid="workspace-grid"], [data-testid="workspace-split-grid"]', { timeout: 10_000 })
      await expectNoHorizontalScroll(page)
      await expectUnclipped([page.locator('[data-testid="btn-open-tools"]:visible'), page.getByRole('navigation', { name: 'Application view' })])
      await expectSurface(page, `matrix-workspace-${size.name}`, { hide: liveText(page) })

      // 4. Code with a docked side panel: the panel's header and file list follow the panel's width (container queries).
      await togglePanel(page, 'Changes')
      const changes = page.getByTestId('changes-panel')
      await expect(changes).toBeVisible()
      await expectNoHorizontalScroll(page)
      await expectUnclipped([changes.getByRole('complementary', { name: 'Changed files' })])
      await expectSurface(page, `matrix-code-changes-${size.name}`, { hide: liveText(page) })
      await togglePanel(page, 'Changes')

      // 5. Thread conversation: heading context (project, branch) in compact form when narrow, composer and send.
      await registerThreadProject(app, page, workspaceRoot)
      await openThreadWithState(app, page, workspaceRoot, 'conversation')
      const view = page.locator('.thread-view')
      await expect(view).toContainText('Authentication')
      await expectNoHorizontalScroll(page)
      await expectUnclipped([view.locator('.thread-heading-context'), view.getByRole('button', { name: 'More actions' }).first(), view.locator('.thread-composer textarea')])
      await expectSurface(page, `matrix-thread-${size.name}`, { hide: [page.locator('.app-statusbar [class*="path"]')] })

      // 6. OxeQuery.
      await page.getByRole('navigation', { name: 'Application view' }).getByRole('button', { name: 'OxeQuery' }).click()
      const query = page.locator('.oq-view')
      await query.waitFor()
      await expect(page.getByRole('button', { name: 'mongo-dev', exact: true }).first()).toBeVisible()
      await expectNoHorizontalScroll(page)
      await expectUnclipped([page.getByRole('button', { name: 'New connection' }).first(), page.getByRole('button', { name: 'New database' })])
      await expectSurface(page, `matrix-oxequery-${size.name}`, { target: query, mask: [page.locator('.oq-duration, [data-oq-volatile], .oq-statusbar time, .oq-state-since, .oq-timing')] })

      expect(consoleErrors).toEqual([])
    } finally {
      await app.close()
    }
  })
}
