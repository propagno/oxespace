import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { launchApp, layoutAtWidth, layoutDiag, openDemoWorkspace, resizeWindow } from './helpers/launch'
import { installThreadFixtures, openThreadWithState, registerThreadProject } from './helpers/thread-fixtures'

/**
 * OxeChat's side panel (changes, files, details…) sits beside the conversation, the way OxeCode's panels do, whenever
 * both keep their minimum width (360 + 320 px). It used to become a drawer over the conversation below 1120 px of
 * workbench, so on a common laptop window it covered the suggestions and the composer. Only a workbench too narrow for
 * both still gets the drawer.
 */
const box = (page: Page, selector: string) => page.locator(selector).evaluate(node => { const r = node.getBoundingClientRect(); return { left: Math.round(r.left), right: Math.round(r.right), width: Math.round(r.width) } })

/**
 * Lays the window out so the thread workbench (not the whole shell) is about `width` CSS px wide. Below the window's
 * minimum width the page is zoomed in instead, which narrows the CSS layout the same way a smaller window would.
 */
async function workbenchAt(app: ElectronApplication, page: Page, width: number): Promise<number> {
  const shell = await box(page, '.app-shell'), workbench = await box(page, '.thread-workbench')
  const wanted = width + (shell.width - workbench.width)
  await resizeWindow(app, Math.max(wanted, 1000), 760)
  if (wanted >= 1000) await layoutAtWidth(app, page, wanted, 760)
  else {
    await expect.poll(async () => {
      await app.evaluate(({ BrowserWindow }, css) => {
        const win = BrowserWindow.getAllWindows()[0]
        const factor = win.getContentBounds().width / css
        if (Math.abs(win.webContents.getZoomFactor() - factor) > 0.001) win.webContents.setZoomFactor(factor)
      }, wanted)
      return Math.abs((await box(page, '.app-shell')).width - wanted) <= 2
    }, { message: `the shell lays out ${wanted} CSS px wide`, timeout: 10_000 }).toBe(true)
  }
  await expect.poll(async () => Math.abs((await box(page, '.thread-workbench')).width - width), { message: `workbench ~${width} px` }).toBeLessThanOrEqual(8)
  return (await box(page, '.thread-workbench')).width
}

test('OxeChat side panel is a column beside the conversation at 1024 and 1280 px, a drawer at 600', async () => {
  test.setTimeout(180_000)
  const { app, page, workspaceRoot } = await launchApp({ locale: 'en-US' })
  try {
    await installThreadFixtures(app, workspaceRoot)
    await openDemoWorkspace(page, workspaceRoot)
    await registerThreadProject(app, page, workspaceRoot)
    await openThreadWithState(app, page, workspaceRoot, 'conversation')
    await page.locator('.thread-heading').getByRole('button', { name: 'Conversation details' }).click()
    const panel = page.getByTestId('thread-session-panel')
    await expect(panel).toBeVisible()

    for (const width of [1280, 1024]) {
      const actual = await workbenchAt(app, page, width)
      await expect(page.locator('.thread-workbench'), `${actual} px: ${await layoutDiag(app, page)}`).not.toHaveClass(/is-drawer/)
      await expect(page.locator('.thread-review-scrim')).toHaveCount(0)
      await expect(panel).toBeVisible()
      // The conversation ends where the panel begins: nothing of the chat, its composer included, is under the panel.
      const review = await box(page, '.thread-review-host')
      const conversation = await box(page, '.thread-workbench > .thread-view')
      const composer = await box(page, '.thread-composer')
      expect(conversation.right, `conversation ${JSON.stringify(conversation)} vs panel ${JSON.stringify(review)}`).toBeLessThanOrEqual(review.left + 1)
      expect(composer.right).toBeLessThanOrEqual(review.left + 1)
      expect(conversation.width).toBeGreaterThanOrEqual(360)
      expect(review.width).toBeGreaterThanOrEqual(320)
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
      await page.screenshot({ path: `test-results/thread-panel-column-${width}.png` })
    }

    const narrow = await workbenchAt(app, page, 600)
    await expect(page.locator('.thread-workbench'), `${narrow} px`).toHaveClass(/is-drawer/)
    await expect(panel).toBeVisible()
    await page.screenshot({ path: 'test-results/thread-panel-column-600.png' })
  } finally { await app.close() }
})
