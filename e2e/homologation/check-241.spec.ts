import { test, type Page } from '@playwright/test'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { launchApp, openDemoWorkspace, resizeWindow } from '../helpers/launch'

/**
 * #241 on main, black box (Windows): reach a pane divider by keyboard, open its menu with Shift+F10, the menu key and a
 * right click, move through it with arrows, close with Escape (focus must come back), and resize with arrows.
 * Output: e2e/screenshots/homologation/check-241/
 */
const OUT = join(process.cwd(), 'e2e', 'screenshots', 'homologation', 'check-241')
mkdirSync(OUT, { recursive: true })
const focused = (page: Page) => page.evaluate(() => { const el = document.activeElement as HTMLElement | null; return el ? `${el.tagName} role=${el.getAttribute('role')} ${el.getAttribute('aria-label') ?? ''} now=${el.getAttribute('aria-valuenow') ?? ''}` : null })
const menu = (page: Page) => page.evaluate(() => [...document.querySelectorAll('[role="menu"]')].filter(m => m.getBoundingClientRect().width > 0).map(m => ({ label: m.getAttribute('aria-label'), items: [...m.querySelectorAll('[role^="menuitem"]')].map(i => (i.textContent ?? '').trim()), focus: (document.activeElement?.textContent ?? '').trim().slice(0, 40) })))

for (const locale of ['pt-BR', 'en-US'] as const) {
  test(`divider menu by keyboard: ${locale}`, async () => {
    test.setTimeout(180_000)
    const notes: Record<string, unknown> = {}
    const { app, page, workspaceRoot, consoleErrors } = await launchApp({ locale, appearance: 'light' })
    try {
      await resizeWindow(app, 1280, 860)
      await openDemoWorkspace(page, workspaceRoot)
      const dividers = page.locator('[role="separator"]')
      notes.dividers = await dividers.evaluateAll(ds => ds.filter(d => d.getBoundingClientRect().width > 0).map(d => `${d.getAttribute('aria-label')} ${d.getAttribute('aria-orientation')} tabindex=${d.getAttribute('tabindex')} now=${d.getAttribute('aria-valuenow')}`))
      // Reach one by Tab from the first pane, as a keyboard person would.
      await page.locator('.xterm').first().click()
      let reached = -1
      for (let i = 0; i < 80; i++) { await page.keyboard.press('Tab'); if ((await focused(page))?.includes('role=separator')) { reached = i + 1; break } }
      notes.reachedByTab = reached
      if (reached < 0) await dividers.first().focus()
      const start = await focused(page)
      notes.focusedDivider = start
      for (const [name, open] of [['Shift+F10', () => page.keyboard.press('Shift+F10')], ['ContextMenu key', () => page.keyboard.press('ContextMenu')]] as const) {
        await open(); await page.waitForTimeout(300)
        const m = await menu(page)
        await page.screenshot({ path: join(OUT, `${locale}-${name.replace(/\W+/g, '_')}.png`) })
        await page.keyboard.press('ArrowDown'); await page.waitForTimeout(100)
        const afterDown = (await menu(page))[0]?.focus
        await page.keyboard.press('Escape'); await page.waitForTimeout(200)
        notes[name] = { menu: m, afterDown, focusAfterEscape: await focused(page), menuGone: (await menu(page)).length === 0 }
      }
      // Right click on the divider.
      const box = await dividers.first().boundingBox()
      if (box) { await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2, { button: 'right' }); await page.waitForTimeout(300) }
      notes.rightClick = await menu(page)
      await page.keyboard.press('Escape')
      // Resize with arrows.
      await dividers.first().focus()
      const before = await focused(page)
      for (let i = 0; i < 5; i++) await page.keyboard.press('ArrowRight')
      await page.keyboard.press('ArrowDown')
      notes.arrows = { before, after: await focused(page) }
      notes.errors = consoleErrors
    } finally {
      writeFileSync(join(OUT, `${locale}.json`), JSON.stringify(notes, null, 2))
      await app.close()
    }
  })
}
