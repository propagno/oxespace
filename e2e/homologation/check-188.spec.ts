import { test, type Page } from '@playwright/test'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { launchApp, openDemoWorkspace, resizeWindow } from '../helpers/launch'

/**
 * #188 (F12) on main, black box: the modes are OxeCode and OxeChat, and "conversa/conversation" replaces "thread",
 * everywhere a person reads them, in pt-BR and en: the mode switch, the window title, the whole palette, the app menu
 * and its submenus, every Settings page, the keyboard shortcuts list, each mode's first screen and the OxeChat sidebar.
 * Every leftover of the old names is listed with its context. Output: e2e/screenshots/homologation/check-188/
 */
const OUT = join(process.cwd(), 'e2e', 'screenshots', 'homologation', 'check-188')
mkdirSync(OUT, { recursive: true })
// Old names as a person would read them; product names that legitimately contain "Code" are not leftovers.
const OLD = /\b(Threads?|thread)\b|(?<![Oo]xe|Claude |VS |Visual Studio |Code)\bCode\b(?! workspace\b)/g
const LEGIT = /(OxeCode|Claude Code|VS Code|Visual Studio Code|exit code|status code|code block|source code|QR code)/i

const leftovers = (texts: string[]) => {
  const found: string[] = []
  for (const t of texts) {
    const clean = t.replace(LEGIT, '')
    for (const m of clean.matchAll(OLD)) found.push(`…${clean.slice(Math.max(0, (m.index ?? 0) - 40), (m.index ?? 0) + 40).replace(/\s+/g, ' ')}…`)
  }
  return [...new Set(found)]
}
const visibleText = (page: Page) => page.evaluate(() => document.body.innerText)
const labels = (page: Page) => page.evaluate(() => [...document.querySelectorAll('[aria-label],[title],[placeholder]')].map(e => `${e.getAttribute('aria-label') ?? ''} ${e.getAttribute('title') ?? ''} ${e.getAttribute('placeholder') ?? ''}`.trim()).filter(Boolean))

for (const locale of ['pt-BR', 'en-US'] as const) {
  test(`rename to OxeCode / OxeChat / conversation: ${locale}`, async () => {
    test.setTimeout(300_000)
    const notes: Record<string, unknown> = {}
    const { app, page, workspaceRoot, consoleErrors } = await launchApp({ locale, appearance: 'light' })
    const collect = async (name: string) => { notes[name] = leftovers([await visibleText(page), ...(await labels(page))]) }
    try {
      await resizeWindow(app, 1280, 860)
      await page.getByTestId('btn-new-workspace').first().waitFor()
      notes.modes = await page.locator('button[data-app-mode]').evaluateAll(bs => bs.map(b => `${b.getAttribute('data-app-mode')}=${(b.textContent ?? '').trim()}|${b.getAttribute('aria-label') ?? ''}|${b.getAttribute('title') ?? ''}`))
      notes.title = await page.title()
      await collect('00-start')
      await openDemoWorkspace(page, workspaceRoot)
      for (const mode of ['code', 'thread', 'data', 'pods', 'post']) {
        await page.locator(`button[data-app-mode="${mode}"]`).click().catch(() => undefined)
        await page.waitForTimeout(700)
        await collect(`mode-${mode}`)
        await page.screenshot({ path: join(OUT, `${locale}-mode-${mode}.png`) })
      }
      await page.locator('button[data-app-mode="code"]').click().catch(() => undefined)
      // The whole palette.
      await page.keyboard.press('Control+k'); await page.locator('[cmdk-root]').waitFor()
      const palette = await page.locator('[cmdk-item], [cmdk-group-heading]').allInnerTexts()
      notes.paletteCount = palette.length
      notes.palette = leftovers(palette)
      notes.paletteMentions = palette.filter(t => /OxeCode|OxeChat|conversa|conversation/i.test(t)).slice(0, 20)
      await page.keyboard.press('Escape')
      // App menu and submenus.
      await page.getByRole('button', { name: /Application menu|Menu do aplicativo/ }).first().click().catch(() => undefined)
      const menuTexts: string[] = []
      const menu = page.locator('[role="menu"]').first()
      if (await menu.isVisible().catch(() => false)) {
        const top = await menu.getByRole('menuitem').allInnerTexts(); menuTexts.push(...top)
        for (const label of top) { const item = menu.getByRole('menuitem', { name: label.trim(), exact: true }).first(); await item.hover().catch(() => undefined); await item.press('ArrowRight').catch(() => undefined); await page.waitForTimeout(200); const sub = page.locator('[role="menu"]').nth(1); if (await sub.isVisible().catch(() => false)) menuTexts.push(...await sub.getByRole('menuitem').allInnerTexts()) }
      }
      notes.menu = leftovers(menuTexts); notes.menuItems = menuTexts.length
      for (let i = 0; i < 3; i++) await page.keyboard.press('Escape')
      // Settings, every page.
      await page.keyboard.press('Control+,'); const settings = page.locator('.settings-center'); await settings.waitFor({ timeout: 10_000 })
      const nav = settings.locator('nav button, [class*="category"] button').locator('visible=true')
      const count = await nav.count(); const settingsTexts: string[] = []
      for (let i = 0; i < count; i++) { await nav.nth(i).click().catch(() => undefined); await page.waitForTimeout(400); settingsTexts.push(await settings.innerText().catch(() => '')) }
      notes.settingsPages = count
      notes.settings = leftovers(settingsTexts)
      for (let i = 0; i < 3; i++) await page.keyboard.press('Escape')
      // Keyboard shortcuts list.
      await page.keyboard.press('Shift+?').catch(() => undefined); await page.waitForTimeout(500)
      notes.shortcuts = leftovers([await visibleText(page)])
      await page.screenshot({ path: join(OUT, `${locale}-shortcuts.png`) })
      notes.errors = consoleErrors
    } finally {
      writeFileSync(join(OUT, `${locale}.json`), JSON.stringify(notes, null, 2))
      await app.close()
    }
  })
}
