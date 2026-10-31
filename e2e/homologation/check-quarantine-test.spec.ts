import { test } from '@playwright/test'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { launchApp, openDemoWorkspace, resizeWindow } from '../helpers/launch'

/** Quarantine: accessible names of the list's buttons, and what "Test" on a quarantined server does (confirm? trust?). */
const OUT = join(process.cwd(), 'e2e', 'screenshots', 'homologation', 'quarantine')
mkdirSync(OUT, { recursive: true })
process.env.OXESPACE_E2E_MCP_FIXTURE = 'quarantine'
test('quarantine: Test button and names (pt-BR)', async () => {
  test.setTimeout(180_000)
  const notes: Record<string, unknown> = {}
  const { app, page, workspaceRoot, consoleErrors } = await launchApp({ locale: 'pt-BR', appearance: 'light' })
  try {
    await resizeWindow(app, 1280, 860)
    await openDemoWorkspace(page, workspaceRoot)
    await page.getByRole('button', { name: /Abrir os servidores MCP/ }).first().click()
    await page.getByRole('tab', { name: /Instalados/ }).first().click().catch(() => page.getByText(/^Instalados/).first().click())
    await page.waitForTimeout(800)
    const dialog = page.getByRole('dialog').last()
    notes.unnamed = await dialog.locator('button').evaluateAll(bs => bs.map(b => {
      const name = b.getAttribute('aria-label') || b.getAttribute('title') || (b.textContent ?? '').trim()
      const labelled = b.getAttribute('aria-labelledby')
      return name || labelled ? null : `${b.className.toString().slice(0, 50)} | ${b.outerHTML.slice(0, 160)}`
    }).filter(Boolean))
    const statusOf = async (server: string) => (await dialog.locator('button', { hasText: server }).first().innerText().catch(() => '')).replace(/\n/g, ' · ')
    for (const server of ['docs-search', 'deploy-helper', 'new-server']) {
      const before = await statusOf(server)
      const row = dialog.locator('button', { hasText: server }).first()
      const testBtn = row.locator('xpath=following-sibling::button[1]')
      await testBtn.click().catch(() => undefined)
      await page.waitForTimeout(900)
      const confirm = page.getByRole('dialog').filter({ hasNotText: 'Servidores MCP' }).last()
      const confirmShown = await confirm.isVisible().catch(() => false)
      const entry: Record<string, unknown> = { before, confirmShown }
      if (confirmShown) {
        entry.confirmText = (await confirm.innerText()).slice(0, 1200)
        entry.confirmButtons = await confirm.getByRole('button').allInnerTexts()
        entry.focus = await page.evaluate(() => (document.activeElement?.textContent ?? '').trim().slice(0, 40))
        await page.screenshot({ path: join(OUT, `pt-BR-03-test-${server}.png`) })
        await page.keyboard.press('Escape'); await page.waitForTimeout(400)
      } else {
        await page.screenshot({ path: join(OUT, `pt-BR-03-test-${server}.png`) })
      }
      entry.after = await statusOf(server)
      entry.toasts = await page.locator('[role="status"], [role="alert"]').allInnerTexts().catch(() => [])
      notes[server] = entry
    }
    notes.errors = consoleErrors
  } finally {
    writeFileSync(join(OUT, 'pt-BR-test.json'), JSON.stringify(notes, null, 2))
    await app.close()
  }
})
