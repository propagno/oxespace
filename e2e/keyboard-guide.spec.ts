import { _electron as electron, expect, test } from '@playwright/test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

test('the shortcut guide lists the registry and Settings › Keyboard rebinds a shortcut', async () => {
  test.setTimeout(60_000)
  const root = mkdtempSync(join(tmpdir(), 'oxe-keyboard-guide-'))
  const app = await electron.launch({ args: [join(process.cwd(), 'e2e/electron-main.cjs')], env: {
    ...process.env, OXESPACE_DISABLE_SINGLE_INSTANCE: '1', OXESPACE_E2E_MOCK_NATIVE: '1', OXESPACE_DB_PATH: join(root, 'db.sqlite3')
  } })
  try {
    const page = await app.firstWindow()
    await page.waitForURL(/index\.html/)
    await app.evaluate(({ BrowserWindow }) => { const window = BrowserWindow.getAllWindows()[0]; window.show(); window.focus() })
    await page.getByTestId('btn-new-workspace').waitFor({ state: 'visible' })

    // ? outside a text field opens the guide for the current screen.
    await page.locator('body').click({ position: { x: 5, y: 300 } })
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
    await page.keyboard.press('Shift+Slash')
    const guide = page.getByTestId('shortcut-guide')
    await expect(guide).toBeVisible()
    await expect(guide.getByText('Open command palette')).toBeVisible()
    await expect(guide.getByText('Split pane right')).toBeVisible()
    await expect(guide.getByText('Next conversation')).toHaveCount(0)
    await page.screenshot({ path: 'test-results/shortcut-guide.png' })

    // Customize goes to Settings › Keyboard; rebind the sidebar to Ctrl+Alt+B.
    await guide.getByRole('button', { name: 'Customize shortcuts' }).click()
    const keyboard = page.getByTestId('keyboard-settings')
    await expect(keyboard).toBeVisible()
    await keyboard.getByRole('button', { name: 'Change shortcut for Toggle sidebar' }).click()
    await page.keyboard.press('Control+Alt+b')
    await expect(keyboard.locator('[data-keybinding="sidebar.toggle"]')).toContainText('Alt')
    await page.screenshot({ path: 'test-results/keyboard-settings.png' })
    await page.keyboard.press('Escape')
    await expect(keyboard).toBeHidden()

    // The old chord does nothing, the new one toggles the sidebar.
    await page.locator('[data-testid="btn-open-tools"]:visible').focus()
    const collapsed = await page.locator('.sidebar.sidebar-collapsed').count()
    await page.keyboard.press('Control+b')
    await page.waitForTimeout(300)
    expect(await page.locator('.sidebar.sidebar-collapsed').count()).toBe(collapsed)
    await page.keyboard.press('Control+Alt+b')
    await expect.poll(() => page.locator('.sidebar.sidebar-collapsed').count()).not.toBe(collapsed)
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('oxe-settings') ?? '{}').state?.keybindingOverrides)).toEqual({ 'sidebar.toggle': ['Mod+Alt+B'] })
  } finally {
    await Promise.race([app.close().catch(() => undefined), new Promise(resolve => setTimeout(resolve, 4000))])
  }
})
