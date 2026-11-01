import { _electron as electron, expect, test, type Page } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const VIEWS = ['OxeCode', 'OxeChat', 'OxeQuery', 'OxePod', 'OxePost'] as const
const showView = (page: Page, name: typeof VIEWS[number]) => page.getByRole('navigation', { name: 'Application view' }).getByRole('button', { name, exact: true }).click()

/** Opens Tools in the application menu and returns its "Project team…" item. */
async function toolsTeamItem(page: Page) {
  await page.getByRole('button', { name: 'Application menu' }).click()
  const tools = page.locator('[role="menu"]').first().getByRole('menuitem', { name: 'Tools', exact: true })
  await tools.hover()
  await tools.press('ArrowRight').catch(() => undefined)
  return page.getByRole('menuitem', { name: /^Project team…/ })
}

test('Team is off the title bar and opens from the palette, the Tools menu, Mod+Shift+T and the OxeChat project menu, saying why when it cannot (F35)', async () => {
  test.setTimeout(120000)
  const root = mkdtempSync(join(tmpdir(), 'oxe-team-entry-')), repo = join(root, 'repo')
  mkdirSync(repo); execFileSync('git', ['init', repo], { windowsHide: true, stdio: 'ignore' })
  const env = { ...process.env, OXESPACE_DISABLE_SINGLE_INSTANCE: '1', OXESPACE_E2E_MOCK_NATIVE: '0', OXESPACE_DB_PATH: join(root, 'db.sqlite3') }
  for (const name of Object.keys(env)) if (name.startsWith('OXESPACE_MCP_')) delete env[name]
  const app = await electron.launch({ args: [join(process.cwd(), 'e2e/electron-main.cjs')], env })
  try {
    const page = await app.firstWindow()
    const dialog = page.getByRole('dialog', { name: 'Project team', exact: true })
    await page.getByTestId('btn-new-workspace').waitFor({ state: 'visible' })

    const item = await toolsTeamItem(page)
    // No workspace yet: muted but reachable, with its reason; choosing it says the reason again.
    await expect(item).toHaveAttribute('aria-disabled', 'true')
    await expect(item).toHaveAttribute('aria-description', 'Open a workspace to open its team')
    await expect(item).toContainText('Open a workspace to open its team')
    await item.click()
    await expect(page.getByText('Open a workspace to open its team', { exact: true }).last()).toBeVisible()
    await page.keyboard.press('Escape')

    await page.getByTestId('btn-new-workspace').click()
    await page.getByTestId('wizard-dir-input').fill(repo)
    await page.getByTestId('wizard-launch-btn').click()
    await expect(page.getByTestId('wizard-launch-btn')).toBeHidden()

    // Palette (a focused terminal keeps Ctrl+K, so open it from the sidebar).
    await page.getByPlaceholder('Filter workspaces').focus()
    await page.keyboard.press('Control+k')
    await page.keyboard.type('equipe')
    await page.locator('[cmdk-item]').filter({ hasText: 'Project team' }).first().click()
    await expect(dialog).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(dialog).toBeHidden()

    // Tools › Project team…
    await (await toolsTeamItem(page)).click()
    await expect(dialog).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(dialog).toBeHidden()

    // Mod+Shift+T, also from a focused terminal.
    await page.locator('.xterm').first().click()
    await page.keyboard.press('Control+Shift+T')
    await expect(dialog).toBeVisible()
    await page.keyboard.press('Escape')

    // The title bar has no Team control in any view.
    for (const view of VIEWS) {
      await showView(page, view)
      await expect(page.getByRole('button', { name: /^(Team|Project team)$/ })).toHaveCount(0)
    }

    // OxeQuery: the shortcut says why, never a silent no-op.
    await showView(page, 'OxeQuery')
    await page.keyboard.press('Control+Shift+T')
    await expect(page.getByText('Team is available in OxeCode and OxeChat', { exact: true })).toBeVisible()
    await expect(dialog).toBeHidden()

    // OxeChat: the project row's ⋯ menu opens the Team of that project.
    await page.evaluate(async path => { await window.oxe.thread!.addProject(path) }, repo)
    await showView(page, 'OxeChat')
    const actions = page.locator('[data-project-actions]').first()
    await actions.waitFor({ state: 'visible' })
    await actions.click()
    await page.getByRole('menuitem', { name: 'Project team…', exact: true }).click()
    await expect(dialog).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(dialog).toBeHidden()
  } finally { await app.close() }
})
