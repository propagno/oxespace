import { test, type Page } from '@playwright/test'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { launchApp, openDemoWorkspace, resizeWindow } from '../helpers/launch'

/**
 * #241 follow-up: Tab from the sidebar (the terminal keeps Tab, as it should) to a GRID divider; then the keyboard's
 * contextmenu event as Chromium raises it for Shift+F10 / the menu key (synthetic key presses don't raise it): the
 * menu, where focus lands, arrows inside, Escape back to the divider. Output: e2e/screenshots/homologation/check-241/
 */
const OUT = join(process.cwd(), 'e2e', 'screenshots', 'homologation', 'check-241')
mkdirSync(OUT, { recursive: true })
const focused = (page: Page) => page.evaluate(() => { const el = document.activeElement as HTMLElement | null; return el ? `${el.tagName} role=${el.getAttribute('role')} ${el.getAttribute('aria-label') ?? (el.textContent ?? '').trim().slice(0, 30)}` : null })
const menu = (page: Page) => page.evaluate(() => [...document.querySelectorAll('[role="menu"]')].filter(m => m.getBoundingClientRect().width > 0).map(m => ({ label: m.getAttribute('aria-label'), items: [...m.querySelectorAll('[role^="menuitem"]')].map(i => (i.textContent ?? '').trim()), rect: m.getBoundingClientRect().toJSON() })))

test('grid divider: Tab reach and keyboard contextmenu (pt-BR)', async () => {
  test.setTimeout(180_000)
  const notes: Record<string, unknown> = {}
  const { app, page, workspaceRoot, consoleErrors } = await launchApp({ locale: 'pt-BR', appearance: 'dark' })
  try {
    await resizeWindow(app, 1280, 860)
    await openDemoWorkspace(page, workspaceRoot)
    await page.getByPlaceholder(/Filtrar workspaces/).focus()
    const path: string[] = []
    let reached = -1
    for (let i = 0; i < 120; i++) {
      await page.keyboard.press('Tab')
      const f = await focused(page); path.push(f ?? '')
      if (f?.includes('role=separator') && /colunas|linhas/.test(f)) { reached = i + 1; break }
    }
    notes.tab = { reached, sidebarDividerOnTheWay: path.some(p => p.includes('barra lateral')), last: path.slice(-4) }
    const divider = page.locator('[role="separator"]', { hasText: '' }).filter({ has: page.locator('xpath=self::*[contains(@aria-label, "colunas")]') }).first()
    if (reached < 0) await page.locator('[role="separator"][aria-label*="colunas"]').first().focus()
    // Chromium raises contextmenu at the focused element for Shift+F10 / the menu key.
    await page.evaluate(() => { const el = document.activeElement as HTMLElement; const r = el.getBoundingClientRect(); el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 0, clientX: r.left, clientY: r.top })) })
    await page.waitForTimeout(300)
    notes.menu = await menu(page)
    notes.focusInMenu = await focused(page)
    await page.screenshot({ path: join(OUT, 'pt-BR-grid-keyboard-menu.png') })
    await page.keyboard.press('ArrowDown'); notes.afterDown = await focused(page)
    await page.keyboard.press('ArrowDown'); notes.afterDown2 = await focused(page)
    await page.keyboard.press('Escape'); await page.waitForTimeout(200)
    notes.afterEscape = { focus: await focused(page), menuGone: (await menu(page)).length === 0 }
    // Choose an item by keyboard and see the size change.
    const before = await page.evaluate(() => document.activeElement?.getAttribute('aria-valuenow'))
    await page.evaluate(() => { const el = document.activeElement as HTMLElement; const r = el.getBoundingClientRect(); el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: r.left, clientY: r.top })) })
    await page.waitForTimeout(200)
    await page.keyboard.press('Enter'); await page.waitForTimeout(300)
    notes.enterOnFirst = { before, after: await page.locator('[role="separator"][aria-label*="colunas"]').first().getAttribute('aria-valuenow'), menuOpen: (await menu(page)).length, focus: await focused(page) }
    await page.keyboard.press('Escape')
    // Leaving a terminal by keyboard: Tab stays inside (right for a shell); is there a way out?
    await page.locator('.xterm').first().click()
    const ways: Record<string, string | null> = {}
    for (const key of ['F6', 'Control+F6', 'Shift+F6', 'Control+Tab', 'Alt+F6', 'Escape']) { await page.locator('.xterm').first().click(); await page.keyboard.press(key); await page.waitForTimeout(150); ways[key] = await focused(page) }
    notes.leaveTerminal = ways
    void divider
    notes.errors = consoleErrors
  } finally {
    writeFileSync(join(OUT, 'pt-BR-grid.json'), JSON.stringify(notes, null, 2))
    await app.close()
  }
})
