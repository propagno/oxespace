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
    // A database container asks before it is interrupted.
    const stopConfirm = page.getByRole('alertdialog', { name: 'Confirm container action' })
    await expect(stopConfirm).toContainText('interrupted')
    await stopConfirm.getByRole('button', { name: 'Cancel' }).click()
    await expect(list.getByRole('row', { name: /pg-dev/ })).toContainText('running')
    await page.getByRole('button', { name: 'Stop pg-dev' }).click()
    await stopConfirm.getByRole('button', { name: 'Stop', exact: true }).click()
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
    await expect(grid.getByRole('gridcell', { name: 'alice', exact: true })).toBeVisible()
    await expect(grid.getByRole('gridcell', { name: 'NULL', exact: true })).toBeVisible()
    await expect(page.locator('.oq-results-bar')).toContainText('public.users')

    // Grid: sort by a column and inspect a row.
    await page.locator('.oq-grid-header').getByText('name', { exact: false }).first().click()
    await expect(page.locator('.oq-grid-header [aria-sort="ascending"]')).toHaveCount(1)
    await page.locator('.oq-grid-row .oq-grid-index').first().click()
    await expect(page.getByRole('complementary', { name: 'Row details' })).toContainText('alice@example.com')
    await page.getByRole('button', { name: 'Close row details' }).click()

    // The editor runs SQL; a destructive statement needs an explicit confirmation.
    await page.locator('.oq-editor .monaco-editor').click()
    await page.keyboard.press('Control+A')
    await page.keyboard.insertText('SELECT * FROM users')
    await page.getByRole('button', { name: /^Run/ }).first().click()
    await expect(grid.getByRole('gridcell', { name: 'carol', exact: true })).toBeVisible()
    await expect(page.locator('.oq-badge[data-readonly="true"]')).toBeVisible()

    await page.locator('.oq-editor .monaco-editor').click()
    await page.keyboard.press('Control+A')
    await page.keyboard.insertText('DELETE FROM users')
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
    await page.keyboard.insertText('DELETE FROM users')
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
    // PostgreSQL opens on its separate fields, MongoDB on its connection string.
    await expect(dialog.getByRole('radio', { name: 'Host' })).toHaveAttribute('aria-checked', 'true')
    await dialog.getByRole('radio', { name: 'URL' }).click()
    await dialog.getByLabel('Connection string').fill('mongodb://root:s3cret@db.internal:27018/shop')
    await expect(dialog.getByRole('radio', { name: /MongoDB/ })).toHaveAttribute('aria-checked', 'true')
    await expect(dialog.getByRole('radio', { name: /MongoDB/ })).toHaveAttribute('aria-checked', 'true')
    await dialog.getByRole('radio', { name: 'Host' }).click()
    await expect(dialog.getByLabel('Host', { exact: true })).toHaveValue('db.internal')
    await expect(dialog.getByLabel('Port')).toHaveValue('27018')
    await expect(dialog.getByLabel('User')).toHaveValue('root')
    await expect(dialog.getByLabel('Name')).toHaveValue('root@db.internal/shop')
    await dialog.getByRole('radio', { name: 'URL' }).click()
    await dialog.getByLabel('Connection string').fill('mysql://x/y')
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
    // Testing again, then saving, updates the one record that "Test" created.
    await dialog.getByRole('button', { name: 'Test connection' }).click()
    await expect(dialog.getByRole('status')).toContainText('Connected')
    await dialog.getByRole('button', { name: 'Save and open' }).click()
    await expect(page.getByRole('tab', { name: 'Behind bastion' })).toBeVisible()
    const saved = await page.evaluate(async () => {
      const result = await window.oxe.oxeQuery.call('connections.list', {}) as { ok: boolean; value?: Array<{ name: string }> }
      return (result.value ?? []).filter(connection => connection.name === 'Behind bastion').length
    })
    expect(saved, 'Test + Test + Save keeps a single connection').toBe(1)
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
    await page.locator('.oq-grid-row .oq-grid-index').first().click()
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

    // Saved queries and history come from the app database.
    await page.getByRole('button', { name: 'Library' }).click()
    const library = page.getByRole('dialog', { name: 'Saved queries and history' })
    await expect(library).toContainText('Active users')
    await library.getByRole('tab', { name: /History/ }).click()
    await expect(library).toContainText('SELECT now()')
    await page.keyboard.press('Escape')
    await page.getByRole('button', { name: 'Library' }).click()

    // What agents asked for is listed in the Activity tab.
    await page.getByRole('tab', { name: 'Activity' }).click()
    await expect(page.getByRole('region', { name: 'Agent activity' })).toContainText('thread:abc')
    await expect(page.getByRole('region', { name: 'Agent activity' })).toContainText('db_query')
    await page.getByRole('tab', { name: 'pg-dev' }).click()

    // The execution plan is shown as a tree and marks the heavy step.
    await page.locator('.oq-editor .monaco-editor').click()
    await page.keyboard.press('Control+A')
    await page.keyboard.insertText('SELECT * FROM users ORDER BY id')
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

