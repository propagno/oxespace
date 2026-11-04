import AxeBuilder from '@axe-core/playwright'
import { _electron as electron, expect, test } from '@playwright/test'
import { mkdtempSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { withoutLiveApp } from './helpers/live-app-env'
import { connectFromContainer } from './helpers/oxepod'

/**
 * T63: a row of OxeQuery's Agent activity opens the request in full: the statement formatted, with Copy and "Open in
 * editor" (which puts it in a new query tab and never runs it), and everything the audit recorded. The audit comes from
 * the mock (electron/main/e2e/oxequery-mock.ts): an approved query, a denied DELETE and a query that timed out.
 */
const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']

test('Agent activity shows a request in full, copies it and opens it in the editor without running it', async () => {
  test.setTimeout(120_000)
  const root = mkdtempSync(join(tmpdir(), 'oxespace-oq-activity-'))
  const repo = join(root, 'repo'); mkdirSync(repo)
  const app = await electron.launch({ args: [join(process.cwd(), 'e2e/electron-main.cjs')], env: {
    ...withoutLiveApp(process.env), OXESPACE_DISABLE_SINGLE_INSTANCE: '1', OXESPACE_E2E_MOCK_NATIVE: '1', OXESPACE_DB_PATH: join(root, 'app.sqlite3')
  } as Record<string, string> })
  try {
    const page = await app.firstWindow()
    await app.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows()[0].setSize(1280, 800) })
    await page.waitForLoadState('domcontentloaded')
    await page.getByTestId('btn-new-workspace').click()
    await page.getByTestId('wizard-dir-input').fill(repo)
    await page.getByTestId('wizard-layout-card-1').click()
    await page.getByTestId('wizard-launch-btn').click()
    await expect(page.locator('[data-testid="workspace-grid"], [data-testid="workspace-split-grid"]').first()).toBeVisible()
    await connectFromContainer(page, 'pg-dev')
    const queryTabs = page.locator('.oq-qtab')
    const tabsBefore = await queryTabs.count()

    await page.locator('.oq-sidebar').getByRole('button', { name: 'Agent activity' }).click()
    const activity = page.getByRole('region', { name: 'Agent activity' })
    const rows = activity.locator('tbody tr')
    await expect(rows).toHaveCount(3)
    // "denied", the word OxePost uses too, not "declined".
    await expect(rows.nth(1)).toContainText('denied')
    await expect(activity).not.toContainText('declined')

    // A click opens the request in full: the statement formatted over several lines, and what the audit recorded.
    await rows.nth(0).click()
    const dialog = page.getByRole('dialog', { name: 'Agent request' })
    await expect(dialog).toBeVisible()
    const statement = dialog.getByLabel('Statement', { exact: true })
    await expect(statement).toContainText('ORDER BY')
    expect((await statement.innerText()).split('\n').length).toBeGreaterThan(3)
    for (const fact of ['thread:abc', 'pg-dev', 'dev', 'db_query', 'approved', '3']) await expect(dialog).toContainText(fact)
    await expect(dialog.getByRole('status')).toContainText('never the data it returned')
    const axe = await new AxeBuilder({ page }).setLegacyMode(true).withTags(TAGS).include('[data-testid="oq-activity-detail"]').analyze()
    expect(axe.violations.map(violation => violation.id)).toEqual([])

    // Copy puts the whole formatted statement on the clipboard.
    await dialog.getByRole('button', { name: 'Copy', exact: true }).click()
    await expect.poll(() => app.evaluate(({ clipboard }) => clipboard.readText())).toContain('ORDER BY')

    // Escape closes it and focus is back on the row.
    await page.keyboard.press('Escape')
    await expect(dialog).toHaveCount(0)
    await expect(rows.nth(0)).toBeFocused()

    // Enter on a row opens it too: the denied DELETE, and the query that timed out with its error.
    await rows.nth(1).focus()
    await page.keyboard.press('Enter')
    await expect(dialog).toContainText('DELETE FROM')
    await expect(dialog).toContainText('denied')
    await dialog.getByRole('button', { name: 'Close' }).first().click()
    await expect(rows.nth(1)).toBeFocused()
    await rows.nth(2).focus()
    await page.keyboard.press('Enter')
    await expect(dialog).toContainText('timeout')
    await expect(dialog).toContainText('pg_sleep')
    await page.keyboard.press('Escape')

    // Open in editor: a new query tab of pg-dev holds the statement, and nothing ran (the new tab has no result).
    await rows.nth(0).click()
    await dialog.getByRole('button', { name: 'Open in editor' }).click()
    await expect(dialog).toHaveCount(0)
    await expect(page.getByRole('tab', { name: 'pg-dev', exact: true })).toHaveAttribute('aria-selected', 'true')
    await expect(queryTabs).toHaveCount(tabsBefore + 1)
    await expect(queryTabs.last()).toHaveAttribute('data-active', 'true')
    // Monaco draws only the lines in view: the statement's start is enough to know it is the formatted one.
    await expect(page.locator('.oq-editor .monaco-editor').first()).toContainText("WHERE  email = '?'")
    await expect(page.locator('.oq-grid')).toHaveCount(0)
  } finally {
    await app.close()
  }
})
