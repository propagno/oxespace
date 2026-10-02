import { _electron as electron, expect, test, type Page } from '@playwright/test'
import { mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const SHOTS_DIR = join(process.cwd(), 'e2e', 'screenshots')

async function shot(page: Page, name: string): Promise<void> {
  await page.waitForTimeout(300)
  await page.screenshot({ path: join(SHOTS_DIR, `${name}.png`), fullPage: false })
}

test('captures all surfaces for design review', async () => {
  mkdirSync(SHOTS_DIR, { recursive: true })
  const testRoot = join(tmpdir(), `oxespace-shots-${Date.now()}`)
  const workspaceRoot = join(testRoot, 'demo-repo')
  mkdirSync(workspaceRoot, { recursive: true })

  const app = await electron.launch({
    args: [join(process.cwd(), 'e2e', 'electron-main.cjs')],
    env: {
      ...process.env,
      OXESPACE_DISABLE_SINGLE_INSTANCE: '1',
      OXESPACE_E2E_MOCK_NATIVE: '1',
      OXESPACE_DB_PATH: join(testRoot, 'oxespace.sqlite3')
    }
  })

  const page = await app.firstWindow()
  await page.waitForLoadState('domcontentloaded')
  await page.waitForTimeout(800)

  try {
    await expect(page.getByRole('button', { name: /RTK update .* available/ })).toBeVisible()
    await expect(page.locator('.workspace-surface .update-banners')).toHaveCount(0)
    // 1. Empty state (no workspace yet)
    await expect(page.getByText('No workspaces yet.')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Toggle all workspace terminals' })).toHaveCount(0)
    await shot(page, '01-empty-state')

    // 2. New workspace modal (open via "+ New workspace" button)
    await page.getByTestId('btn-new-workspace').click()
    await page.waitForTimeout(200)
    await shot(page, '02-new-workspace-modal')

    // 3. Fill modal, choose layout, launch
    await page.getByTestId('wizard-dir-input').fill(workspaceRoot)
    await page.getByTestId('wizard-layout-card-4').click().catch(() => undefined) // 2x2
    await shot(page, '03-new-workspace-modal-filled')
    await page.getByTestId('wizard-launch-btn').click()
    await page.waitForSelector('[data-testid="workspace-grid"], [data-testid="workspace-split-grid"]', { timeout: 8000 })
    await page.waitForTimeout(400)

    // 4. Workspace grid with sidebar
    await shot(page, '04-workspace-grid-with-sidebar')

    // 5. Collapse through the visible navigation control; native terminals own Ctrl+B.
    await page.getByRole('button', { name: 'Collapse sidebar' }).click()
    await expect(page.locator('.app-shell')).toHaveClass(/sidebar-collapsed/)
    await shot(page, '05-sidebar-collapsed')
    await page.getByRole('button', { name: 'Expand sidebar' }).click()

    // 6. Tools modal open (sidebar gear)
    await page.getByTestId('btn-open-tools').click()
    await page.waitForTimeout(200)
    await shot(page, '06-tools-menu-open')
    await page.keyboard.press('Escape')
    await page.waitForTimeout(200)

    // 7. Command palette (Ctrl+K)
    await page.keyboard.press('Control+k')
    await page.waitForTimeout(200)
    await shot(page, '07-command-palette')
    await page.keyboard.press('Escape')
    await page.waitForTimeout(200)

    // 8. Settings modal (Ctrl+,)
    await page.keyboard.press('Control+,')
    await page.waitForTimeout(300)
    await expect(page.locator('.settings-center')).toBeVisible()
    await shot(page, '08-settings-modal')

    // 9. Settings — New custom agent dialog
    await page.getByRole('group', { name: 'Settings scope' }).getByRole('button', { name: 'Application', exact: true }).click()
    await page.getByRole('navigation', { name: 'Settings categories' }).getByRole('button', { name: /^Agents/ }).click()
    await page.getByTestId('btn-new-custom-agent').click()
    await page.waitForTimeout(300)
    await expect(page.locator('.settings-center')).toBeVisible()
    await shot(page, '09-agent-config-new')
    await page.keyboard.press('Escape')
    await page.waitForTimeout(200)
    await page.keyboard.press('Escape')
    await page.waitForTimeout(200)

    // 10. MCP panel via its actual Tools destination.
    await page.getByTestId('btn-open-tools').click()
    await page.getByTestId('tools-modal').getByRole('menuitem', { name: /^MCP Servers/ }).click()
    await expect(page.getByRole('dialog', { name: 'MCP servers' })).toBeVisible()
    await shot(page, '11-mcp-panel')
    await page.getByRole('dialog', { name: 'MCP servers' }).getByRole('button', { name: 'Close' }).click()

    // 12. Skills browser
    await page.getByTestId('btn-open-tools').click()
    await page.getByTestId('tools-modal').getByRole('menuitem', { name: /^Skills/ }).click()
    await expect(page.getByRole('dialog', { name: 'Skills' })).toBeVisible()
    await shot(page, '12-skills-browser')

    // 13. New skill form
    await page.getByTestId('btn-new-skill').click()
    await page.waitForTimeout(300)
    await shot(page, '13-skill-create-form')
    await page.getByRole('dialog', { name: 'Skills' }).getByRole('button', { name: 'Close' }).click()

    // 14. Editor panel from Tools, then close it before opening another panel.
    await page.getByTestId('btn-open-tools').click()
    await page.getByTestId('tools-modal').getByRole('menuitem', { name: /^Editor/ }).click()
    await expect(page.getByTestId('workspace-editor-panel')).toBeVisible()
    await shot(page, '14-editor-panel')
    await page.getByTestId('btn-open-tools').click()
    await page.getByTestId('tools-modal').getByRole('menuitem', { name: /^Editor/ }).click()

    // 15. Open GitHub panel via Tools modal
    await page.getByTestId('btn-open-tools').click()
    await page.getByTestId('tools-modal').getByRole('menuitem', { name: /^GitHub/ }).click()
    await expect(page.getByTestId('workspace-github-panel')).toBeVisible()
    await shot(page, '15-github-panel')
    await page.getByTestId('workspace-github-panel').getByRole('button', { name: 'GitHub features' }).click()
    await expect(page.getByTestId('workspace-github-panel').getByRole('button', { name: 'Back to Git control' })).toBeVisible()
    await expect(page.getByTestId('workspace-github-panel').getByTestId('github-changes-card')).toBeVisible()
    await expect(page.getByTestId('workspace-github-panel').locator('.github-commit-ta')).toHaveCount(0)
    await shot(page, '15b-github-features')

    // 16. Workspace settings, reached through a verified menu action.
    await page.getByTestId('btn-open-tools').click()
    await page.getByTestId('tools-modal').getByRole('menuitem', { name: /^Workspace Settings/ }).click()
    await expect(page.locator('.settings-center')).toBeVisible()
    await shot(page, '16-workspace-settings')
    await page.keyboard.press('Escape')

    // 17. Native terminal shortcuts belong to the terminal; use Tools.
    await page.getByTestId('btn-open-tools').click()
    await page.getByTestId('tools-modal').getByRole('menuitem', { name: /^Terminal Commands/ }).click()
    await expect(page.locator('.slash-overlay')).toBeVisible()
    await shot(page, '17-slash-overlay')
    await page.keyboard.press('Escape')

    // 18. Scripts panel via Tools modal
    await page.getByTestId('btn-open-tools').click()
    await page.getByTestId('tools-modal').getByRole('menuitem', { name: /^Scripts/ }).click()
    await expect(page.getByTestId('workspace-scripts-panel')).toBeVisible()
    await shot(page, '18-scripts-panel')

    // 19. Web preview panel
    await page.getByTestId('btn-open-tools').click()
    await page.getByTestId('tools-modal').getByRole('menuitem', { name: /^Web Preview/ }).click()
    await expect(page.getByTestId('workspace-web-preview-panel')).toBeVisible()
    await shot(page, '19-web-preview-panel')

    // 20. Background dock
    await page.getByTestId('btn-open-tools').click()
    await page.getByTestId('tools-modal').getByRole('menuitem', { name: /^Background Jobs/ }).click()
    await expect(page.getByTestId('workspace-background-panel')).toBeVisible()
    await shot(page, '20-background-dock')

    // 21. Review panel
    await page.getByTestId('btn-open-tools').click()
    await page.getByTestId('tools-modal').getByRole('menuitem', { name: /^Review/ }).click()
    await expect(page.getByTestId('workspace-review-panel')).toBeVisible()
    await shot(page, '21-review-panel')
  } finally {
    await app.close()
  }
})
