import { expect, test, type Page } from '@playwright/test'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { launchApp, resizeWindow } from '../helpers/launch'

/**
 * Pre-homologation of #163 (F1 primitives): the States section of the design system viewer in light/dark and
 * en/pt-BR, the roles of the new primitives, and the translated palette labels. Not part of CI.
 */
const OUT = join(process.cwd(), 'e2e', 'screenshots', 'homologation', 'pre-163')
mkdirSync(OUT, { recursive: true })
const notes: Record<string, unknown> = {}
test.afterAll(() => writeFileSync(join(OUT, 'notes.json'), JSON.stringify(notes, null, 2)))

async function seed(page: Page, appearance: 'light' | 'dark') {
  await page.evaluate(a => localStorage.setItem('oxe-settings', JSON.stringify({
    state: { appearance: a, density: 'compact', motion: 'reduce', notificationsEnabled: true, visitedWorkspacesCap: 5, language: 'system', uiScale: 1, keybindingOverrides: {} },
    version: 7
  })), appearance)
  await page.reload()
  await page.waitForLoadState('load')
  // The palette's shortcut is registered on the first render, after the language catalog loads.
  await page.getByTestId('btn-new-workspace').first().waitFor()
}

for (const [mode, locale] of [['light', 'en-US'], ['dark', 'pt-BR'], ['dark', 'en-US'], ['light', 'pt-BR']] as const) {
  test(`states section: ${mode} ${locale}`, async () => {
    test.setTimeout(120_000)
    const tag = `${mode}-${locale}`
    const { app, page, consoleErrors } = await launchApp({ locale })
    try {
      await resizeWindow(app, 1280, 900)
      await seed(page, mode)
      await page.keyboard.press('Control+k')
      await expect(page.locator('[cmdk-root]')).toBeVisible()
      notes[`${tag}-palette`] = { placeholder: await page.locator('[cmdk-input]').getAttribute('placeholder'), dialog: await page.getByRole('dialog').last().getAttribute('aria-label') }
      await page.keyboard.insertText('Design System')
      await page.locator('[cmdk-item]').first().click()
      const viewer = page.getByRole('dialog').last()
      const nav = viewer.getByRole('navigation', { name: /design system|sistema/i })
      await nav.getByRole('button', { name: /^(States|Estados)$/ }).click()
      await page.waitForTimeout(500)
      const main = viewer.locator('main')
      notes[`${tag}-headings`] = await main.getByRole('heading').allInnerTexts()
      notes[`${tag}-roles`] = await main.evaluate(root => ({
        alerts: [...root.querySelectorAll('[role="alert"]')].map(e => (e.textContent ?? '').trim().slice(0, 60)),
        statuses: [...root.querySelectorAll('[role="status"]')].map(e => (e.getAttribute('aria-label') ?? e.textContent ?? '').trim().slice(0, 60))
      }))
      // Full scroll of the section, one shot per screen.
      const height = await main.evaluate(e => e.scrollHeight)
      const view = await main.evaluate(e => e.clientHeight)
      for (let y = 0, index = 1; y < height; y += view - 40, index++) {
        await main.evaluate((e, top) => { e.scrollTop = top }, y)
        await page.waitForTimeout(150)
        await main.screenshot({ path: join(OUT, `${tag}-states-${index}.png`) })
      }
      notes[`${tag}-errors`] = consoleErrors
    } finally { await app.close() }
  })
}
