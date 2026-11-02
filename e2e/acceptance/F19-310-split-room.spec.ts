import { expect, test, type Page } from '@playwright/test'
import { launchReal, openRepo, quitReal, realProfile } from './real-app'

/**
 * #310 · A split that would leave panes too small is refused, with its reason, instead of squeezing them. REAL app,
 * black box, at the runner's window size: split the newest pane right until the app refuses, then down until it refuses.
 * No pane is ever narrower than 240 px or shorter than 120 px, and each refusal says why ("narrower than 240 px",
 * "shorter than 120 px") and what to do.
 */
const panes = (page: Page) => page.locator('[data-testid="pane-container"]')
const sizes = (page: Page) => panes(page).evaluateAll(list => list.map(e => { const r = e.getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height)] }))

async function split(page: Page, direction: 'right' | 'down'): Promise<string> {
  const last = panes(page).last()
  await last.getByRole('button', { name: /More pane actions/ }).click()
  const item = page.getByRole('menuitem', { name: direction === 'right' ? /Split pane right/ : /Split pane down/ })
  // In a short window the pane menu can sit past the bottom edge: then the pane's own shortcut (Settings › Keyboard,
  // Ctrl+Shift+\ / Ctrl+Shift+-), from the focused pane, is the same split.
  if (!(await item.click({ timeout: 5_000 }).then(() => true, () => false))) {
    await page.keyboard.press('Escape')
    await last.locator('.xterm').click()
    await page.keyboard.press(direction === 'right' ? 'Control+Shift+Backslash' : 'Control+Shift+Minus')
  }
  await page.waitForTimeout(1_200)
  return (await page.locator('[data-toast]').allInnerTexts().catch(() => [] as string[])).join(' | ')
}

test('#310: splits stop before panes get too small, and the refusal says why', async () => {
  test.setTimeout(240_000)
  const profile = realProfile('split310', { OXESPACE_LOCALE: 'en-US' })
  const { app, page } = await launchReal(profile)
  const out: Record<string, unknown> = {}
  try {
    await app.evaluate(({ dialog }) => {
      dialog.showMessageBox = (() => new Promise(() => undefined)) as typeof dialog.showMessageBox
      dialog.showMessageBoxSync = (() => 0) as typeof dialog.showMessageBoxSync
    })
    await openRepo(page, profile.repo)
    // 1280×900 (coordinator, RC). A runner screen of 1024×768 clamps the window, so the page is zoomed to keep that
    // much room in CSS pixels, the unit the 240/120 px limits are measured in.
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1280, 900))
    await page.waitForTimeout(500)
    const inner = await page.evaluate(() => [window.innerWidth, window.innerHeight])
    if (inner[0] < 1200) await app.evaluate(({ BrowserWindow }, z) => BrowserWindow.getAllWindows()[0].webContents.setZoomFactor(z), Math.max(0.6, Math.min(inner[0] / 1280, inner[1] / 860)))
    await page.waitForTimeout(800)
    out.window = await page.evaluate(() => [window.innerWidth, window.innerHeight])
    for (const direction of ['right', 'down'] as const) {
      const steps: unknown[] = []
      let refusal = ''
      for (let i = 0; i < 8 && !refusal; i++) {
        const before = await panes(page).count()
        const toasts = await split(page, direction)
        const after = await panes(page).count()
        steps.push({ before, after, toasts: toasts.slice(0, 200), sizes: await sizes(page) })
        if (after === before && /narrower|shorter/i.test(toasts)) refusal = toasts
        await page.keyboard.press('Escape').catch(() => undefined)
      }
      out[direction] = { steps, refusal }
      expect.soft(refusal, `${direction}: the app refuses a split with no room, and says why`).toMatch(direction === 'right' ? /narrower than 240 px/ : /shorter than 120 px/)
      expect.soft(refusal, `${direction}: and what to do`).toMatch(/Close another pane|make the window/)
      expect.soft(Math.min(...(await sizes(page)).map(s => s[0])), `${direction}: no pane narrower than 240 px`).toBeGreaterThanOrEqual(240)
      expect.soft(Math.min(...(await sizes(page)).map(s => s[1])), `${direction}: no pane shorter than 120 px`).toBeGreaterThanOrEqual(120)
    }
  } finally {
    console.log('SPLIT310', JSON.stringify(out).slice(0, 4000))
    await quitReal(app)
  }
})
