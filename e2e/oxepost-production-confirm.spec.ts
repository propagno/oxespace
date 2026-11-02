import { expect, test, type Page } from '@playwright/test'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { launchApp, openDemoWorkspace, type Appearance } from './helpers/launch'

/**
 * P1-10 · OxePost's production confirmation names the real address: `{{baseUrl}}/danger` is shown resolved with the
 * environment's value and its host set apart; with no value, the dialog says the address is not known and Send stays
 * off. Nothing is sent: the host is a reserved example domain and every dialog is cancelled.
 */
const SHOTS = 'e2e/screenshots/approvals'
const sidebar = (page: Page) => page.getByRole('complementary', { name: 'OxePost sidebar' })

function seed(root: string): void {
  const requests = join(root, '.oxespace', 'requests')
  mkdirSync(join(requests, 'environments'), { recursive: true })
  writeFileSync(join(requests, 'danger.http'), '# name: Danger\nGET {{baseUrl}}/danger\n')
  writeFileSync(join(requests, 'environments', 'prod.json'), JSON.stringify({ name: 'prod', production: true, variables: { baseUrl: 'https://api.example.com' }, secrets: [] }))
  writeFileSync(join(requests, 'environments', 'prod-empty.json'), JSON.stringify({ name: 'prod-empty', production: true, variables: {}, secrets: [] }))
}

for (const appearance of ['light', 'dark'] as Appearance[]) {
  test(`the production confirmation shows the resolved host, or says it is unknown (${appearance})`, async () => {
    test.setTimeout(120_000)
    const { app, page, workspaceRoot, consoleErrors } = await launchApp({ appearance })
    try {
      seed(workspaceRoot)
      await openDemoWorkspace(page, workspaceRoot)
      await page.keyboard.press('Control+5')
      await sidebar(page).getByRole('button', { name: /GET\s*Danger/ }).click()

      await page.getByLabel('Environment', { exact: true }).selectOption({ label: 'prod (production)' })
      await page.getByRole('button', { name: 'Send', exact: true }).click()
      const confirm = page.getByRole('dialog', { name: 'Send to prod?' })
      await expect(page.getByTestId('oxepost-production-host')).toHaveText('https://api.example.com')
      await expect(page.getByTestId('oxepost-production-target')).toContainText('GET https://api.example.com/danger')
      await expect(confirm).not.toContainText('{{')
      await expect(confirm.getByRole('button', { name: 'Cancel' })).toBeFocused()
      await page.screenshot({ path: `${SHOTS}/oxepost-production-${appearance}.png` })
      await confirm.getByRole('button', { name: 'Cancel' }).click()

      await page.getByLabel('Environment', { exact: true }).selectOption({ label: 'prod-empty (production)' })
      await page.getByRole('button', { name: 'Send', exact: true }).click()
      const unknown = page.getByRole('dialog', { name: 'Send to prod-empty?' })
      await expect(unknown).toContainText('The address is not known')
      await expect(unknown).toContainText('baseUrl has no value in prod-empty')
      await expect(unknown).not.toContainText('{{')
      await expect(unknown.getByRole('button', { name: 'Send', exact: true })).toBeDisabled()
      await page.screenshot({ path: `${SHOTS}/oxepost-production-missing-${appearance}.png` })
      await unknown.getByRole('button', { name: 'Cancel' }).click()
      expect(consoleErrors.filter(line => line.startsWith('pageerror:'))).toEqual([])
    } finally {
      await app.close()
    }
  })
}
