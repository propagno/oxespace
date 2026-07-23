import { _electron as electron, expect, test } from '@playwright/test'
import { mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * Lightweight smoke: workspace → Tools hub → Agent Settings.
 * Uses E2E mock native so it does not require node-pty/sqlite ABI.
 */
test('smoke: Tools hub and Agent Settings open from sidebar', async () => {
  const testRoot = join(tmpdir(), `oxespace-smoke-${Date.now()}`)
  const workspaceRoot = join(testRoot, 'repo')
  mkdirSync(workspaceRoot, { recursive: true })

  const electronApp = await electron.launch({
    args: [join(process.cwd(), 'e2e', 'electron-main.cjs')],
    env: {
      ...process.env,
      OXESPACE_DISABLE_SINGLE_INSTANCE: '1',
      OXESPACE_E2E_MOCK_NATIVE: '1',
      OXESPACE_DB_PATH: join(testRoot, 'oxespace.sqlite3')
    }
  })

  try {
    const page = await electronApp.firstWindow()
    await page.getByTestId('btn-new-workspace').click()
    await page.getByTestId('wizard-dir-input').fill(workspaceRoot)
    await page.getByTestId('wizard-layout-card-1').click()
    await page.getByTestId('wizard-launch-btn').click()
    // Split-tree layout is the default; F2 can toggle back to the legacy grid.
    await expect(
      page.locator('[data-testid="workspace-grid"], [data-testid="workspace-split-grid"]').first()
    ).toBeVisible()

    await page.getByTestId('btn-open-tools').click()
    await expect(page.getByTestId('tools-modal')).toBeVisible()
    await expect(page.getByTestId('tools-agent-settings')).toBeVisible()

    await page.getByTestId('tools-agent-settings').click()
    await expect(page.getByTestId('settings-modal')).toBeVisible()
    await expect(page.getByRole('heading', { name: 'AI Providers' })).toBeVisible()
    await expect(page.getByTestId('btn-discover-agents')).toBeVisible()

    await page.getByRole('button', { name: 'Diagnostics' }).click()
    await expect(page.getByRole('heading', { name: 'Diagnostics' })).toBeVisible()
    await expect(page.getByTestId('diagnostics-checks')).toContainText('Renderer sandbox')

    await page.keyboard.press('Escape')
    await page.getByTestId('btn-open-tools').click()
    await page.getByText('MCP Servers', { exact: true }).click()
    await expect(page.getByRole('dialog', { name: 'MCP servers' })).toBeVisible()
    await page.getByRole('button', { name: 'Close' }).click()

    await page.getByTestId('btn-open-tools').click()
    await page.getByText('Semantic Activity', { exact: true }).click()
    await expect(page.getByRole('dialog', { name: 'Semantic activity' })).toBeVisible()
    await expect(page.getByTestId('semantic-status-label')).toBeVisible()
  } finally {
    await electronApp.close()
  }
})
