import { _electron as electron, expect, test } from '@playwright/test'
import { mkdirSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { connectFromContainer } from './helpers/oxepod'

/** Schema-aware completion in the SQL editor, and the grid's client-side filter, pinned columns and cell viewers. */
const OUT = join(process.cwd(), 'e2e/screenshots/oxequery-q2-q3')

test('completes columns by alias, then filters, pins and opens json cells', async () => {
  test.setTimeout(150_000)
  mkdirSync(OUT, { recursive: true })
  const root = mkdtempSync(join(tmpdir(), 'oxespace-oq-q2q3-'))
  const repo = join(root, 'repo'); mkdirSync(repo)
  const app = await electron.launch({ args: [join(process.cwd(), 'e2e/electron-main.cjs')], env: { ...process.env, OXESPACE_DISABLE_SINGLE_INSTANCE: '1', OXESPACE_E2E_MOCK_NATIVE: '1', OXESPACE_DB_PATH: join(root, 'app.sqlite3') } })
  try {
    const page = await app.firstWindow()
    await page.waitForLoadState('domcontentloaded')
    await page.getByTestId('btn-new-workspace').click()
    await page.getByTestId('wizard-dir-input').fill(repo)
    await page.getByTestId('wizard-layout-card-1').click()
    await page.getByTestId('wizard-launch-btn').click()
    await connectFromContainer(page, 'pg-dev')
    await expect(page.getByRole('tab', { name: 'pg-dev' })).toBeVisible()

    // Completion: the alias resolves to users, so its columns are offered; nothing runs.
    await page.locator('.oq-editor .monaco-editor').click()
    await page.keyboard.press('Control+A')
    await page.keyboard.type('SELECT u. FROM users u', { delay: 20 })
    for (let i = 0; i < ' FROM users u'.length; i++) await page.keyboard.press('ArrowLeft')
    await page.keyboard.press('Control+Space')
    const suggestions = page.locator('.suggest-widget .monaco-list-row')
    await expect(suggestions.first()).toBeVisible()
    await expect(page.locator('.suggest-widget')).toContainText('name')
    await page.screenshot({ path: join(OUT, 'completion.png') })
    await page.keyboard.press('Escape')

    // Grid: run a query, filter the loaded rows, pin a column.
    await page.keyboard.press('Control+A')
    await page.keyboard.type('SELECT * FROM users', { delay: 10 })
    await page.keyboard.press('Escape')
    await page.getByRole('button', { name: /^Run/ }).first().click()
    await expect(page.getByRole('gridcell', { name: 'alice', exact: true })).toBeVisible()
    await page.getByRole('searchbox', { name: 'Filter loaded rows' }).fill('bob')
    await expect(page.getByRole('gridcell', { name: 'alice', exact: true })).toHaveCount(0)
    await expect(page.getByRole('gridcell', { name: 'bob', exact: true })).toBeVisible()
    await expect(page.getByRole('status').filter({ hasText: '1 of 3 loaded rows' })).toBeVisible()
    await page.getByRole('button', { name: 'Clear filter' }).click()
    await expect(page.getByRole('gridcell', { name: 'alice', exact: true })).toBeVisible()
    await page.getByRole('columnheader', { name: /email/ }).hover()
    await page.getByRole('button', { name: 'Pin column email' }).click()
    await expect(page.getByRole('columnheader').nth(1)).toContainText('email')
    await page.screenshot({ path: join(OUT, 'grid.png') })

    // JSON and array cells open as viewers.
    await page.locator('.oq-editor .monaco-editor').click()
    await page.keyboard.press('Control+A')
    await page.keyboard.type('SELECT * FROM docs', { delay: 10 })
    await page.keyboard.press('Escape')
    await page.getByRole('button', { name: /^Run/ }).first().click()
    await expect(page.getByRole('gridcell').first()).toBeVisible()
    await page.getByRole('gridcell').filter({ hasText: '"name":"alice"' }).dblclick()
    await expect(page.getByRole('group', { name: 'JSON document' })).toBeVisible()
    await expect(page.getByRole('group', { name: 'JSON document' })).toContainText('Recife')
    await page.getByRole('button', { name: 'Collapse profile' }).click()
    await expect(page.getByRole('group', { name: 'JSON document' })).not.toContainText('Recife')
    await page.screenshot({ path: join(OUT, 'json-viewer.png') })
    await page.getByRole('gridcell').filter({ hasText: 'dev ops' }).dblclick()
    await expect(page.getByRole('list', { name: 'Array elements' }).getByRole('listitem')).toHaveText(['admin', 'dev ops', 'NULL'])
  } finally { await app.close() }
})
