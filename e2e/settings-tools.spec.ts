import { _electron as electron, expect, test } from '@playwright/test'
import { mkdtempSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runPaletteCommand } from './helpers/panels'

/**
 * Settings › Tools (F10, B7.3) for a workspace's project, against the E2E contract mock (electron/main/e2e/mcp-tools-mock.ts):
 * groups with their costs, turning a group on in the project, and a per-tool rule.
 */
test('Settings › Tools: groups and costs, turning a group on in the project, and a per-tool rule', async () => {
  test.setTimeout(90_000)
  const info = test.info()
  const root = mkdtempSync(join(tmpdir(), 'oxe-settings-tools-'))
  const repo = join(root, 'tools-repo'); mkdirSync(repo)
  const app = await electron.launch({ args: [join(process.cwd(), 'e2e/electron-main.cjs')], env: {
    ...process.env, OXESPACE_DISABLE_SINGLE_INSTANCE: '1', OXESPACE_E2E_MOCK_NATIVE: '1', OXESPACE_DB_PATH: join(root, 'db.sqlite3')
  } })
  try {
    const page = await app.firstWindow()
    await page.setViewportSize({ width: 1360, height: 900 })
    await page.getByTestId('btn-new-workspace').click()
    await page.getByTestId('wizard-dir-input').fill(repo)
    await page.getByTestId('wizard-launch-btn').click()
    await runPaletteCommand(page, 'Workspace settings')
    const modal = page.getByRole('dialog', { name: 'Settings', exact: true })
    await expect(modal).toBeVisible()
    const category = modal.getByRole('navigation', { name: 'Settings categories' }).getByRole('button', { name: /^Tools/ })
    await category.click()
    await expect(category).toHaveAttribute('aria-current', 'page')
    const tools = modal.getByTestId('tools-settings')

    // Every group, each with its cost per provider as text, and the Codex note.
    for (const name of ['Core tools', 'Orchestration', 'Data', 'Documentation', 'App', 'Team', 'Delegated task', 'OxeCode terminal']) {
      const group = tools.getByRole('region', { name, exact: true })
      await expect(group).toBeVisible()
      await expect(group.getByRole('definition').first()).toContainText(/tokens · [\d,]+ characters|Not offered/)
    }
    await expect(tools.getByTestId('tools-codex-note')).toContainText('Every group that is not off is available from the start')
    await expect(tools.getByRole('region', { name: 'Team', exact: true }).getByRole('radiogroup')).toHaveCount(0)
    await modal.screenshot({ path: info.outputPath('tools-groups.png') })

    // Turn Data off, then on again with its segmented control (one control per group, #210 review), and see it reflected.
    const data = tools.getByRole('region', { name: 'Data', exact: true })
    await data.getByRole('radio', { name: 'Off' }).click()
    await expect(tools.getByRole('status')).toHaveText('Data in this project: Off.')
    // The three cost values of a group that is off.
    await expect(data.locator('dd').filter({ hasText: /^Not offered$/ })).toHaveCount(3)
    await data.getByRole('radio', { name: 'On demand' }).click()
    await expect(tools.getByRole('status')).toHaveText('Data in this project: On demand.')
    await expect(data.getByRole('radio', { name: 'On demand' })).toHaveAttribute('aria-checked', 'true')
    await expect(data.getByText('oxe.yaml', { exact: true })).toBeVisible()
    await tools.getByRole('button', { name: 'Reload' }).click()
    await expect(tools.getByRole('region', { name: 'Data', exact: true }).getByRole('radio', { name: 'On demand' })).toHaveAttribute('aria-checked', 'true')

    // A per-tool rule: block one tool, then let another run without asking after confirming.
    const orchestration = tools.getByRole('region', { name: 'Orchestration', exact: true })
    await orchestration.getByText(/^Rules per tool/).click()
    await orchestration.getByRole('combobox', { name: 'Rule for oxespace_delegate_task' }).selectOption('deny')
    await expect(tools.getByRole('status')).toHaveText('oxespace_delegate_task: Block.')
    await expect(orchestration.getByText('Blocked everywhere: OxeChat conversations, OxeCode terminals and MCP.')).toBeVisible()
    await expect(orchestration.getByText(/^Rules per tool · 1 set/)).toBeVisible()
    await orchestration.getByRole('combobox', { name: 'Rule for oxespace_thread_read' }).selectOption('allow')
    const confirm = page.getByRole('dialog', { name: 'Run oxespace_thread_read without asking?' })
    await confirm.getByRole('button', { name: 'Run without asking' }).click()
    await expect(tools.getByRole('status')).toHaveText('oxespace_thread_read: Run without asking.')
    await expect(orchestration.getByRole('combobox', { name: 'Rule for oxespace_thread_read' })).toHaveValue('allow')

    // The user-level rule of another server is shown and cannot be changed here; the policy is read only.
    const others = tools.getByRole('region', { name: 'Other MCP servers', exact: true })
    await expect(others.getByRole('combobox', { name: 'Rule for delete_repository' })).toBeDisabled()
    await expect(tools.getByRole('region', { name: 'User and organization policy', exact: true }).getByRole('combobox')).toHaveCount(0)
    await modal.screenshot({ path: info.outputPath('tools-rules.png') })
  } finally {
    await app.close()
  }
})
