import { expect, test, type Locator, type Page } from '@playwright/test'
import { launchApp, openDemoWorkspace, resizeWindow, type Appearance } from '../helpers/launch'
import { expectSurface } from '../helpers/visual'

/**
 * Pixel baselines for the OxeQuery surfaces a person actually looks at: containers, connection forms,
 * the SQL workbench (result, error, plan, filter, row edit), dialogs, server and settings, and MongoDB.
 * Everything runs against the mock engine (`OXESPACE_E2E_MOCK_NATIVE`), so the data never changes.
 * Each state is compared in both themes at 1280x800.
 */
const THEMES: Appearance[] = ['light', 'dark']

/** Durations and the like are measured, not designed: they are masked, the layout around them is not. */
/** A tooltip opened by the last click would sit in half of the captures: park the pointer first. */
const settle = async (page: Page): Promise<void> => { await page.mouse.move(0, 0); await page.waitForTimeout(150) }

const volatile = (page: Page): Locator[] => [
  page.locator('.oq-duration, [data-oq-volatile], .oq-statusbar time, .oq-tx time'),
  page.locator('.oq-state-since, .oq-timing')
]

for (const theme of THEMES) {
  test(`OxeQuery containers, forms and dialogs — ${theme}`, async () => {
    test.setTimeout(180_000)
    const { app, page, workspaceRoot } = await launchApp({ appearance: theme })
    try {
      await resizeWindow(app, 1280, 800)
      await openDemoWorkspace(page, workspaceRoot)
      await page.getByRole('navigation', { name: 'Application view' }).getByRole('button', { name: 'OxeQuery' }).click()
      const view = page.locator('.oq-view')
      await view.waitFor()
      const shot = (name: string, target: Locator = view, extraMask: Locator[] = []): Promise<void> => settle(page).then(() => expectSurface(page, `${name}-${theme}`, { target, mask: [...volatile(page), ...extraMask] }))

      await expect(page.getByRole('button', { name: 'mongo-dev', exact: true }).first()).toBeVisible()
      await shot('containers')

      await page.getByRole('button', { name: 'Images, volumes and networks' }).click()
      await expect(page.getByRole('button', { name: 'Images, volumes and networks' })).toHaveAttribute('aria-expanded', 'true')
      await shot('containers-resources')
      await page.getByRole('button', { name: 'Images, volumes and networks' }).click()

      await page.getByRole('button', { name: 'mongo-dev', exact: true }).first().click()
      await page.getByRole('complementary', { name: /mongo-dev details/ }).waitFor()
      await shot('container-details')
      await page.getByRole('button', { name: 'Close details' }).click()

      await page.getByRole('button', { name: 'New database' }).click()
      const wizard = page.getByRole('dialog', { name: 'New database' })
      await wizard.waitFor()
      await shot('dialog-new-database', wizard)
      await page.keyboard.press('Escape')

      await page.getByRole('button', { name: 'New connection' }).first().click()
      const form = page.getByRole('dialog', { name: 'New connection' })
      await form.waitFor()
      await shot('dialog-connection-postgres', form)
      await form.getByRole('radio', { name: /MongoDB/ }).click()
      await shot('dialog-connection-mongodb', form)
      await form.getByRole('button', { name: /Security/ }).click()
      await form.getByRole('button', { name: /SSH tunnel/ }).click()
      await shot('dialog-connection-security', form)
      await page.keyboard.press('Escape')

      await page.getByRole('tab', { name: 'Activity' }).click()
      // The first column of the audit table is the time of each entry: it is the moment the test ran. Masking
      // alone is not enough, because the table sizes its columns to that text, so the time is replaced with
      // a fixed one before the capture.
      const when = page.locator('.oq-view tbody tr td:first-child')
      await expect(when.first()).toBeVisible()
      await when.evaluateAll(cells => { for (const cell of cells) cell.textContent = '10/18/2026, 8:00 AM' })
      await shot('activity', view, [when])
    } finally { await app.close() }
  })

  test(`OxeQuery SQL workbench — ${theme}`, async () => {
    test.setTimeout(240_000)
    const { app, page, workspaceRoot } = await launchApp({ appearance: theme })
    try {
      await resizeWindow(app, 1280, 800)
      await openDemoWorkspace(page, workspaceRoot)
      await page.getByRole('navigation', { name: 'Application view' }).getByRole('button', { name: 'OxeQuery' }).click()
      const view = page.locator('.oq-view')
      await view.waitFor()
      const shot = (name: string, target: Locator = view): Promise<void> => settle(page).then(() => expectSurface(page, `${name}-${theme}`, { target, mask: [...volatile(page), page.locator('.oq-editor')] }))

      await page.getByRole('button', { name: 'Connect to pg-dev' }).click()
      await page.getByRole('button', { name: 'Edit pg-dev' }).click()
      const edit = page.getByRole('dialog', { name: 'Edit connection' })
      await edit.getByRole('switch', { name: /Read-only/ }).setChecked(false)
      await edit.getByRole('button', { name: 'Save' }).click()
      await expect(edit).toBeHidden()

      const editor = page.locator('.oq-editor .monaco-editor')
      const type = async (text: string): Promise<void> => { await editor.click(); await page.keyboard.press('Control+A'); await page.keyboard.insertText(text); await page.keyboard.press('Escape') }

      await type('SELEC broken')
      await page.getByRole('button', { name: /^Run/ }).first().click()
      await page.getByRole('alert').first().waitFor()
      await shot('sql-error')

      await type('SELECT * FROM users ORDER BY id')
      await page.getByRole('button', { name: 'Explain', exact: true }).click()
      await page.getByRole('region', { name: 'Execution plan' }).waitFor()
      await shot('sql-plan')
      await page.getByRole('button', { name: 'Close plan' }).click()

      await page.getByRole('treeitem', { name: 'users', exact: true }).click({ position: { x: 12, y: 8 } })
      await expect(page.getByRole('gridcell', { name: 'alice', exact: true })).toBeVisible()
      await shot('sql-table-rows')

      await page.getByRole('button', { name: 'Filter' }).click()
      await shot('sql-table-filter')

      await page.getByRole('button', { name: 'Import', exact: true }).click()
      const importing = page.getByRole('dialog', { name: /Import into/ })
      await importing.waitFor()
      await shot('dialog-import', importing)
      await page.keyboard.press('Escape')

      await page.getByRole('button', { name: 'New table' }).click()
      const creating = page.getByRole('dialog', { name: /New table/ })
      await creating.waitFor()
      await shot('dialog-new-table', creating)
      await page.keyboard.press('Escape')

      await page.getByRole('button', { name: 'Server: databases and roles' }).click()
      const server = page.getByRole('dialog', { name: /Server of/ })
      await server.waitFor()
      await shot('dialog-server', server)
      await page.keyboard.press('Escape')

      await page.getByRole('button', { name: 'OxeQuery settings' }).click()
      const settings = page.getByRole('dialog', { name: 'OxeQuery settings' })
      await settings.waitFor()
      await shot('dialog-settings', settings)
      await page.keyboard.press('Escape')
    } finally { await app.close() }
  })

  test(`OxeQuery MongoDB workbench — ${theme}`, async () => {
    test.setTimeout(180_000)
    const { app, page, workspaceRoot } = await launchApp({ appearance: theme })
    try {
      await resizeWindow(app, 1280, 800)
      await openDemoWorkspace(page, workspaceRoot)
      await page.getByRole('navigation', { name: 'Application view' }).getByRole('button', { name: 'OxeQuery' }).click()
      const view = page.locator('.oq-view')
      await view.waitFor()
      const shot = (name: string, target: Locator = view): Promise<void> => settle(page).then(() => expectSurface(page, `${name}-${theme}`, { target, mask: [...volatile(page), page.locator('.oq-editor')] }))

      await page.getByRole('button', { name: 'Connect to mongo-dev' }).click()
      const sidebar = page.getByRole('navigation', { name: 'Databases' })
      await sidebar.getByRole('button', { name: 'shop', exact: true }).click()
      await sidebar.getByRole('button', { name: 'items', exact: true }).click()
      await expect(page.getByText('_id: 507f1f77bcf86cd799439011')).toBeVisible()
      await shot('mongo-documents')
      await page.getByRole('radio', { name: 'Table' }).click()
      await shot('mongo-table')
      await page.getByRole('radio', { name: 'Documents' }).click()
      await page.getByRole('button', { name: 'Aggregate' }).click()
      await shot('mongo-aggregate')
    } finally { await app.close() }
  })
}
