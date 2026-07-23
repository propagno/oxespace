import { _electron as electron, expect, test } from '@playwright/test'
import { mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * #4 · Linear panel opens from the command palette and shows the connect flow.
 * The mock backend reports "not connected", which is the state a fresh install
 * is in — the credential path itself is covered by the service unit tests.
 */
test('linear: panel opens from the palette and asks for an API key', async () => {
  test.setTimeout(60_000)
  const testRoot = join(tmpdir(), `oxespace-linear-${Date.now()}`)
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
    await expect(
      page.locator('[data-testid="workspace-grid"], [data-testid="workspace-split-grid"]').first()
    ).toBeVisible()

    // Blur the terminal so the palette shortcut reaches the app.
    await page.mouse.click(400, 12)
    await page.keyboard.press('Control+k')
    await page.keyboard.type('linear')
    // The workspace row is highlighted first, so click the command explicitly.
    await page.getByText('Open Linear issues').click()

    const panel = page.getByTestId('linear-panel')
    await expect(panel).toBeVisible()
    await expect(panel.getByText('Connect Linear')).toBeVisible()
    await expect(page.getByTestId('linear-api-key')).toBeVisible()
  } finally {
    await electronApp.close()
  }
})
