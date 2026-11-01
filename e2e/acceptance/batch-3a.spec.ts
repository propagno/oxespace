import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { launchApp, openDemoWorkspace, resizeWindow } from '../helpers/launch'
import { installThreadFixtures, openThreadWithState, registerThreadProject } from '../helpers/thread-fixtures'
import { launchReal, mode, openRepo, quitReal, realProfile } from './real-app'

/**
 * Batch 3a on main, black box.
 * - #302 renderer entry split, REAL app: a cold boot with no page error, every view opens, and the pieces that now load
 *   on demand still work the first time they are needed (the activity center's panel; a terminal link, Ctrl+click).
 * - #227 F14 conversation details, over the Thread fixture (no agent): a narrow window (drawer: Escape closes it and focus
 *   goes back), a wide one (beside the conversation, the header still usable), and data the panel must not misread
 *   (no context report, a 1M window, a report past the window, no cost).
 */
const pageErrors = (page: Page) => { const errors: string[] = []; page.on('pageerror', e => errors.push(e.message.slice(0, 200))); return errors }

test('#302 cold boot, every view, and the on-demand pieces the first time they are needed', async () => {
  test.setTimeout(180_000)
  const profile = realProfile('split', { OXESPACE_LOCALE: 'en-US' })
  const started = Date.now()
  const { app, page } = await launchReal(profile)
  const bootMs = Date.now() - started
  const errors = pageErrors(page)
  const consoleErrors: string[] = []
  page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 200)) })
  try {
    await app.evaluate(({ dialog, shell }) => {
      const g = globalThis as Record<string, unknown>; g.opened = []
      dialog.showMessageBox = (() => new Promise(() => undefined)) as typeof dialog.showMessageBox
      dialog.showMessageBoxSync = (() => 0) as typeof dialog.showMessageBoxSync
      shell.openExternal = (async (url: string) => { (g.opened as string[]).push(url) }) as typeof shell.openExternal
    })
    await openRepo(page, profile.repo)
    const views: Record<string, string> = {}
    for (const id of ['thread', 'data', 'pods', 'post', 'code'] as const) {
      await mode(page, id)
      await page.waitForTimeout(1_200)
      views[id] = (await page.locator('main').first().innerText().catch(() => '')).replace(/\s+/g, ' ').slice(0, 80)
      expect.soft(views[id].length, `the ${id} view shows something`).toBeGreaterThan(0)
    }
    // The activity center's panel is a chunk of its own now.
    await page.getByTestId('activity-bell').first().click()
    await expect.soft(page.getByTestId('activity-center'), 'the activity panel opens the first time').toBeVisible({ timeout: 10_000 })
    await page.keyboard.press('Escape')
    // A terminal link: the link checks load inside the click.
    await page.locator('[data-testid="pane-container"] .xterm').first().click()
    await page.keyboard.type('echo https://example.com/hml-302'); await page.keyboard.press('Enter')
    await page.waitForTimeout(1_500)
    const link = page.locator('.xterm-rows span, .xterm-rows div').filter({ hasText: 'https://example.com/hml-302' }).last()
    const box = await link.boundingBox()
    let linkOutcome = 'no link found'
    if (box) {
      await page.keyboard.down('Control')
      await page.mouse.move(box.x + 40, box.y + box.height / 2); await page.waitForTimeout(400)
      await page.mouse.click(box.x + 40, box.y + box.height / 2)
      await page.keyboard.up('Control')
      await page.waitForTimeout(1_500)
      const opened = await app.evaluate(() => (globalThis as Record<string, unknown>).opened as string[])
      const asked = await page.getByRole('dialog').filter({ hasText: /example\.com/ }).count()
      linkOutcome = opened.length ? `opened ${opened.join(',')}` : asked ? 'the app asks before opening' : 'nothing happened'
    }
    console.log('B302', JSON.stringify({ bootMs, views, linkOutcome, errors, consoleErrors: consoleErrors.slice(0, 5) }))
    expect.soft(linkOutcome, 'a terminal link opens or is asked about').toMatch(/opened|asks/)
    expect.soft(errors, 'no page error').toEqual([])
    expect.soft(consoleErrors.filter(e => /chunk|import|Failed to fetch|dynamically imported/i.test(e)), 'no chunk load error').toEqual([])
  } finally { await quitReal(app) }
})

