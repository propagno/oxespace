import { _electron as electron, expect, test } from '@playwright/test'
import { mkdirSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * Safe production and SQL lint (roadmap Q5 and Q4) in the real renderer, backed by the in-memory mock
 * (electron/main/e2e/oxequery-mock.ts). The real guard, policy and limits are covered by
 * tests/integration/oxequery-safety.test.ts and tests/unit/oxequery-safety.test.ts.
 */
test('a production connection asks for its name before a write, shows its limits and marks risky SQL', async () => {
  test.setTimeout(120000)
  const root = mkdtempSync(join(tmpdir(), 'oxespace-oxequery-prod-'))
  const repo = join(root, 'repo'); mkdirSync(repo)
  const app = await electron.launch({ args: [join(process.cwd(), 'e2e/electron-main.cjs')], env: {
    ...process.env, OXESPACE_DISABLE_SINGLE_INSTANCE: '1', OXESPACE_E2E_MOCK_NATIVE: '1', OXESPACE_DB_PATH: join(root, 'app.sqlite3')
  } })
  try {
    const page = await app.firstWindow()
    await app.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows()[0].setSize(1180, 800) })
    await page.waitForLoadState('domcontentloaded')
    await page.getByTestId('btn-new-workspace').click()
    await page.getByTestId('wizard-dir-input').fill(repo)
    await page.getByTestId('wizard-layout-card-1').click()
    await page.getByTestId('wizard-launch-btn').click()
    await page.getByRole('navigation', { name: 'Application view' }).getByRole('button', { name: 'OxeQuery' }).click()
    await page.getByRole('button', { name: 'Connect to pg-dev' }).click()
    await expect(page.getByRole('tab', { name: 'pg-dev' })).toBeVisible()

    // Mark the connection as production with writes on.
    await page.locator('.oq-sidebar').getByRole('button', { name: 'Edit pg-dev' }).click()
    const dialog = page.getByRole('dialog', { name: 'Edit connection' })
    await dialog.getByRole('radio', { name: 'Production' }).click()
    await dialog.getByRole('switch', { name: /Read-only/ }).setChecked(false)
    await dialog.getByRole('button', { name: 'Save' }).click()
    await expect(page.locator('.oq-badge[data-environment="prod"]')).toBeVisible()

    // Production reads up to 1,000 rows and gives a statement 30 seconds; the toolbar says so.
    await expect(page.locator('.oq-editor-toolbar [data-oq-timeout]')).toHaveText('30 s')
    const limits = await page.locator('.oq-editor-toolbar select.oq-select option').allTextContents()
    expect(limits.join('|')).toContain('1,000 rows')
    expect(limits.join('|')).not.toContain('5,000 rows')

    // Advice appears as editor markers while typing, and a read does not need the name.
    const editor = page.locator('.oq-editor .monaco-editor')
    await editor.click()
    await page.keyboard.press('Control+A')
    await page.keyboard.insertText('SELECT id FROM users')
    await expect(page.locator('.oq-editor .squiggly-warning').first()).toBeAttached()
    await page.getByRole('button', { name: /^Run/ }).first().click()
    await expect(page.locator('.oq-grid').getByRole('gridcell', { name: 'carol', exact: true })).toBeVisible()
    await expect(page.getByRole('dialog')).toHaveCount(0)

    // A write must have the connection's name typed; a wrong name does not open the way.
    await editor.click()
    await page.keyboard.press('Control+A')
    await page.keyboard.insertText("UPDATE users SET name = 'x' WHERE id = 1")
    await page.getByRole('button', { name: /^Run/ }).first().click()
    const confirm = page.getByRole('dialog', { name: 'Change data on production?' })
    await expect(confirm).toBeVisible()
    const runButton = confirm.getByRole('button', { name: 'Run on production' })
    await expect(runButton).toBeDisabled()
    const typed = confirm.getByLabel('Type pg-dev to continue')
    await typed.fill('pg-de')
    await expect(runButton).toBeDisabled()
    await typed.fill('PG-DEV')
    await expect(runButton).toBeDisabled()
    await typed.fill('pg-dev')
    await expect(runButton).toBeEnabled()
    await runButton.click()
    await expect(page.locator('.oq-results-bar')).toContainText('rows affected')
    await expect(confirm).toHaveCount(0)

    // A destructive statement is marked, and asks for the same name in the same dialog.
    await editor.click()
    await page.keyboard.press('Control+A')
    await page.keyboard.insertText('DELETE FROM users')
    await expect(page.locator('.oq-editor .squiggly-warning').first()).toBeAttached()
    await page.screenshot({ path: join(root, 'editor-warnings.png') })
    await page.getByRole('button', { name: /^Run/ }).first().click()
    const destructive = page.getByRole('dialog', { name: 'This statement is destructive' })
    await expect(destructive).toContainText('DELETE without WHERE')
    await expect(destructive.getByRole('button', { name: 'Run on production' })).toBeDisabled()
    await destructive.getByLabel('Type pg-dev to continue').fill('pg-dev')
    await destructive.getByRole('button', { name: 'Run on production' }).click()
    await expect(page.locator('.oq-results-bar')).toContainText('rows affected')

    // Cancelling leaves nothing behind.
    await editor.click()
    await page.keyboard.press('Control+A')
    await page.keyboard.insertText('DROP TABLE users')
    await page.getByRole('button', { name: /^Run/ }).first().click()
    const drop = page.getByRole('dialog', { name: 'This statement is destructive' })
    await drop.getByRole('button', { name: 'Cancel' }).click()
    await expect(drop).toHaveCount(0)
  } finally { await app.close() }
})
