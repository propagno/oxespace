import { _electron as electron, expect, test } from '@playwright/test'
import { mkdtempSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runPaletteCommand } from './helpers/panels'

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
    await runPaletteCommand(page, 'Open workspace settings')
    const modal = page.getByRole('dialog', { name: 'Settings', exact: true })
    await expect(modal).toBeVisible()
    for (const width of [1360, 600]) {
      await page.setViewportSize({ width, height: 900 })
      for (const label of ['Appearance', 'Terminal', 'Project memory', 'Agent delegation']) {
        if (width < 900) {
          const category = modal.getByRole('group', { name: 'Settings category' }).getByRole('button', { name: label, exact: true })
          await category.click()
          await expect(category).toHaveAttribute('aria-pressed', 'true')
        } else {
          const category = modal.getByRole('navigation', { name: 'Settings categories' }).getByRole('button', { name: new RegExp(`^${label}`) })
          await category.click()
          await expect(category).toHaveAttribute('aria-current', 'page')
        }
        expect(await modal.evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true)
        expect(await modal.locator('.ws-settings-main').evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true)
        expect(await modal.locator('.ws-settings-main').evaluate(el => el.scrollTop)).toBe(0)
        if (label === 'Appearance') await expect(modal.getByRole('radiogroup', { name: 'Appearance' })).toBeVisible()
        await modal.screenshot({ path: info.outputPath(`${width}-${label.split(' ')[0]}.png`) })
        if (width === 1360 && label === 'Appearance') {
          // Light and dark mode apply app-wide and immediately; no workspace save is needed.
          await modal.getByRole('radio', { name: /^Dark/ }).click()
          await expect(page.locator('html')).toHaveAttribute('data-mode', 'dark')
        }
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
          await modal.getByRole('button', { name: 'Discard changes', exact: true }).click()
        }
        await modal.locator('.ws-settings-main').evaluate(el => { el.scrollTop = el.scrollHeight })
      }
    }
    await page.keyboard.press('Escape')
    await expect(modal).not.toBeVisible()
    await page.setViewportSize({ width: 1360, height: 900 })
    await expect(page.locator('html')).toHaveAttribute('data-mode', 'dark')
    await page.screenshot({ path: info.outputPath('1360-Code-Dark.png') })
    await page.setViewportSize({ width: 600, height: 600 })
    expect(await page.locator('body').evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true)
    expect((await page.locator('.app-shell').boundingBox())!.width).toBeLessThanOrEqual(600)
    await expect(page.getByTestId('terminal-pane')).toHaveCount(4)
    await expect(page.locator('.split-pane-slot[data-compact-active]')).toHaveCount(1)
    await expect(page.locator('.split-pane-slot[data-compact-active]').getByTestId('terminal-pane')).toBeVisible()
    await expect(page.locator('.workspace-topbar-breadcrumb')).toBeHidden()
    await expect(page.locator('.app-statusbar')).toBeVisible()
    const initialPaneId = await page.locator('.split-pane-slot[data-compact-active]').getByTestId('terminal-pane').getAttribute('data-pane-id')
    await page.locator('.sidebar').getByText('terminal 2', { exact: true }).click()
    await expect.poll(() => page.locator('.split-pane-slot[data-compact-active]').getByTestId('terminal-pane').getAttribute('data-pane-id')).not.toBe(initialPaneId)
    await expect(page.locator('.split-pane-slot[data-compact-active]').getByTestId('terminal-pane')).toBeVisible()
    await page.screenshot({ path: info.outputPath('600-Code-Dark.png') })
    await page.setViewportSize({ width: 1360, height: 900 })
    await runPaletteCommand(page, 'Open workspace settings')
    await modal.getByRole('navigation', { name: 'Settings categories' }).getByRole('button', { name: /^Appearance/ }).click()
    await modal.getByRole('radio', { name: /^Light/ }).click()
    await page.keyboard.press('Escape')
    await expect(page.locator('html')).toHaveAttribute('data-mode', 'light')
    await page.screenshot({ path: info.outputPath('1360-Code-Light.png') })
  } finally { await app.close() }
})
