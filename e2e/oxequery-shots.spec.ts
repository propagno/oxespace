import { _electron as electron, expect, test, type Page } from '@playwright/test'
import { mkdirSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/** Screenshots of every OxeQuery surface in both modes, for a person to look at (e2e/screenshots/oxequery). */
const OUT = join(process.cwd(), 'e2e/screenshots/oxequery' + (process.env.SHOTS_W ? '-' + process.env.SHOTS_W : ''))

async function mode(page: Page, value: 'light' | 'dark'): Promise<void> {
  await page.evaluate(next => { document.documentElement.dataset.mode = next }, value)
  await page.waitForTimeout(250)
}

test('captures the OxeQuery surfaces', async () => {
  test.setTimeout(240_000)
  mkdirSync(OUT, { recursive: true })
  const root = mkdtempSync(join(tmpdir(), 'oxespace-oxequery-shots-'))
  const repo = join(root, 'repo'); mkdirSync(repo)
  const app = await electron.launch({ args: [join(process.cwd(), 'e2e/electron-main.cjs')], env: {
    ...process.env, OXESPACE_DISABLE_SINGLE_INSTANCE: '1', OXESPACE_E2E_MOCK_NATIVE: '1', OXESPACE_DB_PATH: join(root, 'app.sqlite3')
  } })
  try {
    const page = await app.firstWindow()
    await app.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows()[0].setSize(Number(process.env.SHOTS_W ?? 1360), Number(process.env.SHOTS_H ?? 860)) })
    await page.waitForLoadState('domcontentloaded')
    await page.getByTestId('btn-new-workspace').click()
    await page.getByTestId('wizard-dir-input').fill(repo)
    await page.getByTestId('wizard-layout-card-1').click()
    await page.getByTestId('wizard-launch-btn').click()
    await page.getByRole('navigation', { name: 'Application view' }).getByRole('button', { name: 'OxeQuery' }).click()
    await page.waitForTimeout(600)
    const shot = async (name: string): Promise<void> => { for (const m of ['light', 'dark'] as const) { await mode(page, m); await page.screenshot({ path: join(OUT, `${name}-${m}.png`) }) } }

    await shot('1-containers')
    await page.getByRole('button', { name: 'Connect to pg-dev' }).click()
    await page.getByRole('button', { name: 'Edit pg-dev' }).click()
    await page.getByRole('dialog', { name: 'Edit connection' }).waitFor()
    await shot('2-connection-dialog')
    const settings = page.getByRole('dialog', { name: 'Edit connection' })
    await settings.getByRole('switch', { name: /Read-only/ }).setChecked(false)
    await settings.getByRole('button', { name: 'Save' }).click()
    await page.getByRole('treeitem', { name: 'users', exact: true }).click({ position: { x: 12, y: 8 } })
    await expect(page.getByRole('gridcell', { name: 'alice', exact: true })).toBeVisible()
    await shot('3-sql-table')
    await page.getByRole('treeitem', { name: 'users', exact: true }).click({ position: { x: 12, y: 8 } })
    await page.locator('.oq-grid-row .oq-grid-index').first().click()
    await shot('4-sql-row-details')
    await page.getByRole('button', { name: 'Close row details' }).click()
    await page.getByRole('treeitem', { name: 'users', exact: true }).hover()
    await page.getByRole('button', { name: 'Structure of users' }).click()
    await page.getByRole('dialog', { name: 'public.users' }).waitFor()
    await shot('5-structure-editor')
    await page.keyboard.press('Escape')
    await page.getByRole('button', { name: 'Server: databases and roles' }).click()
    await page.getByRole('dialog', { name: /Server of/ }).waitFor()
    await shot('6-server-panel')
    await page.keyboard.press('Escape')
    await page.getByRole('button', { name: 'Library' }).click()
    await shot('7-library')
    await page.getByRole('button', { name: 'Library' }).click()
    await page.getByRole('button', { name: 'OxeQuery settings' }).click()
    await shot('8-settings')
    await page.keyboard.press('Escape')

    await page.getByRole('tab', { name: 'Containers' }).click()
    await page.getByRole('button', { name: 'Connect to mongo-dev' }).click()
    const sidebar = page.getByRole('navigation', { name: 'Databases' })
    await sidebar.getByRole('button', { name: 'shop', exact: true }).click()
    await sidebar.getByRole('button', { name: 'items', exact: true }).click()
    await expect(page.getByText('_id: 507f1f77bcf86cd799439011')).toBeVisible()
    await shot('9-mongo-documents')
    await page.getByRole('radio', { name: 'Tree' }).click()
    await shot('10-mongo-tree')
  } finally { await app.close() }
})
