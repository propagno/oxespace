import { test, type Page } from '@playwright/test'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { launchApp, openDemoWorkspace, resizeWindow } from '../helpers/launch'

/**
 * Pre-homologation of the F1 area PRs (states through the primitives): each mode and Settings in pt-BR/dark and
 * en/light, with the loose role="alert" and hand-made "*-empty" blocks still on screen, and page errors.
 * OXESPACE_HML_TAG names the output folder. Not part of CI.
 */
const TAG = process.env.OXESPACE_HML_TAG ?? 'states'
const OUT = join(process.cwd(), 'e2e', 'screenshots', 'homologation', TAG)
mkdirSync(OUT, { recursive: true })
const notes: Record<string, unknown> = {}
test.afterAll(() => writeFileSync(join(OUT, 'notes.json'), JSON.stringify(notes, null, 2)))

const looseStates = (page: Page) => page.evaluate(() => {
  const visible = (el: Element) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 }
  const fromPrimitive = (el: Element) => !!el.closest('[data-ui-state], [class*="State_"], [class*="Notice_"], [class*="FieldError_"]')
  return {
    alerts: [...document.querySelectorAll('[role="alert"]')].filter(visible).filter(el => !fromPrimitive(el)).map(el => `${el.className} :: ${(el.textContent ?? '').trim().slice(0, 80)}`),
    handEmpty: [...document.querySelectorAll('[class*="-empty"]')].filter(visible).filter(el => !fromPrimitive(el)).map(el => `${el.className} :: ${(el.textContent ?? '').trim().slice(0, 80)}`)
  }
})

for (const [locale, appearance] of [['pt-BR', 'dark'], ['en-US', 'light']] as const) {
  test(`states in every mode: ${locale}`, async () => {
    test.setTimeout(180_000)
    const { app, page, workspaceRoot, consoleErrors } = await launchApp({ locale, appearance })
    try {
      await resizeWindow(app, 1280, 860)
      notes[`${locale}-start`] = await looseStates(page)
      await page.screenshot({ path: join(OUT, `${locale}-start.png`) })
      await openDemoWorkspace(page, workspaceRoot)
      for (const key of ['1', '2', '3', '4', '5']) {
        await page.keyboard.press(`Control+${key}`)
        await page.waitForTimeout(1_200)
        notes[`${locale}-mode-${key}`] = await looseStates(page)
        await page.screenshot({ path: join(OUT, `${locale}-mode-${key}.png`) })
      }
      await page.keyboard.press('Control+1')
      await page.keyboard.press('Control+,')
      await page.locator('.settings-center').waitFor({ timeout: 10_000 }).catch(() => undefined)
      const categories = page.getByRole('navigation').filter({ has: page.locator('button') }).last().getByRole('button')
      const count = await categories.count()
      const settings: Record<string, unknown> = {}
      for (let index = 0; index < count; index++) {
        await categories.nth(index).click().catch(() => undefined)
        await page.waitForTimeout(300)
        const label = (await categories.nth(index).innerText().catch(() => String(index))).trim()
        settings[label] = await looseStates(page)
        await page.screenshot({ path: join(OUT, `${locale}-settings-${index + 1}.png`) })
      }
      notes[`${locale}-settings`] = settings
      notes[`${locale}-pageErrors`] = consoleErrors.filter(line => line.startsWith('pageerror:'))
    } finally { await app.close() }
  })
}
