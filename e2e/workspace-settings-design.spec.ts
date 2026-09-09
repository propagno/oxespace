import { _electron as electron, expect, test } from '@playwright/test'
import { mkdtempSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

test('workspace settings navigation and responsive visual review', async () => {
  const info = test.info()
  const root = mkdtempSync(join(tmpdir(), 'oxe-settings-design-'))
  const repo = join(root, 'demo-repo'); mkdirSync(repo)
  const app = await electron.launch({ args: [join(process.cwd(), 'e2e/electron-main.cjs')], env: {
    ...process.env, OXESPACE_DISABLE_SINGLE_INSTANCE: '1', OXESPACE_E2E_MOCK_NATIVE: '1', OXESPACE_DB_PATH: join(root, 'db.sqlite3')
  } })
  try {
    const page = await app.firstWindow()
    await page.getByTestId('btn-new-workspace').click()
    await page.getByTestId('wizard-dir-input').fill(repo)
    await page.getByTestId('wizard-launch-btn').click()
    await page.getByTestId('btn-open-tools').click()
    await page.getByTestId('tools-modal').getByRole('menuitem', { name: 'Workspace Settings', exact: true }).click()
    const modal = page.getByRole('dialog', { name: 'Workspace settings' })
    await expect(modal).toBeVisible()
    for (const width of [1360, 600]) {
      await page.setViewportSize({ width, height: 900 })
      for (const label of ['Appearance', 'Terminal', 'Project memory', 'Agent delegation']) {
        await modal.getByRole('button', { name: new RegExp(label) }).click()
        await expect(modal.getByRole('button', { name: new RegExp(label) })).toHaveAttribute('aria-pressed', 'true')
        expect(await modal.evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true)
        expect(await modal.locator('.ws-settings-main').evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true)
        expect(await modal.locator('.ws-settings-main').evaluate(el => el.scrollTop)).toBe(0)
        if (label === 'Appearance') expect(await modal.locator('.theme-card-preview').first().evaluate(el => el.clientWidth)).toBeGreaterThan(80)
        await modal.screenshot({ path: info.outputPath(`${width}-${label.split(' ')[0]}.png`) })
        if (label === 'Terminal') {
          await modal.getByRole('radio', { name: 'Codex', exact: true }).check()
          await modal.locator('.ws-settings-main').evaluate(el => {
            const section = el.querySelector('.default-shell-settings')!
            el.scrollTop += section.getBoundingClientRect().top - el.getBoundingClientRect().top - 16
          })
          await modal.screenshot({ path: info.outputPath(`${width}-Default-shell.png`) })
          await modal.getByRole('radio', { name: /Also update idle/ }).check()
          await expect(modal.getByRole('radio', { name: /Also update idle/ })).toBeChecked()
          await modal.locator('.ws-settings-main').evaluate(el => {
            const summary = el.querySelector('.shell-launch-summary')!
            el.scrollTop += summary.getBoundingClientRect().top - el.getBoundingClientRect().top - 16
          })
          await modal.screenshot({ path: info.outputPath(`${width}-Launch-summary.png`) })
        }
        await modal.locator('.ws-settings-main').evaluate(el => { el.scrollTop = el.scrollHeight })
      }
    }
    await page.keyboard.press('Escape')
    await expect(modal).not.toBeVisible()
  } finally { await app.close() }
})
