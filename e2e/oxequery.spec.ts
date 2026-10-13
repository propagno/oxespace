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

    // Geometry: the sidebar sits to the left of the work area, not above it.
    const sidebar = await page.locator('.oq-sidebar').boundingBox()
    const surface = await page.locator('.workspace-surface.oq-surface').boundingBox()
    expect(sidebar && surface).toBeTruthy()
    expect(surface!.x).toBeGreaterThanOrEqual(sidebar!.x + sidebar!.width)
    expect(Math.abs(surface!.y - sidebar!.y)).toBeLessThan(8)
    expect(sidebar!.height).toBeGreaterThan(300)
    await expect(page.locator('main.app-shell')).toHaveCSS('display', 'grid')

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
    await expect(page.locator('.oq-sidebar').getByRole('region', { name: 'Connections' }).getByRole('button', { name: /^pg-dev/ }).first()).toBeVisible()
    const tree = page.getByRole('navigation', { name: 'Schema' })
    await expect(tree.getByRole('button', { name: 'users', exact: true })).toBeVisible()
    await tree.getByRole('button', { name: 'users', exact: true }).click()
    const grid = page.locator('.oq-grid')
    await expect(grid.getByRole('cell', { name: 'alice', exact: true })).toBeVisible()
    await expect(grid.getByRole('cell', { name: 'NULL', exact: true })).toBeVisible()
    await expect(page.locator('.oq-results-bar')).toContainText('public.users')

    // Grid: sort by a column and inspect a row.
    await page.locator('.oq-grid-header').getByText('name', { exact: false }).first().click()
    await expect(page.locator('.oq-grid-header [aria-sort="ascending"]')).toHaveCount(1)
    await page.locator('.oq-grid-row').first().click()
    await expect(page.getByRole('complementary', { name: 'Row details' })).toContainText('alice@example.com')
    await page.getByRole('button', { name: 'Close row details' }).click()

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

test('OxeQuery explains a stopped container engine and keeps checking', async () => {
  test.setTimeout(60000)
  const root = mkdtempSync(join(tmpdir(), 'oxespace-oxequery-engine-'))
  const repo = join(root, 'repo'); mkdirSync(repo)
  const app = await electron.launch({ args: [join(process.cwd(), 'e2e/electron-main.cjs')], env: {
    ...process.env, OXESPACE_DISABLE_SINGLE_INSTANCE: '1', OXESPACE_E2E_MOCK_NATIVE: '1', OXESPACE_DB_PATH: join(root, 'app.sqlite3'), OXE_MOCK_ENGINE: 'stopped'
  } })
  try {
    const page = await app.firstWindow()
    await page.waitForLoadState('domcontentloaded')
    await page.getByTestId('btn-new-workspace').click()
    await page.getByTestId('wizard-dir-input').fill(repo)
    await page.getByTestId('wizard-layout-card-1').click()
    await page.getByTestId('wizard-launch-btn').click()
    await page.getByRole('navigation', { name: 'Application view' }).getByRole('button', { name: 'OxeQuery' }).click()
    const problem = page.getByRole('alert').filter({ hasText: 'Docker is not running' })
    await expect(problem).toBeVisible()
    await expect(problem).toContainText('Start Docker Desktop')
    await expect(problem.getByRole('button', { name: 'Check again' })).toBeEnabled()
    // Connections remain usable without an engine.
    await page.getByRole('button', { name: 'New connection' }).first().click()
    await expect(page.getByRole('dialog', { name: 'New connection' })).toBeVisible()
  } finally { await app.close() }
})

test('the connection form fills itself from a pasted connection string', async () => {
  test.setTimeout(60000)
  const root = mkdtempSync(join(tmpdir(), 'oxespace-oxequery-url-'))
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
    await page.getByRole('navigation', { name: 'Application view' }).getByRole('button', { name: 'OxeQuery' }).click()
    await page.getByRole('button', { name: 'New connection' }).first().click()
    const dialog = page.getByRole('dialog', { name: 'New connection' })
    await dialog.getByPlaceholder('postgres://user:password@localhost:5432/app').fill('mongodb://root:s3cret@db.internal:27018/shop')
    await expect(dialog.getByRole('radio', { name: /MongoDB/ })).toHaveAttribute('aria-checked', 'true')
    await expect(dialog.getByLabel('Host')).toHaveValue('db.internal')
    await expect(dialog.getByLabel('Port')).toHaveValue('27018')
    await expect(dialog.getByLabel('User')).toHaveValue('root')
    await expect(dialog.getByLabel('Name')).toHaveValue('root@db.internal/shop')
    await dialog.getByPlaceholder('postgres://user:password@localhost:5432/app').fill('mysql://x/y')
    await expect(dialog.getByRole('alert')).toContainText('Unsupported')
    // Production with writes on is called out before anything is saved.
    await dialog.getByRole('radio', { name: 'Production' }).click()
    await dialog.getByRole('checkbox', { name: /Read-only/ }).uncheck()
    await expect(dialog.getByRole('note')).toContainText('production connection with writes enabled')
  } finally { await app.close() }
})

