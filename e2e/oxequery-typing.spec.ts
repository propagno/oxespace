import { _electron as electron, expect, test } from '@playwright/test'
import { mkdirSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

test('typing in the SQL editor keeps every character', async () => {
  test.setTimeout(90000)
  const root = mkdtempSync(join(tmpdir(), 'oxespace-typing-'))
  const repo = join(root, 'repo'); mkdirSync(repo)
  const app = await electron.launch({ args: [join(process.cwd(), 'e2e/electron-main.cjs')], env: { ...process.env, OXESPACE_DISABLE_SINGLE_INSTANCE: '1', OXESPACE_E2E_MOCK_NATIVE: '1', OXESPACE_DB_PATH: join(root, 'app.sqlite3') } })
  try {
    const page = await app.firstWindow()
    await page.waitForLoadState('domcontentloaded')
    await page.getByTestId('btn-new-workspace').click()
    await page.getByTestId('wizard-dir-input').fill(repo)
    await page.getByTestId('wizard-layout-card-1').click()
    await page.getByTestId('wizard-launch-btn').click()
    await page.getByRole('navigation', { name: 'Application view' }).getByRole('button', { name: 'OxeQuery' }).click()
    await page.getByRole('button', { name: 'Connect to pg-dev' }).click()
    await expect(page.getByRole('tab', { name: 'pg-dev' })).toBeVisible()
    const text = 'SELECT id, name FROM users WHERE id = 1 AND name LIKE ' + "'a%'" + ' ORDER BY id'
    for (let round = 0; round < 3; round++) {
      await page.locator('.oq-editor .monaco-editor').click()
      await page.keyboard.press('Control+A')
      await page.keyboard.type(text, { delay: 15 })
      await page.keyboard.press('Escape')
      const value = await page.evaluate(() => (document.querySelector('.oq-editor .view-lines') as HTMLElement).innerText.replace(/ /g, ' '))
      expect(value.trim()).toBe(text)
    }
  } finally { await app.close() }
})
