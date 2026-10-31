import { test, type Page } from '@playwright/test'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { launchApp, openDemoWorkspace, resizeWindow } from '../helpers/launch'

/**
 * Redesign audit, part 2 (menus, palette, feedback), black box: every palette entry in en and pt-BR, then each entry
 * run once (en) with a before/after signature of the screen, to find entries that do nothing visible; and the app
 * menu's items. Not part of CI. Output: e2e/screenshots/homologation/audit-menus/notes.json
 */
const OUT = join(process.cwd(), 'e2e', 'screenshots', 'homologation', 'audit-menus')
mkdirSync(OUT, { recursive: true })
const notes: Record<string, unknown> = {}
test.afterAll(() => writeFileSync(join(OUT, 'notes.json'), JSON.stringify(notes, null, 2)))

/** What a person would notice changing: open dialogs/menus, the active view, toasts, panels, the focused control. */
const signature = (page: Page) => page.evaluate(() => {
  const visible = (el: Element) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 }
  const names = (selector: string) => [...document.querySelectorAll(selector)].filter(visible).map(el => el.getAttribute('aria-label') || (el.textContent ?? '').trim().slice(0, 40)).sort().join('|')
  return [
    names('[role="dialog"]'), names('[role="menu"]'), names('[role="status"], [role="alert"], [data-sonner-toast]'),
    names('nav[aria-label] [aria-pressed="true"]'), names('[role="tab"][aria-selected="true"]'), names('[role="separator"]'),
    document.querySelectorAll('.xterm').length, document.querySelectorAll('[class*="panel"]').length,
    document.documentElement.dataset.mode ?? '', document.body.innerText.length
  ].join('#')
})

async function paletteItems(page: Page) {
  await page.keyboard.press('Control+k')
  await page.locator('[cmdk-root]').waitFor()
  const items = await page.locator('[cmdk-item]').evaluateAll(nodes => nodes.map(node => ({
    value: node.getAttribute('data-value') ?? '',
    text: (node as HTMLElement).innerText.replace(/\s*\n\s*/g, ' · ').trim(),
    group: node.closest('[cmdk-group]')?.querySelector('[cmdk-group-heading]')?.textContent?.trim() ?? ''
  })))
  await page.keyboard.press('Escape')
  return items
}

for (const locale of ['pt-BR', 'en-US'] as const) {
  test(`palette and app menu: ${locale}`, async () => {
    test.setTimeout(600_000)
    const { app, page, workspaceRoot, consoleErrors } = await launchApp({ locale, appearance: 'light' })
    try {
      await resizeWindow(app, 1280, 860)
      await openDemoWorkspace(page, workspaceRoot)
      await page.getByTestId('btn-new-workspace').first().waitFor().catch(() => undefined)
      const items = await paletteItems(page)
      notes[`${locale}-palette`] = items
      // App menu (the ☰ button by the logo), one level and its submenus.
      await page.getByRole('button', { name: /Application menu|Menu do aplicativo|Menu/ }).first().click().catch(() => undefined)
      const menu = page.locator('[role="menu"]').first()
      if (await menu.isVisible().catch(() => false)) {
        const top = await menu.getByRole('menuitem').allInnerTexts()
        const tree: Record<string, string[]> = {}
        for (const label of top) {
          const item = menu.getByRole('menuitem', { name: label.trim(), exact: true }).first()
          await item.hover().catch(() => undefined); await item.press('ArrowRight').catch(() => undefined)
          await page.waitForTimeout(250)
          const sub = page.locator('[role="menu"]').nth(1)
          tree[label.trim()] = await sub.isVisible().catch(() => false) ? await sub.getByRole('menuitem').allInnerTexts() : []
        }
        notes[`${locale}-appMenu`] = tree
        await page.screenshot({ path: join(OUT, `${locale}-app-menu.png`) })
      }
      await page.keyboard.press('Escape'); await page.keyboard.press('Escape')

      if (locale === 'en-US') {
        const effects: Array<{ item: string; changed: boolean | string; errors: number }> = []
        notes.effects = effects
        const openPalette = async () => {
          for (let i = 0; i < 3; i++) await page.keyboard.press('Escape')
          await page.keyboard.press('Control+k')
          if (await page.locator('[cmdk-root]').waitFor({ timeout: 2_000 }).then(() => true, () => false)) return true
          await page.getByRole('button', { name: /Files & commands|Arquivos e comandos/ }).first().click().catch(() => undefined)
          return page.locator('[cmdk-root]').waitFor({ timeout: 2_000 }).then(() => true, () => false)
        }
        for (const item of items) {
          await page.keyboard.press('Control+1').catch(() => undefined)
          await page.waitForTimeout(250)
          const before = await signature(page)
          const errorsBefore = consoleErrors.length
          if (!(await openPalette())) { effects.push({ item: item.text, changed: 'palette did not open before this item', errors: 0 }); writeFileSync(join(OUT, 'notes.json'), JSON.stringify(notes, null, 2)); continue }
          await page.keyboard.insertText(item.text.split(' · ')[0])
          await page.waitForTimeout(150)
          const option = page.locator(`[cmdk-item][data-value="${item.value.replace(/"/g, '\\"')}"]`).first()
          if (!(await option.isVisible().catch(() => false))) { effects.push({ item: item.text, changed: 'not found by its own name', errors: 0 }); continue }
          await option.click()
          await page.waitForTimeout(700)
          const after = await signature(page)
          effects.push({ item: item.text, changed: after !== before, errors: consoleErrors.length - errorsBefore })
          writeFileSync(join(OUT, 'notes.json'), JSON.stringify(notes, null, 2))
        }
      }
      notes[`${locale}-errors`] = consoleErrors
    } finally { await app.close() }
  })
}
