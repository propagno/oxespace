import { _electron as electron, expect, test } from '@playwright/test'
import { mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

test('creates a workspace and starts a terminal pane', async () => {
  const testRoot = join(tmpdir(), `oxespace-e2e-${Date.now()}`)
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

    await expect(page.getByTestId('sidebar-workspace-item')).toContainText('repo')
    await expect(page.getByTestId('workspace-grid')).toBeVisible()
    // A terminal pane is mounted for the single-cell layout.
    await expect(page.getByTestId('terminal-pane').first()).toBeVisible()
  } finally {
    await electronApp.close()
  }
})
