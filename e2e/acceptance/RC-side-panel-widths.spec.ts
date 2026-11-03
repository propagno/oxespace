import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { realpathSync } from 'node:fs'
import { launchReal, mode, quitReal, realProfile } from './real-app'

/**
 * 1.4.0 RC (#537) · Black box, REAL app: OxeChat's side panel (Conversation details) sits beside the conversation when
 * the window is wide, and is a drawer over it only when the window is narrow. Measured at 1280 and 640 CSS px of window,
 * as a person would see it. The Windows runner's screen is 1024×768, so the width is set by zoom when the window
 * cannot grow, which lays the page out the same way. A new conversation is created through the window's own API
 * (creating one starts no agent).
 */
type Api = { thread: { addProject: (root: string) => Promise<{ projectId: string }>; create: (i: { projectId: string; rootPath?: string; provider: 'claude' }) => Promise<{ thread: { id: string } }> } }
const box = (page: Page, selector: string) => page.locator(selector).first().evaluate(node => { const r = node.getBoundingClientRect(); return { left: Math.round(r.left), right: Math.round(r.right), width: Math.round(r.width) } })

async function windowAt(app: ElectronApplication, page: Page, css: number): Promise<number> {
  await app.evaluate(({ BrowserWindow }, w) => { const win = BrowserWindow.getAllWindows()[0]; win.webContents.setZoomFactor(1); win.setSize(w, 900) }, css)
  await page.waitForTimeout(600)
  await app.evaluate(({ BrowserWindow }, w) => { const win = BrowserWindow.getAllWindows()[0]; const f = win.getContentBounds().width / w; if (f < 0.999 || f > 1.001) win.webContents.setZoomFactor(f) }, css)
  await expect.poll(() => page.evaluate(() => window.innerWidth), { message: `window lays out ~${css} CSS px` }).toBeGreaterThan(css - 24)
  await page.waitForTimeout(800)
  return page.evaluate(() => window.innerWidth)
}

test('#537: the side panel is a column at 1280 px and a drawer at 640 px (real app)', async () => {
  test.setTimeout(180_000)
  const profile = realProfile('rc537', { OXESPACE_LOCALE: 'en-US' })
  const { app, page } = await launchReal(profile)
  const out: Record<string, unknown> = {}
  try {
    await app.evaluate(({ dialog }) => { dialog.showMessageBox = (() => new Promise(() => undefined)) as typeof dialog.showMessageBox; dialog.showMessageBoxSync = (() => 0) as typeof dialog.showMessageBoxSync })
    // The long form of the path: the Windows runner's temp folder is an 8.3 short path (RUNNER~1), a known 1.4.1 item.
    const root = realpathSync.native(profile.repo)
    const { projectId } = await page.evaluate(r => (window as unknown as { oxe: Api }).oxe.thread.addProject(r), root)
    await page.evaluate(i => (window as unknown as { oxe: Api }).oxe.thread.create({ projectId: i.projectId, rootPath: i.root, provider: 'claude' }), { projectId, root })
    await windowAt(app, page, 1280)
    await mode(page, 'thread')
    const nav = page.locator('.thread-navigation')
    await nav.waitFor({ timeout: 15_000 })
    // The conversation the window just created: the person clicks it in the list.
    const item = nav.locator('[data-thread-id], [role="treeitem"], [role="option"], li button').first()
    if (await item.waitFor({ state: 'visible', timeout: 8_000 }).then(() => true, () => false)) await item.click()
    await page.locator('.thread-heading').first().waitFor({ timeout: 15_000 })
    await page.locator('.thread-heading').getByRole('button', { name: /Conversation details/i }).click()
    const panel = page.getByTestId('thread-session-panel')
    await expect(panel).toBeVisible()

    for (const css of [1280, 640]) {
      const width = await windowAt(app, page, css)
      await expect(panel, `${css}: the panel stays open`).toBeVisible()
      const drawer = await page.locator('.thread-workbench').first().evaluate(node => node.classList.contains('is-drawer'))
      const scrim = await page.locator('.thread-review-scrim').count()
      const conversation = await box(page, '.thread-workbench > .thread-view')
      const review = await box(page, '.thread-review-host')
      const composer = await box(page, '.thread-workbench > .thread-view textarea, .thread-workbench > .thread-view [contenteditable="true"]').catch(() => null)
      out[css] = { innerWidth: width, workbench: await box(page, '.thread-workbench'), drawer, scrim, conversation, review, composer }
      await page.screenshot({ path: test.info().outputPath(`side-panel-${css}.png`) })
      if (css === 1280) {
        expect.soft(drawer, '1280: a column, not a drawer').toBe(false)
        expect.soft(scrim, '1280: no scrim over the conversation').toBe(0)
        expect.soft(conversation.right, '1280: the conversation ends where the panel begins').toBeLessThanOrEqual(review.left + 1)
        if (composer) expect.soft(composer.right, '1280: the composer is not under the panel').toBeLessThanOrEqual(review.left + 1)
      } else {
        expect.soft(drawer, '640: a drawer').toBe(true)
      }
    }
  } finally {
    console.log('RC537', JSON.stringify(out))
    await quitReal(app)
  }
})
