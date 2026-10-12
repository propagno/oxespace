import { _electron as electron, expect, test } from '@playwright/test'
import { mkdtempSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * The OxeQuery mode in the real renderer, backed by the in-memory mock in
 * electron/main/e2e/oxequery-mock.ts. Database behaviour against real engines is
 * covered by tests/live/oxequery-live.test.ts.
 */
test('OxeQuery lists containers, runs commands and queries PostgreSQL and MongoDB', async () => {
  test.setTimeout(120000)
  const root = mkdtempSync(join(tmpdir(), 'oxespace-oxequery-'))
  const repo = join(root, 'repo'); mkdirSync(repo)
  const app = await electron.launch({ args: [join(process.cwd(), 'e2e/electron-main.cjs')], env: {
    ...process.env, OXESPACE_DISABLE_SINGLE_INSTANCE: '1', OXESPACE_E2E_MOCK_NATIVE: '1', OXESPACE_DB_PATH: join(root, 'app.sqlite3')
  } })
  try {
    const page = await app.firstWindow()
    await page.waitForLoadState('domcontentloaded')
    await page.getByTestId('btn-new-workspace').click()
    await page.getByTestId('wizard-dir-input').fill(repo)
    await page.getByTestId('wizard-layout-card-1').click()
    await page.getByTestId('wizard-launch-btn').click()
    await expect(page.locator('[data-testid="workspace-grid"], [data-testid="workspace-split-grid"]').first()).toBeVisible()

    // The mode is reachable from the Code rail and costs nothing until opened.
    expect(await page.locator('.oq-view').count()).toBe(0)
    await page.getByRole('navigation', { name: 'Application view' }).getByRole('button', { name: 'OxeQuery' }).click()
    await expect(page.locator('.workbench-titlebar-context')).toContainText('OxeQuery')

    // Containers
    const list = page.getByRole('table', { name: 'Container list' })
    await expect(list.getByRole('button', { name: 'pg-dev', exact: true })).toBeVisible()
    await expect(list.getByRole('row', { name: /pg-dev/ })).toContainText('running')
    await expect(list.getByRole('row', { name: /old-job/ })).toContainText('exited')
    await expect(list.getByRole('row', { name: /pg-dev/ })).toContainText('5432→5432')
    await page.getByRole('checkbox', { name: 'Running only' }).check()
    await expect(list.getByRole('row', { name: /old-job/ })).toHaveCount(0)
    await page.getByRole('checkbox', { name: 'Running only' }).uncheck()
    await page.getByRole('searchbox', { name: 'Filter containers' }).fill('mongo')
    await expect(list.getByRole('row', { name: /pg-dev/ })).toHaveCount(0)
    await page.getByRole('searchbox', { name: 'Filter containers' }).fill('')

    await page.getByRole('button', { name: 'Stop pg-dev' }).click()
    await expect(list.getByRole('row', { name: /pg-dev/ })).toContainText('exited')
    await page.getByRole('button', { name: 'Start pg-dev' }).click()
    await expect(list.getByRole('row', { name: /pg-dev/ })).toContainText('running')

    await list.getByRole('button', { name: 'pg-dev', exact: true }).click()
    const details = page.getByRole('complementary', { name: 'pg-dev details' })
    await expect(details).toContainText('postgres:16')
    await expect(details).toContainText('POSTGRES_PASSWORD')
    await details.getByRole('button', { name: 'Logs' }).click()
    await expect(details.getByLabel('Container logs')).toContainText('ready to accept connections')
    await details.getByRole('button', { name: 'Run command' }).click()
    await details.getByLabel('Command').fill('ls -la')
    await details.getByRole('button', { name: 'Run', exact: true }).click()
    await expect(details.getByLabel('Command output')).toContainText('hello from c1')
    await details.getByRole('button', { name: 'Close details' }).click()

    // PostgreSQL from the container
    await page.getByRole('button', { name: 'Connect to pg-dev' }).click()
    await expect(page.getByRole('tab', { name: 'pg-dev' })).toBeVisible()
    await expect(page.locator('.oq-sidebar').getByRole('button', { name: 'pg-dev', exact: true })).toBeVisible()
    const tree = page.getByRole('navigation', { name: 'Schema' })
    await expect(tree.getByRole('button', { name: 'users', exact: true })).toBeVisible()
    await tree.getByRole('button', { name: 'users', exact: true }).click()
    const grid = page.locator('.oq-grid')
    await expect(grid.getByRole('cell', { name: 'alice', exact: true })).toBeVisible()
    await expect(grid.getByRole('cell', { name: 'NULL', exact: true })).toBeVisible()
    await expect(page.locator('.oq-results-bar')).toContainText('public.users')

    // The editor runs SQL; a destructive statement needs an explicit confirmation.
    await page.locator('.oq-editor .monaco-editor').click()
    await page.keyboard.press('Control+A')
    await page.keyboard.type('SELECT * FROM users')
    await page.getByRole('button', { name: /^Run/ }).first().click()
    await expect(grid.getByRole('cell', { name: 'carol', exact: true })).toBeVisible()
    await expect(page.locator('.oq-badge[data-readonly="true"]')).toBeVisible()

    await page.locator('.oq-editor .monaco-editor').click()
    await page.keyboard.press('Control+A')
    await page.keyboard.type('DELETE FROM users')
    await page.getByRole('button', { name: /^Run/ }).first().click()
    // Read-only connection: the statement is refused before it can be confirmed.
    await expect(page.getByRole('alert').filter({ hasText: 'read-only' })).toBeVisible()

    // Allow writes, then the destructive guard asks first.
    await page.locator('.oq-sidebar').getByRole('button', { name: 'Edit pg-dev' }).click()
    const dialog = page.getByRole('dialog', { name: 'Edit connection' })
    await dialog.getByRole('checkbox', { name: /Read-only/ }).uncheck()
    await dialog.getByRole('button', { name: 'Save' }).click()
    await expect(page.locator('.oq-badge[data-readonly="false"]')).toBeVisible()
    await page.locator('.oq-editor .monaco-editor').click()
    await page.keyboard.press('Control+A')
    await page.keyboard.type('DELETE FROM users')
    await page.getByRole('button', { name: /^Run/ }).first().click()
    const confirm = page.getByRole('alertdialog', { name: 'Confirm statement' })
    await expect(confirm).toContainText('WHERE')
    await confirm.getByRole('button', { name: 'Run anyway' }).click()
    await expect(page.locator('.oq-results-bar')).toContainText('3 rows affected')

    // MongoDB from its container
    await page.getByRole('tab', { name: 'Containers' }).click()
    await page.getByRole('button', { name: 'Connect to mongo-dev' }).click()
    await expect(page.getByRole('tab', { name: 'mongo-dev' })).toBeVisible()
    await page.getByRole('navigation', { name: 'Databases' }).getByRole('button', { name: 'shop' }).click()
    await page.getByRole('navigation', { name: 'Databases' }).getByRole('button', { name: 'items', exact: true }).click()
    await expect(page.getByText('_id: 507f1f77bcf86cd799439011')).toBeVisible()
    await expect(page.locator('.oq-documents')).toContainText('sku-2')
    await page.getByRole('button', { name: 'Aggregate' }).click()
    await page.getByRole('button', { name: /^Run/ }).first().click()
    await expect(page.locator('.oq-documents')).toContainText('"n": 60')

    // Leaving and returning keeps the open connections.
    await page.getByRole('navigation', { name: 'Application view' }).getByRole('button', { name: 'Code' }).click()
    await expect(page.locator('.oq-view')).toBeHidden()
    await page.getByRole('navigation', { name: 'Application view' }).getByRole('button', { name: 'OxeQuery' }).click()
    await expect(page.getByRole('tab', { name: 'mongo-dev' })).toBeVisible()
  } finally {
    await app.close()
  }
})