test('OxeQuery shows container stats and resources and creates a database from a wizard', async () => {
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

    await expect(page.getByRole('table', { name: 'Container list' })).toContainText('1.5%')

    await page.getByRole('button', { name: 'Images, volumes and networks' }).click()
    const resources = page.getByRole('region', { name: 'Images, volumes and networks' })
    await expect(resources.getByRole('table', { name: 'Images' })).toContainText('postgres')
    await resources.getByRole('tab', { name: /volumes/ }).click()
    await resources.getByRole('button', { name: 'Remove volume pg-dev-data' }).click()
    await expect(page.getByRole('alertdialog', { name: 'Confirm remove' })).toContainText('cannot be recovered')
    await page.getByRole('alertdialog', { name: 'Confirm remove' }).getByRole('button', { name: 'Cancel' }).click()

    await page.getByRole('button', { name: 'New database' }).click()
    const wizard = page.getByRole('dialog', { name: 'New database' })
    await wizard.getByLabel('Name').fill('orders-db')
    await wizard.getByRole('button', { name: 'Create and connect' }).click()
    await expect(page.getByRole('tab', { name: 'orders-db' })).toBeVisible()
  } finally {
    await app.close()
  }
})

test('every control in the OxeQuery views has an accessible name', async () => {
  test.setTimeout(120000)
  const root = mkdtempSync(join(tmpdir(), 'oxespace-oxequery-'))
  const repo = join(root, 'repo'); mkdirSync(repo)
  const app = await electron.launch({ args: [join(process.cwd(), 'e2e/electron-main.cjs')], env: {
    ...process.env, OXESPACE_DISABLE_SINGLE_INSTANCE: '1', OXESPACE_E2E_MOCK_NATIVE: '1', OXESPACE_DB_PATH: join(root, 'app.sqlite3')
  } })
  const unnamed = (): string => `(() => {
    const view = document.querySelector('.oq-view'); const out = []
    const label = el => (el.getAttribute('aria-label') || el.getAttribute('aria-labelledby') && document.getElementById(el.getAttribute('aria-labelledby'))?.textContent
      || el.getAttribute('title') || el.textContent || (el.labels && [...el.labels].map(l => l.textContent).join(' ')) || el.getAttribute('placeholder') || '').trim()
    for (const el of view.querySelectorAll('button, input, select, textarea, [role="button"], [role="tab"]')) {
      if (el.closest('[hidden]') || el.type === 'hidden' || el.closest('.monaco-editor')) continue
      if (!label(el)) out.push(el.outerHTML.slice(0, 120))
    }
    return out
  })()`
  try {
    const page = await app.firstWindow()
    await page.waitForLoadState('domcontentloaded')
    await page.getByTestId('btn-new-workspace').click()
    await page.getByTestId('wizard-dir-input').fill(repo)
    await page.getByTestId('wizard-layout-card-1').click()
    await page.getByTestId('wizard-launch-btn').click()
    await expect(page.locator('[data-testid="workspace-grid"], [data-testid="workspace-split-grid"]').first()).toBeVisible()
    await page.getByRole('navigation', { name: 'Application view' }).getByRole('button', { name: 'OxeQuery' }).click()
    await expect(page.getByRole('table', { name: 'Container list' })).toBeVisible()
    expect(await page.evaluate(unnamed())).toEqual([])

    await page.getByRole('tab', { name: 'Activity' }).click()
    await expect(page.getByRole('region', { name: 'Agent activity' })).toBeVisible()
    expect(await page.evaluate(unnamed())).toEqual([])

    await page.getByRole('tab', { name: 'Containers' }).click()
    await page.getByRole('button', { name: 'Connect to pg-dev' }).click()
    await page.getByRole('navigation', { name: 'Schema' }).getByRole('button', { name: 'users', exact: true }).click()
    await expect(page.locator('.oq-grid')).toBeVisible()
    await page.getByRole('button', { name: 'Library' }).click()
    expect(await page.evaluate(unnamed())).toEqual([])
  } finally {
    await app.close()
  }
})

