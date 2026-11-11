import { _electron as electron, expect, test } from '@playwright/test'
import { mkdtempSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runPaletteCommand } from './helpers/panels'

test('workspace settings pages (General, Projects, Policy) follow responsive settings layout', async () => {
  const root = mkdtempSync(join(tmpdir(), 'oxe-coordination-ui-'))
  const source = join(root, 'source'); mkdirSync(source)
  const app = await electron.launch({ args: [join(process.cwd(), 'e2e/electron-main.cjs')], env: {
    ...process.env, OXESPACE_DISABLE_SINGLE_INSTANCE: '1', OXESPACE_E2E_MOCK_NATIVE: '1', OXESPACE_DB_PATH: join(root, 'db.sqlite3')
  } })
  try {
    const page = await app.firstWindow()
    await page.getByTestId('btn-new-workspace').click()
    await page.getByTestId('wizard-dir-input').fill(source)
    await page.getByTestId('wizard-launch-btn').click()
    await runPaletteCommand(page, 'Workspace settings')
    const modal = page.getByRole('dialog', { name: 'Settings', exact: true })
    await expect(modal).toBeVisible()
    for (const label of ['General', 'Projects', 'Policy']) {
      await modal.getByRole('navigation', { name: 'Settings categories' }).getByRole('button', { name: new RegExp(`^${label}`) }).click()
      for (const size of [{ width: 850, height: 650 }, { width: 1280, height: 720 }, { width: 1920, height: 1080 }]) {
        await page.setViewportSize(size)
        await modal.locator('.ws-settings-main').evaluate(el => { el.scrollTop = 0 })
        expect(await modal.evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true)
      }
      await page.setViewportSize({ width: 1280, height: 720 })
    }
  } finally { await app.close() }
})
