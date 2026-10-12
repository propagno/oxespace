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
        if (label === 'Appearance') expect(await modal.locator('.theme-card-preview').first().evaluate(el => el.clientWidth)).toBeGreaterThan(80)
        await modal.screenshot({ path: info.outputPath(`${width}-${label.split(' ')[0]}.png`) })
        if (width === 1360 && label === 'Appearance') {
          await modal.getByRole('radio', { name: 'Nord' }).click()
          await modal.getByRole('button', { name: 'Save workspace settings' }).click()
          await expect(modal.getByRole('status')).toHaveText('Workspace settings saved')
          const saved = await page.evaluate(() => window.oxe.workspace.list())
          expect(saved.find(workspace => workspace.rootPath === repo)?.themeId).toBe('nord')
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
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'nord')
    await page.screenshot({ path: info.outputPath('1360-Code-Nord.png') })
    await page.setViewportSize({ width: 600, height: 600 })
    expect(await page.locator('body').evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true)
    expect((await page.locator('.app-shell').boundingBox())!.width).toBeLessThanOrEqual(600)
    await expect(page.getByTestId('terminal-pane')).toHaveCount(4)
    await expect(page.locator('.split-pane-slot[data-compact-active]')).toHaveCount(1)
    await expect(page.locator('.split-pane-slot[data-compact-active]').getByTestId('terminal-pane')).toBeVisible()
    await expect(page.locator('.workspace-topbar-breadcrumb')).toBeHidden()
    await expect(page.locator('.app-statusbar-item.connected')).toBeVisible()
    const initialPaneId = await page.locator('.split-pane-slot[data-compact-active]').getByTestId('terminal-pane').getAttribute('data-pane-id')
    await page.locator('.sidebar').getByText('terminal 2', { exact: true }).click()
    await expect.poll(() => page.locator('.split-pane-slot[data-compact-active]').getByTestId('terminal-pane').getAttribute('data-pane-id')).not.toBe(initialPaneId)
    await expect(page.locator('.split-pane-slot[data-compact-active]').getByTestId('terminal-pane')).toBeVisible()
    await page.screenshot({ path: info.outputPath('600-Code-Nord.png') })
    await page.setViewportSize({ width: 1360, height: 900 })
    await page.getByTestId('btn-open-tools').click()
    await page.getByTestId('tools-modal').getByRole('menuitem', { name: 'Workspace Settings', exact: true }).click()
    await modal.getByRole('navigation', { name: 'Settings categories' }).getByRole('button', { name: /^Appearance/ }).click()
    await modal.getByRole('radio', { name: 'Dracula' }).click()
    await modal.getByRole('button', { name: 'Save workspace settings' }).click()
    await page.keyboard.press('Escape')
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dracula')
    await page.screenshot({ path: info.outputPath('1360-Code-Dracula.png') })
  } finally { await app.close() }
})