test('the SQL workbench runs scripts, asks for parameters, keeps a transaction and remembers its tabs', async () => {
  test.setTimeout(120000)
  const root = mkdtempSync(join(tmpdir(), 'oxespace-oxequery-workbench-'))
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
    await page.getByRole('button', { name: 'Connect to pg-dev' }).click()
    await expect(page.getByRole('tab', { name: 'pg-dev' })).toBeVisible()
    const editor = page.locator('.oq-editor .monaco-editor')
    // Escape closes the suggestion list, which would otherwise take the Enter of a shortcut.
    const type = async (text: string): Promise<void> => { await editor.click(); await page.keyboard.press('Control+A'); await page.keyboard.insertText(text); await page.keyboard.press('Escape') }

    // Run all: one result tab per statement.
    await type('SELECT 1; SELECT 2;')
    await page.keyboard.press('Control+Shift+Enter')
    const results = page.getByRole('tablist', { name: 'Results' })
    await expect(results.getByRole('tab')).toHaveCount(2)
    await results.getByRole('tab').nth(1).click()
    await expect(page.locator('.oq-grid').getByRole('gridcell', { name: 'alice', exact: true })).toBeVisible()

    // A parameter is asked for before the statement runs.
    await type('SELECT * FROM users WHERE id = :id')
    await page.keyboard.press('Escape')
    await page.getByRole('button', { name: /^Run/ }).first().click()
    const params = page.getByRole('form', { name: 'Query parameters' })
    await expect(params).toBeVisible()
    await params.getByRole('textbox').fill('1')
    await params.getByRole('button', { name: 'Run', exact: true }).click()
    await expect(page.locator('.oq-grid').getByRole('gridcell', { name: 'alice', exact: true })).toBeVisible()

    // A transaction the person opens is theirs to end (a read-only connection has nothing to commit).
    await page.locator('.oq-sidebar').getByRole('button', { name: 'Edit pg-dev' }).click()
    const settings = page.getByRole('dialog', { name: 'Edit connection' })
    await settings.getByRole('checkbox', { name: /Read-only/ }).uncheck()
    await settings.getByRole('button', { name: 'Save' }).click()
    await page.getByRole('button', { name: 'Begin transaction' }).click()
    await expect(page.getByRole('status').filter({ hasText: 'Transaction open' })).toBeVisible()
    await page.getByRole('button', { name: 'Commit' }).click()
    await expect(page.getByRole('button', { name: 'Begin transaction' })).toBeVisible()

    // Copy as, and the filter bar of a browsed table.
    await expect(page.getByLabel('Copy results as')).toBeVisible()
    await page.getByRole('navigation', { name: 'Schema' }).getByRole('button', { name: 'users', exact: true }).click()
    await page.getByRole('button', { name: 'Filter' }).click()
    await expect(page.getByRole('form', { name: 'Filter rows' }).getByLabel('Column')).toBeVisible()

    // The tabs come back when the connection is opened again.
    await type('SELECT remembered_text')
    await expect.poll(async () => page.evaluate(async () => {
      const list = await window.oxe.oxeQuery.call('connections.list', {}) as { ok: boolean; value?: Array<{ id: string; name: string }> }
      const id = list.value?.find(item => item.name === 'pg-dev')?.id ?? ''
      const loaded = await window.oxe.oxeQuery.call('workspace.load', { connectionId: id }) as { value?: { state: { tabs: Array<{ sql: string }> } | null } }
      return JSON.stringify(loaded.value?.state?.tabs ?? [])
    }), { timeout: 10000 }).toContain('remembered_text')
  } finally { await app.close() }
})

