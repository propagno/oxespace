import { test } from '@playwright/test'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { launchApp, resizeWindow } from '../helpers/launch'

/** #234 on main: the first-run checklist and the accounts panel load on demand, and Settings › Agents shows readiness. */
test('first-run checklist and Settings › Agents (pt-BR)', async () => {
  test.setTimeout(120_000)
  const OUT = join(process.cwd(), 'e2e', 'screenshots', 'homologation', 'check-234'); mkdirSync(OUT, { recursive: true })
  const { app, page, consoleErrors } = await launchApp({ locale: 'pt-BR', appearance: 'light' })
  const notes: Record<string, unknown> = {}
  try {
    await resizeWindow(app, 1280, 860)
    await page.getByTestId('btn-new-workspace').first().waitFor()
    const started = Date.now()
    notes.checklist = await page.getByText(/Antes de começar|Before you start/).first().waitFor({ timeout: 10_000 }).then(() => Date.now() - started, () => -1)
    notes.checklistText = (await page.getByText(/Antes de começar|Before you start/).first().locator('xpath=ancestor::*[self::section or self::aside or self::div][2]').innerText().catch(() => '')).slice(0, 500)
    await page.screenshot({ path: join(OUT, 'checklist.png') })
    await page.keyboard.press('Control+,')
    await page.locator('.settings-center').waitFor({ timeout: 10_000 }).catch(() => undefined)
    await page.getByRole('navigation').filter({ has: page.locator('button') }).last().getByRole('button', { name: /^(Agentes|Agents)$/ }).click()
    await page.waitForTimeout(2_000)
    notes.agents = (await page.locator('.settings-center').innerText().catch(() => '')).slice(0, 900)
    await page.screenshot({ path: join(OUT, 'settings-agents.png') })
    notes.errors = consoleErrors
  } finally { writeFileSync(join(OUT, 'notes.json'), JSON.stringify(notes, null, 2)); await app.close() }
})
