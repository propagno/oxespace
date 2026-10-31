import { test, type Page } from '@playwright/test'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { launchApp, openDemoWorkspace, resizeWindow } from '../helpers/launch'

/**
 * #245 (F21 toasts) pre-homologation, black box, pt-BR and en: a burst of the same copy, a mix of different ones, how
 * long they stay, hover pause, reaching and closing one by keyboard, and what a screen reader is told. The toast is
 * found by what a person sees (bottom-right card with a close button), not by a library selector.
 * Output: e2e/screenshots/homologation/pre-245/
 */
const OUT = join(process.cwd(), 'e2e', 'screenshots', 'homologation', 'pre-245')
mkdirSync(OUT, { recursive: true })
const notes: Record<string, unknown> = {}
test.afterAll(() => writeFileSync(join(OUT, 'notes.json'), JSON.stringify(notes, null, 2)))

/** Visible toast cards: the elements holding a close button inside the toast region or any live region. */
const toasts = (page: Page) => page.evaluate(() => {
  const visible = (el: Element) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 }
  const regions = [...document.querySelectorAll('[aria-live], [role="status"], [role="alert"], [role="region"], ol, section')]
  const cards = new Set<Element>()
  for (const button of document.querySelectorAll('button')) {
    const label = (button.getAttribute('aria-label') ?? '').toLowerCase()
    if (!/(close|fechar|dispensar|dismiss)/.test(label) || !visible(button)) continue
    const card = button.parentElement?.closest('li, [role="status"], [role="alert"], [class*="toast" i]')
    if (card && !card.closest('[role="dialog"], [role="menu"]')) cards.add(card)
  }
  return {
    cards: [...cards].map(c => ({ text: (c.textContent ?? '').trim().slice(0, 140), role: c.getAttribute('role'), live: c.getAttribute('aria-live'), rect: (({ x, y, width, height }) => ({ x: Math.round(x), y: Math.round(y), w: Math.round(width), h: Math.round(height) }))(c.getBoundingClientRect()) })),
    liveText: regions.filter(r => r.getAttribute('aria-live')).map(r => `${r.getAttribute('aria-live')}: ${(r.textContent ?? '').trim().slice(0, 120)}`).filter(t => !t.endsWith(': '))
  }
})
const focused = (page: Page) => page.evaluate(() => { const el = document.activeElement as HTMLElement | null; return el ? `${el.tagName} ${el.getAttribute('aria-label') ?? ''} ${(el.textContent ?? '').trim().slice(0, 30)}` : null })

for (const [locale, appearance] of [['pt-BR', 'light'], ['en-US', 'dark']] as const) {
  test(`toasts: ${locale} ${appearance}`, async () => {
    test.setTimeout(240_000)
    const n: Record<string, unknown> = {}
    notes[locale] = n
    const { app, page, workspaceRoot, consoleErrors } = await launchApp({ locale, appearance })
    try {
      await resizeWindow(app, 1280, 860)
      await openDemoWorkspace(page, workspaceRoot)
      writeFileSync(join(workspaceRoot, 'a.md'), '# a\n')
      await page.keyboard.press('Control+k')
      await page.locator('[cmdk-item][data-value="cmd-tool-editor"]').click()
      const file = page.locator('.editor-browser-file', { hasText: 'a.md' })
      await file.waitFor({ timeout: 10_000 })
      await file.click({ button: 'right' })
      n.menu = await page.getByRole('menuitem').allInnerTexts()
      await page.keyboard.press('Escape')
      const copy = async (index: number) => { await file.click({ button: 'right' }); await page.getByRole('menuitem').nth(index).click(); await page.waitForTimeout(120) }

      // 1. The same copy five times.
      const started = Date.now()
      for (let i = 0; i < 5; i++) await copy(0)
      await page.waitForTimeout(300)
      n.burst = await toasts(page)
      await page.screenshot({ path: join(OUT, `${locale}-burst.png`) })
      await page.waitForTimeout(1_000)
      n.burstLive = (await toasts(page)).liveText
      let gone = -1
      for (let t = 0; t < 40; t++) { if ((await toasts(page)).cards.length === 0) { gone = Date.now() - started; break } await page.waitForTimeout(500) }
      n.lifetimeMs = gone

      // 2. Different copies in a row: how many stack, in what order.
      for (let i = 0; i < 3; i++) await copy(i % 2)
      await copy(0)
      await page.waitForTimeout(300)
      n.mixed = await toasts(page)
      await page.screenshot({ path: join(OUT, `${locale}-mixed.png`) })

      // 3. Hover keeps them: hover the first card for 13 s.
      const card = page.locator('button[aria-label]').filter({ hasText: '' }).locator('xpath=..')
      const first = (await toasts(page)).cards[0]
      if (first) {
        await page.mouse.move(first.rect.x + first.rect.w / 2, first.rect.y + first.rect.h / 2)
        await page.waitForTimeout(13_000)
        n.afterHover13s = (await toasts(page)).cards.length
        await page.mouse.move(10, 400)
      }
      void card

      // 4. Keyboard: focus stays where it was when a toast appears; can Tab / F6 reach the close button; Escape.
      await page.waitForTimeout(13_000)
      await file.click()
      const before = await focused(page)
      await copy(0)
      await file.focus().catch(() => undefined)
      n.focusAfterToast = { before, after: await focused(page) }
      const reached: string[] = []
      for (let i = 0; i < 60; i++) {
        await page.keyboard.press('Tab')
        const f = await focused(page)
        if (f && /(close|fechar|dispensar|dismiss)/i.test(f)) { reached.push(`Tab x${i + 1}: ${f}`); break }
      }
      if (!reached.length) for (const key of ['F6', 'F8', 'Alt+T']) { await page.keyboard.press(key); const f = await focused(page); reached.push(`${key}: ${f}`) }
      n.keyboardReach = reached
      const beforeEsc = (await toasts(page)).cards.length
      await page.keyboard.press('Escape')
      await page.waitForTimeout(400)
      n.escape = { before: beforeEsc, after: (await toasts(page)).cards.length, focus: await focused(page), html: await page.evaluate(() => document.activeElement?.outerHTML.slice(0, 400)), parent: await page.evaluate(() => document.activeElement?.parentElement?.outerHTML.slice(0, 300)) }
      // Escape in the editor with a toast up: does it eat the editor's Escape?
      await copy(0)
      await page.locator('.monaco-editor, textarea, [contenteditable="true"]').first().click().catch(() => undefined)
      await page.keyboard.press('Escape')
      await page.waitForTimeout(300)
      n.escapeFromEditor = (await toasts(page)).cards.length
      await page.screenshot({ path: join(OUT, `${locale}-end.png`) })
      n.errors = consoleErrors
    } finally { await app.close() }
  })
}