async function sessionState(app: ElectronApplication, root: string, extra: Record<string, unknown>) {
  await app.evaluate((_context, { root, extra }) => {
    ;(globalThis as Record<string, (state: unknown) => void>).applyThreadState({
      status: 'idle', title: 'Details edge cases', provider: 'claude', extra,
      events: [{ type: 'message', id: 'u1', role: 'user', text: 'hello' }, { type: 'message', id: 'a1', role: 'assistant', text: `ok in ${root}` }, { type: 'completed', status: 'completed' }]
    })
  }, { root, extra })
}

for (const size of [{ name: 'narrow', width: 900, height: 700 }, { name: 'wide', width: 1680, height: 1000 }]) {
  test(`#227 conversation details, ${size.name} window: opens, closes, keeps focus, and reads odd data honestly`, async () => {
    test.setTimeout(180_000)
    const { app, page, workspaceRoot, consoleErrors } = await launchApp({ locale: 'en-US' })
    try {
      await resizeWindow(app, size.width, size.height)
      await installThreadFixtures(app, workspaceRoot)
      await openDemoWorkspace(page, workspaceRoot)
      await registerThreadProject(app, page, workspaceRoot)
      await openThreadWithState(app, page, workspaceRoot, 'conversation')
      await app.evaluate(({ ipcMain }) => { ipcMain.removeHandler('thread:context-usage'); ipcMain.handle('thread:context-usage', () => null) })
      // No context report, no cost: the panel says so, never NaN or 0 of 0.
      await sessionState(app, workspaceRoot, { model: 'claude-x' })
      const toggle = page.locator('.thread-heading').getByRole('button', { name: 'Conversation details' })
      await toggle.click()
      const panel = page.getByTestId('thread-session-panel')
      await expect(panel).toBeVisible()
      const empty = await panel.innerText()
      expect.soft(empty, 'no NaN or undefined').not.toMatch(/NaN|undefined|Infinity|null/)
      // A 1M window, then a report past the window.
      const report = (used: number, windowTokens: number) => ({ model: 'claude-x', usedTokens: used, windowTokens, percentage: Math.round(used / windowTokens * 100), autoCompactAtTokens: Math.round(windowTokens * 0.83), capturedAt: Date.now(), source: 'claude-control',
        categories: [{ name: 'Messages', tokens: used, kind: 'used' }, { name: 'Free space', tokens: Math.max(0, windowTokens - used), kind: 'free' }] })
      await sessionState(app, workspaceRoot, { model: 'claude-x', contextReport: report(250_000, 1_000_000) })
      await expect.soft(panel.getByRole('meter', { name: 'Context window' }), 'the 1M window is read').toHaveAttribute('aria-valuemax', /1000000/)
      await sessionState(app, workspaceRoot, { model: 'claude-x', contextReport: report(260_000, 200_000) })
      await page.waitForTimeout(500)
      const over = await panel.innerText()
      const meter = panel.getByRole('meter', { name: 'Context window' })
      const now = Number(await meter.getAttribute('aria-valuenow').catch(() => '0')), max = Number(await meter.getAttribute('aria-valuemax').catch(() => '0'))
      console.log('F14-DATA', JSON.stringify({ size: size.name, empty: empty.slice(0, 300), over: over.slice(0, 300), now, max }))
      expect.soft(over, 'past the window: no NaN').not.toMatch(/NaN|undefined|Infinity/)
      expect.soft(now <= max || max === 0, `the meter stays within its range (${now} of ${max})`).toBe(true)

      // Closing: Escape in a narrow window (a drawer), the toggle in a wide one. Focus goes back to the header.
      if (size.name === 'narrow') {
        await panel.getByRole('button').first().focus()
        await page.keyboard.press('Escape')
        await expect.soft(panel, 'Escape closes the drawer').toHaveCount(0, { timeout: 3_000 })
        await expect.soft(toggle, 'focus goes back to the header button').toBeFocused()
      } else {
        await expect.soft(page.locator('.thread-timeline'), 'the conversation stays beside the panel').toBeVisible()
        await toggle.click()
        await expect.soft(panel, 'the header toggle closes it').toHaveCount(0, { timeout: 3_000 })
      }
      const box = await page.locator('.thread-review-host').boundingBox().catch(() => null)
      expect.soft(!box || box.x + box.width <= size.width + 1, 'nothing off the window').toBe(true)
      expect.soft(consoleErrors.filter(line => line.startsWith('pageerror')), 'no page error').toEqual([])
    } finally { await app.close() }
  })
}
