import { _electron as electron, expect, test } from '@playwright/test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

test('the palette ranks commands, shows shortcuts and remembers recent commands', async () => {
  test.setTimeout(60_000)
  const root = mkdtempSync(join(tmpdir(), 'oxe-palette-'))
  const app = await electron.launch({ args: [join(process.cwd(), 'e2e/electron-main.cjs')], env: {
    ...process.env, OXESPACE_DISABLE_SINGLE_INSTANCE: '1', OXESPACE_E2E_MOCK_NATIVE: '1', OXESPACE_DB_PATH: join(root, 'db.sqlite3')
  } })
  try {
    const page = await app.firstWindow()
    await page.waitForURL(/index\.html/)
    await app.evaluate(({ BrowserWindow }) => { const window = BrowserWindow.getAllWindows()[0]; window.show(); window.focus() })
    await page.getByTestId('btn-new-workspace').waitFor({ state: 'visible' })
    const input = page.locator('input[placeholder="Search files and commands…"]')
    const open = async (): Promise<void> => {
      await page.locator('[data-testid="btn-open-tools"]:visible').focus()
      await page.keyboard.press('Control+k')
      await expect(input).toBeVisible()
    }

    await open()
    await expect(page.locator('[cmdk-group-heading]', { hasText: 'Recent' })).toHaveCount(0)
    await input.fill('sidebar')
    const sidebar = page.getByRole('option', { name: /Toggle sidebar/ })
    await expect(sidebar).toBeVisible()
    await expect(sidebar.getByLabel('Ctrl+B')).toBeVisible()

    // Settings pages, Keyboard included, are commands.
    await input.fill('keyboard')
    const options = page.getByRole('option')
    await expect(options.first()).toContainText('Keyboard')
    await input.fill('toggle')
    await page.waitForTimeout(500)
    await page.screenshot({ path: 'test-results/command-palette-keyboard.png' })
    await input.fill('keyboard')
    await page.getByRole('option', { name: /Settings: Open keyboard settings/ }).click()
    await expect(page.getByTestId('keyboard-settings')).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.getByTestId('keyboard-settings')).toBeHidden()

    // With an empty query, the command just run leads the Recent group, and survives a reload.
    await page.reload()
    await page.getByTestId('btn-new-workspace').waitFor({ state: 'visible' })
    await open()
    const recent = page.locator('[cmdk-group]', { has: page.locator('[cmdk-group-heading]', { hasText: 'Recent' }) })
    await expect(recent.getByRole('option').first()).toContainText('Settings: Open keyboard settings')
  } finally {
    await Promise.race([app.close().catch(() => undefined), new Promise(resolve => setTimeout(resolve, 4000))])
  }
})