test('a connection through an SSH tunnel asks to trust the host key, then connects', async () => {
  test.setTimeout(60000)
  const root = mkdtempSync(join(tmpdir(), 'oxespace-oxequery-ssh-'))
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
    await page.getByRole('navigation', { name: 'Application view' }).getByRole('button', { name: 'OxeQuery' }).click()
    await page.getByRole('button', { name: 'New connection' }).first().click()
    const dialog = page.getByRole('dialog', { name: 'New connection' })
    await dialog.getByLabel('Name').fill('Behind bastion')
    await dialog.getByLabel('Host', { exact: true }).fill('db.private')

    await dialog.getByRole('button', { name: /SSH tunnel/ }).click()
    await dialog.getByRole('checkbox', { name: /Connect through an SSH server/ }).check()
    await dialog.getByLabel('SSH host').fill('bastion.example.com')
    await dialog.getByLabel('SSH user').fill('deploy')
    await dialog.getByRole('button', { name: 'Choose file…' }).click()
    await expect(dialog.getByText('sshKey.pem')).toBeVisible()

    // Verified TLS needs the CA, and the form says what "require" does not do.
    await dialog.getByRole('button', { name: /Security \(TLS\)/ }).click()
    await dialog.getByLabel('Encryption').selectOption('require')
    await expect(dialog.getByRole('note').filter({ hasText: 'not authenticated' })).toBeVisible()
    await dialog.getByLabel('Encryption').selectOption('verify-full')
    await expect(dialog.getByText('CA certificate')).toBeVisible()

    await dialog.getByRole('button', { name: 'Test connection' }).click()
    const prompt = page.getByRole('alertdialog', { name: 'Trust SSH host key' })
    await expect(prompt).toContainText('bastion.example.com:22')
    await expect(prompt).toContainText('SHA256:')
    await prompt.getByRole('button', { name: /Trust this key/ }).click()
    await expect(dialog.getByRole('status')).toContainText('Connected')
    await dialog.getByRole('button', { name: 'Save and open' }).click()
    await expect(page.getByRole('tab', { name: 'Behind bastion' })).toBeVisible()
  } finally { await app.close() }
})

test('OxeQuery stages a row edit, shows the SQL, applies it, exports a table and imports a file', async () => {
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
    await page.getByRole('navigation', { name: 'Application view' }).getByRole('button', { name: 'OxeQuery' }).click()
    await page.getByRole('button', { name: 'Connect to pg-dev' }).click()
    await expect(page.getByRole('tab', { name: 'pg-dev' })).toBeVisible()
    await page.getByRole('navigation', { name: 'Schema' }).getByRole('button', { name: 'users', exact: true }).click()

    // A read-only connection explains why rows cannot be edited.
    await expect(page.getByRole('button', { name: 'Edit rows' })).toBeDisabled()
    await page.locator('.oq-sidebar').getByRole('button', { name: 'Edit pg-dev' }).click()
    const dialog = page.getByRole('dialog', { name: 'Edit connection' })
    await dialog.getByRole('checkbox', { name: /Read-only/ }).uncheck()
    await dialog.getByRole('button', { name: 'Save' }).click()
    await page.getByRole('navigation', { name: 'Schema' }).getByRole('button', { name: 'users', exact: true }).click()

    await page.getByRole('button', { name: 'Edit rows' }).click()
    await page.locator('.oq-grid-row').first().click()
    const form = page.getByRole('group', { name: 'Edit row' })
    await form.locator('label', { hasText: 'email' }).locator('input').fill('changed@example.com')
    await form.getByRole('button', { name: 'Stage update' }).click()
    await expect(page.getByText('1 pending change')).toBeVisible()
    await page.getByRole('button', { name: 'View SQL' }).click()
    await expect(page.getByLabel('SQL that will run')).toContainText('UPDATE')
    await page.getByRole('button', { name: 'Apply 1' }).click()
    await expect(page.getByLabel('Pending changes')).toHaveCount(0)

    await page.getByRole('button', { name: 'Export table' }).click()
    await page.getByRole('menuitem', { name: 'CSV' }).click()
    await expect(page.getByRole('status').filter({ hasText: 'saved to users.csv' })).toBeVisible()

    await page.locator('.oq-results-bar').getByRole('button', { name: 'Import' }).click()
    const importDialog = page.getByRole('dialog', { name: 'Import into public.users' })
    await expect(importDialog).toContainText('users.csv')
    await importDialog.getByRole('button', { name: 'Dry run' }).click()
    await expect(importDialog).toContainText('would be imported')
    await importDialog.getByRole('button', { name: 'Import', exact: true }).click()
    await expect(importDialog).toContainText('Imported 2 rows')
    await importDialog.getByRole('button', { name: 'Close', exact: true }).last().click()

    // The execution plan is shown as a tree and marks the heavy step.
    await page.locator('.oq-editor .monaco-editor').click()
    await page.keyboard.press('Control+A')
    await page.keyboard.type('SELECT * FROM users ORDER BY id')
    await page.getByRole('button', { name: 'Explain', exact: true }).click()
    const plan = page.getByRole('region', { name: 'Execution plan' })
    await expect(plan).toContainText('Seq Scan')
    await expect(plan).toContainText('public.users')
    await plan.getByRole('button', { name: 'Close plan' }).click()
    await expect(plan).toHaveCount(0)
  } finally {
    await app.close()
  }
})
