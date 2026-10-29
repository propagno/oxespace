import { _electron as electron, expect, test } from '@playwright/test'
import { mkdirSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

test('the workspace list is one tab stop and moves with arrows and j/k', async () => {
  test.setTimeout(60_000)
  const root = mkdtempSync(join(tmpdir(), 'oxe-list-keyboard-'))
  const app = await electron.launch({ args: [join(process.cwd(), 'e2e/electron-main.cjs')], env: {
    ...process.env, OXESPACE_DISABLE_SINGLE_INSTANCE: '1', OXESPACE_E2E_MOCK_NATIVE: '1', OXESPACE_DB_PATH: join(root, 'db.sqlite3')
  } })
  try {
    const page = await app.firstWindow()
    await page.waitForURL(/index\.html/)
    await app.evaluate(({ BrowserWindow }) => { const window = BrowserWindow.getAllWindows()[0]; window.show(); window.focus() })
    for (const name of ['alpha', 'beta']) {
      const dir = join(root, name)
      mkdirSync(dir, { recursive: true })
      await page.getByTestId('btn-new-workspace').first().click()
      await page.getByTestId('wizard-dir-input').fill(dir)
      await page.getByTestId('wizard-layout-card-1').click()
      await page.getByTestId('wizard-launch-btn').click()
      await page.getByTestId('terminal-view').first().waitFor({ state: 'visible' })
    }
    const list = page.getByRole('navigation', { name: 'Workspaces' })
    const items = list.locator('[data-list-item]')
    await expect.poll(() => list.locator('[data-list-item][tabindex="0"]').count()).toBe(1)
    await expect(list.locator('[data-list-action][tabindex="0"]')).toHaveCount(0)

    await list.locator('[data-list-item][tabindex="0"]').focus()
    await page.keyboard.press('Home')
    await expect(items.first()).toBeFocused()
    await page.keyboard.press('j')
    await expect(items.nth(1)).toBeFocused()
    await page.keyboard.press('ArrowUp')
    await expect(items.first()).toBeFocused()
    await page.keyboard.press('End')
    await expect(items.last()).toBeFocused()
    // Right reaches the row's own controls without making them tab stops.
    await page.keyboard.press('Home')
    await page.keyboard.press('ArrowRight')
    expect(await page.evaluate(() => document.activeElement?.hasAttribute('data-list-action'))).toBe(true)
  } finally {
    await Promise.race([app.close().catch(() => undefined), new Promise(resolve => setTimeout(resolve, 4000))])
  }
})
