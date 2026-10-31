import { test, type Page } from '@playwright/test'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { launchApp, openDemoWorkspace, resizeWindow } from '../helpers/launch'
import { installThreadFixtures, openThreadWithState, registerThreadProject } from '../helpers/thread-fixtures'

/**
 * #281 (F15a side chat drawer) on main, black box over the E2E mock (no live agent): Ctrl+. twice, the header menu
 * path, empty / huge / NUL text, a long log against the always-visible cost, a refusal from main (no session) and what
 * it says, Escape with a draft, and that nothing reaches the conversation (thread:send recorded). en, dark.
 * Output: e2e/screenshots/homologation/check-281/
 */
const OUT = join(process.cwd(), 'e2e', 'screenshots', 'homologation', 'check-281')
mkdirSync(OUT, { recursive: true })
const focused = (page: Page) => page.evaluate(() => { const el = document.activeElement as HTMLElement | null; return el ? `${el.tagName} ${el.getAttribute('aria-label') ?? ''} ${el.getAttribute('data-thread-composer') ? 'COMPOSER' : ''}`.trim() : null })

test('side chat drawer, adversarial (en, dark)', async () => {
  test.setTimeout(240_000)
  const notes: Record<string, unknown> = {}
  const { app, page, workspaceRoot, consoleErrors } = await launchApp({ appearance: 'dark' })
  try {
    await resizeWindow(app, 1280, 800)
    await installThreadFixtures(app, workspaceRoot)
    await openDemoWorkspace(page, workspaceRoot)
    await registerThreadProject(app, page, workspaceRoot)
    await openThreadWithState(app, page, workspaceRoot, 'conversation')
    await app.evaluate(({ ipcMain }) => {
      const g = globalThis as Record<string, unknown>; g.sends = []
      ipcMain.removeHandler('thread:send'); ipcMain.handle('thread:send', (_e, ...a: unknown[]) => { (g.sends as unknown[]).push(a) })
    })
    const composer = page.locator('[data-thread-composer="true"]').first()
    await composer.focus()
    await page.keyboard.press('Control+.'); await page.waitForTimeout(500)
    const drawer = page.getByTestId('thread-side-chat')
    notes.drawersAfterOne = await page.getByTestId('thread-side-chat').count()
    await page.keyboard.press('Control+.'); await page.waitForTimeout(400)
    notes.drawersAfterTwo = await page.getByTestId('thread-side-chat').count()
    if (!(await drawer.isVisible().catch(() => false))) { await composer.focus(); await page.keyboard.press('Control+.'); await page.waitForTimeout(500) }
    notes.drawers = await page.getByTestId('thread-side-chat').count()
    notes.drawerRole = await drawer.evaluate(e => `${e.getAttribute('role')} ${e.getAttribute('aria-label') ?? e.getAttribute('aria-labelledby') ?? ''}`).catch(() => null)
    const input = drawer.getByRole('textbox').first()
    // Empty, NUL, huge.
    await input.fill(''); await page.keyboard.press('Enter'); await page.waitForTimeout(300)
    notes.empty = (await drawer.getByTestId('thread-side-chat-log').innerText().catch(() => '')).slice(0, 200)
    await input.fill('a\u0000b'); await page.keyboard.press('Enter'); await page.waitForTimeout(500)
    notes.nul = { log: (await drawer.getByTestId('thread-side-chat-log').innerText().catch(() => '')).slice(-200), alerts: await drawer.locator('[role="alert"], [role="status"]').allInnerTexts() }
    await input.fill('x'.repeat(250_000)); await page.keyboard.press('Enter'); await page.waitForTimeout(800)
    notes.huge = { alerts: await drawer.locator('[role="alert"], [role="status"]').allInnerTexts(), inputLength: (await input.inputValue().catch(() => '')).length }
    // A long log: does the cost stay in view?
    const sideId = await drawer.getAttribute('data-side-id')
    await app.evaluate(({ BrowserWindow }, id) => {
      for (const w of BrowserWindow.getAllWindows()) {
        for (let i = 0; i < 40; i++) w.webContents.send('thread:side-event', { sideId: id, event: { type: 'message', id: `m${i}`, role: 'assistant', text: `Linha ${i} `.repeat(30) } })
        w.webContents.send('thread:side-event', { sideId: id, event: { type: 'turn-cost', usd: 0.42, inputTokens: 90000, outputTokens: 3000 } })
        w.webContents.send('thread:side-event', { sideId: id, event: { type: 'request', id: 'r1', request: { id: 'r1', kind: 'approval', title: 'Approve command', command: 'rm -rf .', state: 'pending' } } })
      }
    }, sideId)
    await page.waitForTimeout(800)
    const cost = drawer.getByTestId('thread-side-chat-cost')
    notes.cost = { text: await cost.innerText().catch(() => null), inView: await cost.evaluate(e => { const r = e.getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight && r.height > 0 }).catch(() => null) }
    notes.approvalShownInDrawer = await drawer.getByText(/rm -rf/).count()
    await page.screenshot({ path: join(OUT, 'long-log.png') })
    // Escape with a draft: does the draft survive, and where does focus go?
    await input.fill('rascunho importante')
    await page.keyboard.press('Escape'); await page.waitForTimeout(400)
    notes.afterEscape = { drawers: await page.getByTestId('thread-side-chat').count(), focus: await focused(page) }
    await page.keyboard.press('Control+.'); await page.waitForTimeout(500)
    notes.draftAfterReopen = await page.getByTestId('thread-side-chat').getByRole('textbox').first().inputValue().catch(() => null)
    await page.keyboard.press('Escape')
    // A refusal from main.
    await app.evaluate(({ ipcMain }) => { ipcMain.removeHandler('thread:side-open'); ipcMain.handle('thread:side-open', () => ({ ok: false, message: { code: 'thread.side.noSession', params: {} } })) })
    await composer.focus(); await page.keyboard.press('Control+.'); await page.waitForTimeout(600)
    notes.refusal = { drawer: await page.getByTestId('thread-side-chat').count(), text: (await page.getByTestId('thread-side-chat').innerText().catch(() => '')).slice(0, 300), alerts: await page.locator('[role="alert"], [data-sonner-toast], [role="status"]').allInnerTexts() }
    await page.screenshot({ path: join(OUT, 'refusal.png') })
    notes.sendsToConversation = await app.evaluate(() => ((globalThis as Record<string, unknown>).sends as unknown[]).length)
    notes.errors = consoleErrors
  } finally {
    writeFileSync(join(OUT, 'notes.json'), JSON.stringify(notes, null, 2))
    await app.close()
  }
})
