import { _electron as electron, expect, test, type Page } from '@playwright/test'
import { mkdirSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { connectFromContainer } from '../helpers/oxepod'

/**
 * F28 (S6, audit P1-20) · Typing in the OxeQuery editor raises no page error.
 * Roadmap acceptance: typing 200 characters in the SQL and the MongoDB workbench gives no pageerror (Monaco's
 * ClockController "reading 'duration'" on keyup); the e2e watches pageerror.
 * Drives the e2e doubles for the databases (OXESPACE_E2E_MOCK_NATIVE), with the CPU slowed like a CI runner.
 */
const SQL = ('SELECT id, name, email FROM users WHERE id > 10 AND name ILIKE ' + "'%ab%'" + ' ORDER BY id DESC LIMIT 50; ').repeat(3).slice(0, 200)
const MONGO = ('db.orders.find({ status: "paid", total: { $gt: 100 } }).sort({ createdAt: -1 }).limit(20) ').repeat(3).slice(0, 200)

async function typeIn(page: Page, text: string): Promise<void> {
  const editor = page.locator('.oq-editor .monaco-editor').locator('visible=true').first()
  await editor.click()
  await page.keyboard.press('Control+A')
  await page.keyboard.type(text, { delay: 10 })
  await page.keyboard.press('Escape')
}

for (const target of [{ container: 'pg-dev', text: SQL }, { container: 'mongo-dev', text: MONGO }]) {
  test(`F28: typing 200 characters in ${target.container} raises no page error`, async () => {
    test.setTimeout(120_000)
    const root = mkdtempSync(join(tmpdir(), 'oxe-acc-f28-'))
    const repo = join(root, 'repo'); mkdirSync(repo)
    const app = await electron.launch({ args: [join(process.cwd(), 'e2e', 'electron-main.cjs')], env: { ...process.env, OXESPACE_DISABLE_SINGLE_INSTANCE: '1', OXESPACE_E2E_MOCK_NATIVE: '1', OXESPACE_DB_PATH: join(root, 'app.sqlite3') } })
    try {
      const page = await app.firstWindow()
      const pageErrors: string[] = []
      page.on('pageerror', e => pageErrors.push(e.message))
      await page.getByTestId('btn-new-workspace').click()
      await page.getByTestId('wizard-dir-input').fill(repo)
      await page.getByTestId('wizard-layout-card-1').click()
      await page.getByTestId('wizard-launch-btn').click()
      await page.locator('button[data-app-mode="data"]').first().click()
      await connectFromContainer(page, target.container)
      const session = await page.context().newCDPSession(page)
      await session.send('Emulation.setCPUThrottlingRate', { rate: 6 })
      await typeIn(page, target.text)
      await page.waitForTimeout(1_000)
      expect(pageErrors, 'no page error while typing').toEqual([])
    } finally { await app.close() }
  })
}
