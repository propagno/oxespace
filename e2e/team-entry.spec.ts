import { _electron as electron, expect, test } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

test('Team opens from the title bar, the command palette and the Tools hub, and says why it is unavailable', async () => {
  test.setTimeout(90000)
  const root = mkdtempSync(join(tmpdir(), 'oxe-team-entry-')), repo = join(root, 'repo')
  mkdirSync(repo); execFileSync('git', ['init', repo], { windowsHide: true, stdio: 'ignore' })
  const app = await electron.launch({ args: [join(process.cwd(), 'e2e/electron-main.cjs')], env: { ...process.env, OXESPACE_DISABLE_SINGLE_INSTANCE: '1', OXESPACE_E2E_MOCK_NATIVE: '0', OXESPACE_DB_PATH: join(root, 'db.sqlite3') } })
  try {
    const page = await app.firstWindow()
    const team = page.getByRole('button', { name: 'Team', exact: true })
    const dialog = page.getByRole('dialog', { name: 'Team', exact: true })
    await team.waitFor({ state: 'visible' })
    await expect(team).toBeDisabled()
    await expect(team).toHaveAttribute('title', 'Open a workspace to open its team')
    await page.getByTestId('btn-new-workspace').click()
    await page.getByTestId('wizard-dir-input').fill(repo)
    await page.getByTestId('wizard-launch-btn').click()
    await expect(team).toBeEnabled()

    // A focused terminal keeps Ctrl+K for itself, so open the palette from the sidebar.
    await page.getByPlaceholder('Filter workspaces').focus()
    await page.keyboard.press('Control+k')
    await page.keyboard.type('Team')
    await page.locator('[cmdk-item]').filter({ hasText: 'Project roles and agent inboxes' }).first().click()
    await expect(dialog).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(dialog).toBeHidden()

    await page.getByRole('button', { name: 'Team', exact: true }).first().click()
    await expect(dialog).toBeVisible()
    await page.keyboard.press('Escape')

    await page.getByRole('navigation', { name: 'Application view' }).getByRole('button', { name: 'OxeQuery' }).click()
    await expect(team).toBeDisabled()
    await expect(team).toHaveAttribute('title', 'Team is available in OxeCode and OxeChat')
  } finally { await app.close() }
})
