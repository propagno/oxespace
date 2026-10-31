import { test, type Page } from '@playwright/test'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { launchApp, openDemoWorkspace, resizeWindow } from '../helpers/launch'
import { installThreadFixtures, openThreadWithState, registerThreadProject } from '../helpers/thread-fixtures'

/**
 * #292 (F27) on main, black box: dialogs opened from a conversation row's ⋯ menu (rename, archive, delete) keep focus
 * inside for 40 Tabs and Shift+Tabs, make the rest of the window inert, and give focus back to the row on Escape.
 * en, light. Output: e2e/screenshots/homologation/check-292/
 */
const OUT = join(process.cwd(), 'e2e', 'screenshots', 'homologation', 'check-292')
mkdirSync(OUT, { recursive: true })
const where = (page: Page) => page.evaluate(() => { const el = document.activeElement as HTMLElement | null; const d = el?.closest('[role="dialog"], [role="alertdialog"]'); return { inDialog: !!d, el: `${el?.tagName} ${el?.getAttribute('aria-label') ?? (el?.textContent ?? '').trim().slice(0, 20)}` } })

test('dialogs from a row menu keep focus (en)', async () => {
  test.setTimeout(180_000)
  const notes: Record<string, unknown> = {}
  const { app, page, workspaceRoot, consoleErrors } = await launchApp({ appearance: 'light' })
  try {
    await resizeWindow(app, 1280, 860)
    await installThreadFixtures(app, workspaceRoot)
    await openDemoWorkspace(page, workspaceRoot)
    await registerThreadProject(app, page, workspaceRoot)
    await openThreadWithState(app, page, workspaceRoot, 'conversation')
    for (const action of ['Rename conversation…', 'Archive conversation', 'Delete conversation']) {
      const actions = page.locator('.thread-navigation').getByRole('button', { name: 'Actions for Authentication flow' }).first()
      await actions.focus(); await page.keyboard.press('Enter'); await page.waitForTimeout(300)
      await page.getByRole('menuitem', { name: action }).click().catch(() => undefined)
      await page.waitForTimeout(400)
      const opened = await page.getByRole('dialog').or(page.getByRole('alertdialog')).count()
      if (!opened) { notes[action] = { opened: 0, menu: await page.getByRole('menuitem').allInnerTexts().catch(() => []) }; await page.keyboard.press('Escape'); continue }
      const escaped: string[] = []
      for (let i = 0; i < 40; i++) { await page.keyboard.press(i % 2 ? 'Shift+Tab' : 'Tab'); const w = await where(page); if (!w.inDialog) escaped.push(`${i}:${w.el}`) }
      const inert = await page.evaluate(() => { const d = document.querySelector('[role="dialog"], [role="alertdialog"]'); const side = document.querySelector('.thread-navigation'); return { sidebarInert: !!side?.closest('[inert]') || side?.hasAttribute('inert') || false, ariaHiddenSiblings: [...document.body.children].filter(c => c !== d && !c.contains(d) && (c.getAttribute('aria-hidden') === 'true' || c.hasAttribute('inert'))).length } })
      await page.screenshot({ path: join(OUT, `${action.replace(/\W+/g, '_')}.png`) })
      await page.keyboard.press('Escape'); await page.waitForTimeout(300)
      notes[action] = { escapedFocus: escaped.slice(0, 5), escapedCount: escaped.length, inert, focusAfterEscape: (await where(page)).el }
    }
    notes.errors = consoleErrors
  } finally {
    writeFileSync(join(OUT, 'notes.json'), JSON.stringify(notes, null, 2))
    await app.close()
  }
})
