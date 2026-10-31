import { test, type Page } from '@playwright/test'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { launchApp, openDemoWorkspace, resizeWindow } from '../helpers/launch'

/**
 * Pre-homologation of F12 (#188 FRONTEND + #189 BACKEND): no visible "Code" or "Thread" as a mode name, in en and
 * pt-BR. Walks the mode switcher, each mode, the menu, the palette, the shortcuts guide and Settings, and collects
 * visible text plus accessible names and titles. Not part of CI.
 */
const OUT = join(process.cwd(), 'e2e', 'screenshots', 'homologation', 'pre-f12')
mkdirSync(OUT, { recursive: true })
const notes: Record<string, unknown> = {}
test.afterAll(() => writeFileSync(join(OUT, 'notes.json'), JSON.stringify(notes, null, 2)))

const OLD = /\b(threads?|Code)\b/i
const ALLOWED = /(Claude Code|VS Code|Visual Studio Code|thread\/\d|OxeCode|OxeChat)/g

/** Visible text, aria-labels, titles and placeholders that still name an old mode. */
async function oldNames(page: Page, where: string): Promise<string[]> {
  const found = await page.evaluate(() => {
    const out = new Set<string>()
    const visible = (el: Element) => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none' }
    for (const el of document.querySelectorAll('body *')) {
      if (!visible(el) || el.closest('.xterm, .monaco-editor')) continue
      for (const node of el.childNodes) if (node.nodeType === 3 && node.textContent?.trim()) out.add(node.textContent.trim())
      for (const attr of ['aria-label', 'title', 'placeholder']) { const v = el.getAttribute(attr); if (v) out.add(`[${attr}] ${v}`) }
    }
    return [...out]
  })
  return found.filter(text => OLD.test(text.replace(ALLOWED, ''))).map(text => `${where}: ${text.slice(0, 120)}`)
}

for (const locale of ['en-US', 'pt-BR'] as const) {
  test(`no old mode names: ${locale}`, async () => {
    test.setTimeout(240_000)
    const { app, page, workspaceRoot, consoleErrors } = await launchApp({ locale })
    const hits: string[] = []
    try {
      await resizeWindow(app, 1280, 860)
      hits.push(...await oldNames(page, 'empty start'))
      await page.screenshot({ path: join(OUT, `${locale}-start.png`) })
      await openDemoWorkspace(page, workspaceRoot)
      for (const key of ['1', '2', '3', '4', '5']) {
        await page.keyboard.press(`Control+${key}`)
        await page.waitForTimeout(1_000)
        hits.push(...await oldNames(page, `Ctrl+${key}`))
        await page.screenshot({ path: join(OUT, `${locale}-mode-${key}.png`) })
      }
      await page.keyboard.press('Control+1')
      // The app menu.
      await page.locator('header button').first().click().catch(() => undefined)
      await page.waitForTimeout(400)
      hits.push(...await oldNames(page, 'app menu'))
      await page.screenshot({ path: join(OUT, `${locale}-menu.png`) })
      await page.keyboard.press('Escape')
      // The palette, listing everything.
      await page.keyboard.press('Control+k')
      await page.waitForTimeout(500)
      const items = await page.locator('[cmdk-item]').allInnerTexts()
      notes[`${locale}-paletteCount`] = items.length
      hits.push(...items.filter(text => OLD.test(text.replace(ALLOWED, ''))).map(text => `palette: ${text.replace(/\n/g, ' · ').slice(0, 120)}`))
      await page.keyboard.press('Escape')
      // The shortcuts guide.
      await page.keyboard.press('Control+/')
      await page.waitForTimeout(500)
      hits.push(...await oldNames(page, 'shortcuts'))
      await page.screenshot({ path: join(OUT, `${locale}-shortcuts.png`) })
      await page.keyboard.press('Escape')
      // Settings, every category of both scopes.
      await page.keyboard.press('Control+,')
      await page.locator('.settings-center').waitFor({ timeout: 10_000 }).catch(() => undefined)
      const categories = page.getByRole('navigation').filter({ has: page.locator('button') }).last().getByRole('button')
      const count = await categories.count()
      for (let index = 0; index < count; index++) {
        await categories.nth(index).click().catch(() => undefined)
        await page.waitForTimeout(300)
        hits.push(...await oldNames(page, `settings #${index + 1}`))
      }
      notes[`${locale}-hits`] = [...new Set(hits)]
      notes[`${locale}-errors`] = consoleErrors
    } finally { await app.close() }
  })
}
