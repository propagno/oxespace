import { _electron as electron, expect, test } from '@playwright/test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

test('Settings stays usable in short windows and renders updater states', async () => {
  test.setTimeout(90000)
  const root = mkdtempSync(join(tmpdir(), 'oxe-settings-desktop-'))
  const app = await electron.launch({ args: [join(process.cwd(), 'e2e/electron-main.cjs')], env: {
    ...process.env, OXESPACE_DISABLE_SINGLE_INSTANCE: '1', OXESPACE_E2E_MOCK_NATIVE: '1', OXESPACE_DB_PATH: join(root, 'app.sqlite3')
  } })
  try {
    const page = await app.firstWindow()
    await app.evaluate(({ ipcMain }) => {
      for (const channel of ['app:get-update-state', 'rtk:get-status', 'rtk:check-for-update']) ipcMain.removeHandler(channel)
      ipcMain.handle('app:get-update-state', () => ({ status: 'disabled', currentVersion: '0.13.0', availableVersion: null, progress: null, error: null, lastCheckedAt: null }))
      const rtk = { installed: true, version: 'v0.49.0', latestVersion: 'v0.49.0', updateAvailable: false, binDir: null, error: null, checking: false, updating: false, lastCheckedAt: Date.now() }
      ipcMain.handle('rtk:get-status', () => rtk)
      ipcMain.handle('rtk:check-for-update', async () => { await new Promise(resolve => setTimeout(resolve, 300)); return rtk })
    })
    await page.getByRole('button', { name: 'Open settings', exact: true }).click()
    const settings = page.getByRole('dialog', { name: 'Settings', exact: true })
    await expect(settings).toBeVisible()
    await settings.getByLabel('Settings scope').selectOption('application')
    const categories = [['general', 'General'], ['providers', 'Agents'], ['terminal', 'Terminal'], ['voice', 'Voice'], ['notifications', 'Notifications'], ['updates', 'Updates'], ['diagnostics', 'Diagnostics']]
    for (const width of [1440, 1280, 900, 600]) {
      await page.setViewportSize({ width, height: width === 1440 ? 900 : width === 1280 ? 720 : 600 })
      for (const [id, label] of categories) {
        if (width < 900) await settings.getByLabel('Settings category').selectOption(id)
        else await settings.getByRole('navigation', { name: 'Settings categories' }).getByRole('button', { name: new RegExp(`^${label}`) }).click()
        expect(await settings.evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true)
        const scroller = settings.locator('.settings-center-content')
        expect(await scroller.evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true)
        expect(await scroller.evaluate(el => el.scrollTop)).toBe(0)
        if (id === 'updates') {
          await expect(settings.getByTestId('btn-check-app-updates')).toBeDisabled()
          await expect(settings.getByTestId('btn-update-rtk')).toBeDisabled()
          await expect(settings.getByTestId('settings-rtk-update').getByText('Up to date', { exact: true })).toBeVisible()
        }
        await settings.screenshot({ path: test.info().outputPath(`${width}-${id}.png`) })
        await scroller.evaluate(el => { el.scrollTop = el.scrollHeight })
        const end = await scroller.evaluate(el => ({ bottom: el.getBoundingClientRect().bottom, contentBottom: el.firstElementChild!.getBoundingClientRect().bottom }))
        expect(end.contentBottom).toBeLessThanOrEqual(end.bottom + 1)
        await expect(settings.getByRole('button', { name: 'Close settings', exact: true })).toBeVisible()
        await expect(settings.getByRole('button', { name: 'Back to work', exact: true })).toBeVisible()
      }
    }
    await page.setViewportSize({ width: 1280, height: 720 })
    await page.keyboard.press('Control+f')
    await expect(settings.getByRole('searchbox', { name: 'Search settings' })).toBeFocused()
    await settings.getByRole('searchbox', { name: 'Search settings' }).fill('health')
    const nav = settings.getByRole('navigation', { name: 'Settings categories' })
    await expect(nav.getByRole('button')).toHaveCount(1)
    await expect(nav.getByRole('button', { name: /^Diagnostics/ })).toBeVisible()
    await settings.getByRole('searchbox', { name: 'Search settings' }).clear()
    await nav.getByRole('button', { name: /^Updates/ }).click()
    await page.evaluate(() => { document.documentElement.dataset.theme = 'one-dark' })
    await settings.screenshot({ path: test.info().outputPath('1280-updates-one-dark.png') })
    await app.evaluate(({ BrowserWindow }) => {
      for (const window of BrowserWindow.getAllWindows()) window.webContents.send('app:update-state', { status: 'downloading', currentVersion: '0.13.0', availableVersion: '0.14.0', progress: 42, error: null, lastCheckedAt: Date.now() })
    })
    await expect(settings.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '42')
    await settings.screenshot({ path: test.info().outputPath('1280-updates-downloading.png') })
    await app.evaluate(({ BrowserWindow }) => {
      for (const window of BrowserWindow.getAllWindows()) window.webContents.send('app:update-state', { status: 'downloaded', currentVersion: '0.13.0', availableVersion: '0.14.0', progress: 100, error: null, lastCheckedAt: Date.now() })
    })
    await expect(settings.getByTestId('btn-install-app-update')).toBeVisible()
    await settings.screenshot({ path: test.info().outputPath('1280-updates-ready.png') })
    await page.keyboard.press('Escape')
    await expect(settings).not.toBeVisible()
  } finally { await app.close() }
})