test('the structure editor reviews the SQL of a new table and of an altered one before applying', async () => {
  test.setTimeout(120000)
  const root = mkdtempSync(join(tmpdir(), 'oxespace-oxequery-structure-'))
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
    await page.getByRole('button', { name: 'Connect to pg-dev' }).click()
    await expect(page.getByRole('tab', { name: 'pg-dev' })).toBeVisible()

    // A read-only connection can look but not change: no way to start.
    const tree = page.getByRole('navigation', { name: 'Schema' })
    await expect(tree.getByRole('button', { name: 'users', exact: true })).toBeVisible()
    await expect(tree.getByRole('button', { name: 'New table in public' })).toHaveCount(0)
    await page.locator('.oq-sidebar').getByRole('button', { name: 'Edit pg-dev' }).click()
    const settings = page.getByRole('dialog', { name: 'Edit connection' })
    await settings.getByRole('checkbox', { name: /Read-only/ }).uncheck()
    await settings.getByRole('button', { name: 'Save' }).click()

    // New table: the SQL is shown before anything runs.
    await tree.getByRole('button', { name: 'New table in public' }).click()
    const dialog = page.getByRole('dialog', { name: 'New table in public' })
    await expect(dialog.getByText('Give the table a name.')).toBeVisible()
    await dialog.getByLabel('Table name').fill('orders')
    await dialog.getByRole('button', { name: 'Add column' }).click()
    await dialog.getByLabel('Name of new column').fill('total')
    await dialog.getByLabel('Type of total').fill('numeric(10,2)')
    await dialog.getByRole('button', { name: 'Review SQL' }).click()
    await expect(dialog.getByRole('region', { name: 'Review' })).toContainText('CREATE TABLE "public"."orders"')
    await expect(dialog.getByRole('region', { name: 'Review' })).toContainText('"total" numeric(10,2)')
    await dialog.getByRole('button', { name: 'Create table' }).click()
    await expect(dialog).toHaveCount(0)

    // Existing table: dropping a column is destructive and waits for confirmation.
    await tree.getByRole('button', { name: 'Structure of users' }).click({ force: true })
    const editor = page.getByRole('dialog', { name: 'public.users' })
    await editor.getByRole('button', { name: 'Drop name' }).click()
    await editor.getByRole('button', { name: 'Review SQL' }).click()
    const review = editor.getByRole('region', { name: 'Review' })
    await expect(review).toContainText('DROP COLUMN "name"')
    await expect(review).toContainText('deletes its data for good')
    const apply = editor.getByRole('button', { name: 'Apply changes' })
    await expect(apply).toBeDisabled()
    await review.getByRole('checkbox', { name: /cannot be undone/ }).check()
    await expect(apply).toBeEnabled()
    // Changing the draft discards the review, so what runs is always what was shown.
    await editor.getByRole('button', { name: 'Keep name' }).click()
    await expect(editor.getByRole('region', { name: 'Review' })).toHaveCount(0)
  } finally { await app.close() }
})
