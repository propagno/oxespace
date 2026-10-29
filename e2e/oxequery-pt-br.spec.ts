import { expect, test } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { launchApp, openDemoWorkspace } from './helpers/launch'
import type Catalog from '../shared/locales/en/oxequery.json'

const pt = JSON.parse(readFileSync(join(process.cwd(), 'shared', 'locales', 'pt-BR', 'oxequery.json'), 'utf8')) as typeof Catalog & { workbench: { affected_other: string } }

/**
 * The main OxeQuery query flow on a Brazilian Portuguese system: the view, the tree, the workbench, the shared
 * error state and the destructive-statement confirmation all speak Portuguese, numbers use its separators, and
 * no catalog key ever shows in place of its text. SQL, identifiers and the server's own words stay as they are.
 */
test('OxeQuery runs the main query flow in Brazilian Portuguese', async () => {
  test.setTimeout(120_000)
  const { app, page, workspaceRoot, consoleErrors } = await launchApp({ locale: 'pt-BR' })
  try {
    await expect(page.locator('html')).toHaveAttribute('lang', 'pt-BR')
    await openDemoWorkspace(page, workspaceRoot)
    await page.getByRole('navigation', { name: 'Visão do aplicativo' }).getByRole('button', { name: 'OxeQuery' }).click()
    const view = page.locator('.oq-view')
    await view.waitFor()

    // The view's own tabs and the sidebar come from the lazily loaded catalog.
    await expect(view.getByRole('tab', { name: pt.view.tab.containers })).toBeVisible()
    await expect(page.locator('.oq-sidebar').getByRole('region', { name: pt.connections.title })).toBeVisible()

    await page.getByRole('button', { name: pt.containers.connectNamed.replace('{{name}}', 'pg-dev') }).click()
    await expect(page.getByRole('tab', { name: 'pg-dev' })).toBeVisible()
    const tree = page.getByRole('navigation', { name: pt.tree.label })
    await tree.getByRole('treeitem', { name: 'users', exact: true }).click({ position: { x: 12, y: 8 } })
    const grid = page.locator('.oq-grid')
    await expect(grid.getByRole('gridcell', { name: 'alice', exact: true })).toBeVisible()
    await expect(page.locator('.oq-results-bar')).toContainText('public.users')

    await page.locator('.oq-grid-row .oq-grid-index').first().click()
    await expect(page.getByRole('complementary', { name: pt.workbench.rowDetails })).toContainText('alice@example.com')
    await page.getByRole('button', { name: pt.workbench.closeRowDetails }).click()

    // A read-only connection refuses a write: the shared error state explains it in Portuguese.
    await page.locator('.oq-editor .monaco-editor').click()
    await page.keyboard.press('Control+A')
    await page.keyboard.insertText('DELETE FROM users')
    await page.getByRole('button', { name: pt.common.run, exact: true }).click()
    const failure = page.getByRole('alert').filter({ hasText: pt.queryError.title })
    await expect(failure).toContainText(pt.queryError.code['read-only'].headline)

    // Allowing writes, the destructive guard asks first, in Portuguese; the reason under it is the guard's.
    await page.locator('.oq-sidebar').getByRole('button', { name: pt.connections.editNamed.replace('{{name}}', 'pg-dev') }).click()
    const dialog = page.getByRole('dialog', { name: pt.form.editTitle })
    await dialog.getByRole('switch', { name: new RegExp(pt.form.readOnly) }).setChecked(false)
    await dialog.getByRole('button', { name: pt.common.save, exact: true }).click()
    await expect(page.locator('.oq-badge[data-readonly="false"]')).toBeVisible()
    await page.locator('.oq-editor .monaco-editor').click()
    await page.keyboard.press('Control+A')
    await page.keyboard.insertText('DELETE FROM users')
    await page.getByRole('button', { name: pt.common.run, exact: true }).click()
    const confirm = page.getByRole('dialog', { name: pt.workbench.confirm.destructiveTitle })
    await expect(confirm).toContainText('WHERE')
    await confirm.getByRole('button', { name: pt.workbench.confirm.runAnyway }).click()
    await expect(page.locator('.oq-results-bar')).toContainText(pt.workbench.affected_other.replace('{{formatted}}', '3'))

    // No catalog key leaked into the page (a key looks like "workbench.runAll").
    const text = await view.innerText()
    expect(text).not.toMatch(/\b(?:workbench|queryError|tree|connections|containers|common|view)\.[a-zA-Z]+/)
    expect(consoleErrors.filter(line => /i18next|missingKey/i.test(line))).toEqual([])
  } finally {
    await app.close()
  }
})
