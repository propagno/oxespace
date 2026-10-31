import { test, type Page } from '@playwright/test'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { launchApp, openDemoWorkspace, resizeWindow } from '../helpers/launch'

/**
 * MCP quarantine and protected-config screens (#237 fixture), black box, pt-BR light and en dark: find them the way a
 * person would (Settings, then whatever names MCP), open each server's review, and record what is said, where focus
 * lands, which button is the default, and whether Enter trusts by accident. Output: e2e/screenshots/homologation/quarantine/
 */
const OUT = join(process.cwd(), 'e2e', 'screenshots', 'homologation', 'quarantine')
mkdirSync(OUT, { recursive: true })
process.env.OXESPACE_E2E_MCP_FIXTURE = 'quarantine'
const focused = (page: Page) => page.evaluate(() => { const el = document.activeElement as HTMLElement | null; return el ? `${el.tagName} ${el.getAttribute('aria-label') ?? ''} ${(el.textContent ?? '').trim().slice(0, 40)}` : null })
const text = (page: Page, sel: string) => page.locator(sel).last().innerText().then(t => t.replace(/\s+\n/g, '\n').slice(0, 1800)).catch(() => '')

for (const [locale, appearance] of [['pt-BR', 'light'], ['en-US', 'dark']] as const) {
  test(`MCP quarantine screens: ${locale} ${appearance}`, async () => {
    test.setTimeout(240_000)
    const notes: Record<string, unknown> = {}
    const { app, page, workspaceRoot, consoleErrors } = await launchApp({ locale, appearance })
    try {
      await resizeWindow(app, 1280, 860)
      await openDemoWorkspace(page, workspaceRoot)
      // Is there any signal outside Settings that something needs review?
      notes.signalsOutsideSettings = await page.evaluate(() => [...document.querySelectorAll('[aria-label], [title]')].map(e => `${e.getAttribute('aria-label') ?? ''} ${e.getAttribute('title') ?? ''}`.trim()).filter(t => /mcp|quarant|revis|review|confi/i.test(t)).slice(0, 10))
      await page.screenshot({ path: join(OUT, `${locale}-00-workspace.png`) })
      await page.getByRole('button', { name: /Abrir os servidores MCP|Open MCP servers/ }).first().click()
      await page.waitForTimeout(1_000)
      const panel = page.getByRole('dialog').last()
      const where = (await panel.isVisible().catch(() => false)) ? '[role="dialog"]' : 'main'
      notes.where = where
      notes.installedTab = await page.getByRole('tab', { name: /Instalados|Installed/ }).first().innerText().catch(() => page.getByRole('button', { name: /Instalados|Installed/ }).first().innerText().catch(() => 'n/a'))
      await page.getByRole('tab', { name: /Instalados|Installed/ }).first().click().catch(() => page.getByText(/^(Instalados|Installed)/).first().click())
      await page.waitForTimeout(800)
      notes.list = await text(page, where)
      await page.screenshot({ path: join(OUT, `${locale}-01-list.png`), fullPage: true })
      for (const server of ['docs-search', 'deploy-helper', 'new-server', 'notes']) {
        const row = page.getByText(server, { exact: true }).first()
        if (!(await row.isVisible().catch(() => false))) { notes[server] = 'not visible'; continue }
        const box = row.locator('xpath=ancestor::*[.//button][1]')
        const buttons = await box.getByRole('button').allInnerTexts().catch(() => [])
        const review = box.getByRole('button', { name: /Revis|Review|Confiar|Trust|Ver|View|Detalhes|Details/i }).first()
        const opened = await review.click().then(() => true, () => false)
        await page.waitForTimeout(600)
        const dialog = page.getByRole('dialog').filter({ hasText: server }).last()
        const hasDialog = await dialog.isVisible().catch(() => false)
        const entry: Record<string, unknown> = { rowButtons: buttons, opened, hasDialog, focus: await focused(page) }
        if (hasDialog) {
          entry.dialog = (await dialog.innerText()).slice(0, 2000)
          entry.dialogButtons = await dialog.getByRole('button').allInnerTexts()
          await page.screenshot({ path: join(OUT, `${locale}-02-${server}.png`) })
          // Enter right away must not trust.
          const before = await text(page, where)
          await page.keyboard.press('Enter')
          await page.waitForTimeout(500)
          entry.afterEnter = { dialogStill: await dialog.isVisible().catch(() => false), focus: await focused(page), listChanged: before !== (await text(page, where)) }
          await page.keyboard.press('Escape'); await page.waitForTimeout(300)
          entry.afterEscape = await focused(page)
        } else {
          entry.inline = await box.innerText().catch(() => '')
          await page.screenshot({ path: join(OUT, `${locale}-02-${server}.png`) })
        }
        notes[server] = entry
      }
      notes.listAfter = await text(page, where)
      notes.errors = consoleErrors
    } finally {
      writeFileSync(join(OUT, `${locale}.json`), JSON.stringify(notes, null, 2))
      await app.close()
    }
  })
}
