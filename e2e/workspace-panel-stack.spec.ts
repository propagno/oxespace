import { _electron as electron, expect, test } from '@playwright/test'
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

test('workspace panels remain readable when several tools are open', async () => {
  test.setTimeout(120000)
  const root = mkdtempSync(join(tmpdir(), 'oxe-panel-stack-'))
  const repo = join(root, 'repo'); mkdirSync(repo)
  const app = await electron.launch({ args: [join(process.cwd(), 'e2e/electron-main.cjs')], env: {
    ...process.env, OXESPACE_DISABLE_SINGLE_INSTANCE: '1', OXESPACE_E2E_MOCK_NATIVE: '1', OXESPACE_DB_PATH: join(root, 'db.sqlite3')
  } })
  try {
    const page = await app.firstWindow()
    await page.setViewportSize({ width: 1280, height: 800 })
    await page.getByTestId('btn-new-workspace').click()
    await page.getByTestId('wizard-dir-input').fill(repo)
    await page.getByTestId('wizard-launch-btn').click()
    await expect(page.getByTestId('terminal-pane')).toHaveCount(4)
    await page.getByTestId('terminal-pane').first().evaluate(el => el.setAttribute('data-preserved', 'yes'))
    for (const name of ['GitHub', 'Scripts', 'Web Preview', 'Background Jobs', 'Review']) {
      await page.getByTestId('btn-open-tools').click()
      await page.getByTestId('tools-modal').getByRole('menuitem', { name: new RegExp(`^${name}`) }).click()
    }
    const tabs = page.getByRole('tablist', { name: 'Open workspace panels' })
    await expect(tabs.getByRole('tab')).toHaveCount(5)
    await expect(tabs.getByRole('tab', { name: 'Review', exact: true })).toHaveAttribute('aria-selected', 'true')
    await expect(page.getByTestId('workspace-review-panel')).toBeVisible()
    await page.getByTestId('workspace-review-panel').evaluate(el => el.setAttribute('data-preserved', 'yes'))
    await page.screenshot({ path: test.info().outputPath('panel-stack.png') })
    for (const name of ['Source control', 'Scripts', 'Web preview', 'Background activity', 'Review']) {
      await tabs.getByRole('tab', { name, exact: true }).click()
      await expect(tabs.getByRole('tab', { name, exact: true })).toHaveAttribute('aria-selected', 'true')
      await expect(page.getByRole('tabpanel', { name })).toBeVisible()
      await expect(page.locator('.workspace-panel-stack-content > div:not([hidden]) .workspace-editor-panel')).toBeVisible()
      const geometry = await page.evaluate(() => ({
        panel: document.querySelector('.workspace-panel-stack')!.getBoundingClientRect().width,
        grid: document.querySelector('.workspace-surface-content [data-panel]')!.getBoundingClientRect().width,
        overflow: document.querySelector('.workspace-panel-stack')!.scrollWidth - document.querySelector('.workspace-panel-stack')!.clientWidth
      }))
      expect(geometry.panel).toBeGreaterThan(270)
      if (name === 'Background activity') expect(geometry.panel).toBeGreaterThan(330)
      expect(geometry.grid).toBeGreaterThan(450)
      expect(geometry.overflow).toBeLessThanOrEqual(1)
      await expect(page.locator('.terminal-pane[data-preserved="yes"]')).toHaveCount(1)
      await expect(page.locator('[data-testid="workspace-review-panel"][data-preserved="yes"]')).toHaveCount(1)
    }
  } finally { await app.close(); rmSync(root, { recursive: true, force: true }) }
})
