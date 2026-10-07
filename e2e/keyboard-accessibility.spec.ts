import { _electron as electron, expect, test } from '@playwright/test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

test('primary Code navigation works by keyboard and restores focus after dialogs', async () => {
  const root = mkdtempSync(join(tmpdir(), 'oxe-keyboard-'))
  const app = await electron.launch({ args: [join(process.cwd(), 'e2e/electron-main.cjs')], env: {
    ...process.env, OXESPACE_DISABLE_SINGLE_INSTANCE: '1', OXESPACE_E2E_MOCK_NATIVE: '1', OXESPACE_DB_PATH: join(root, 'db.sqlite3')
  } })
  try {
    const page = await app.firstWindow()
    await page.waitForURL(/index\.html/)
    await app.evaluate(({ BrowserWindow }) => { const window = BrowserWindow.getAllWindows()[0]; window.show(); window.focus() })
    await page.setViewportSize({ width: 900, height: 650 })
    const tools = page.getByTestId('btn-open-tools')
    await tools.focus()
    await expect(tools).toBeFocused()
    await page.keyboard.press('Enter')
    const dialog = page.getByTestId('tools-modal')
    await expect(dialog).toBeVisible()
    await expect(dialog.getByRole('searchbox', { name: 'Search tools' })).toBeFocused()
    await page.keyboard.press('Tab')
    expect(await page.evaluate(() => document.activeElement?.closest('[data-testid="tools-modal"]') !== null)).toBe(true)
    await page.keyboard.press('Escape')
    await expect(dialog).not.toBeVisible()
    await expect(tools).toBeFocused()

    const create = page.getByTestId('btn-new-workspace')
    await create.focus()
    await expect(create).toBeFocused()
    await page.keyboard.press('Enter')
    await expect(page.getByTestId('wizard-dir-input')).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.getByTestId('wizard-dir-input')).not.toBeVisible()
    await expect(create).toBeFocused()
  } finally { await app.close() }
})
