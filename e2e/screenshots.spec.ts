import { _electron as electron, test, type Page } from '@playwright/test'
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
    // 1. Empty state (no workspace yet)
    await shot(page, '01-empty-state')

    // 2. New workspace modal (open via "+ New workspace" button)
    await page.getByTestId('btn-new-workspace').click()
    await page.waitForTimeout(200)
    await shot(page, '02-new-workspace-modal')

    // 3. Fill modal, choose layout, launch
    await page.getByTestId('wizard-dir-input').fill(workspaceRoot)
    await page.getByTestId('layout-4').click().catch(() => undefined) // 2x2
    await shot(page, '03-new-workspace-modal-filled')
    await page.getByTestId('wizard-launch-btn').click()
    await page.waitForSelector('[data-testid="workspace-grid"]', { timeout: 8000 })
    await page.waitForTimeout(400)

    // 4. Workspace grid with sidebar
    await shot(page, '04-workspace-grid-with-sidebar')

    // 5. Sidebar collapsed (Ctrl+B)
    await page.keyboard.press('Control+b')
    await page.waitForTimeout(300)
    await shot(page, '05-sidebar-collapsed')
    await page.keyboard.press('Control+b')
    await page.waitForTimeout(300)

    // 6. Tools menu open (click trigger)
    await page.locator('.tools-menu-trigger').first().click().catch(() => undefined)
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

    // 8. History panel (Ctrl+Shift+H)
    await page.keyboard.press('Control+Shift+h')
    await page.waitForTimeout(300)
    await shot(page, '08-history-panel')
    await page.keyboard.press('Escape')
    await page.waitForTimeout(200)

    // 9. Settings modal (Ctrl+,)
    await page.keyboard.press('Control+,')
    await page.waitForTimeout(300)
    await shot(page, '09-settings-modal')

    // 10. Settings — New custom agent dialog
    await page.getByTestId('btn-new-custom-agent').click().catch(() => undefined)
    await page.waitForTimeout(300)
    await shot(page, '10-agent-config-new')
    await page.keyboard.press('Escape')
    await page.waitForTimeout(200)
    await page.keyboard.press('Escape')
    await page.waitForTimeout(200)

    // 11. MCP panel via command palette
    await page.keyboard.press('Control+k')
    await page.waitForTimeout(200)
    await page.keyboard.type('mcp')
    await page.waitForTimeout(200)
    await page.keyboard.press('Enter')
    await page.waitForTimeout(400)
    await shot(page, '11-mcp-panel')
    await page.keyboard.press('Escape')
    await page.waitForTimeout(200)

    // 12. Skills browser
    await page.keyboard.press('Control+k')
    await page.waitForTimeout(200)
    await page.keyboard.type('skills')
    await page.waitForTimeout(200)
    await page.keyboard.press('Enter')
    await page.waitForTimeout(400)
    await shot(page, '12-skills-browser')

    // 13. New skill form
    await page.getByTestId('btn-new-skill').click().catch(() => undefined)
    await page.waitForTimeout(300)
    await shot(page, '13-skill-create-form')
    await page.keyboard.press('Escape')
    await page.waitForTimeout(200)

    // 14. Toggle Editor panel (Ctrl+E)
    await page.keyboard.press('Control+e')
    await page.waitForTimeout(400)
    await shot(page, '14-editor-panel')
    await page.keyboard.press('Control+e')
    await page.waitForTimeout(300)

    // 15. Open GitHub panel via tools menu
    await page.locator('.tools-menu-trigger').first().click().catch(() => undefined)
    await page.waitForTimeout(200)
    await page.locator('text=GitHub').first().click().catch(() => undefined)
    await page.waitForTimeout(400)
    await shot(page, '15-github-panel')

    // 16. Workspace settings modal
    await page.keyboard.press('Escape')
    await page.waitForTimeout(200)
    await page.keyboard.press('Control+Shift+d').catch(() => undefined)
    await page.waitForTimeout(300)
    // Try opening workspace settings via command palette as fallback
    await page.keyboard.press('Control+k')
    await page.waitForTimeout(200)
    await page.keyboard.type('workspace settings')
    await page.waitForTimeout(200)
    await page.keyboard.press('Enter')
    await page.waitForTimeout(400)
    await shot(page, '16-workspace-settings')
    await page.keyboard.press('Escape')
    await page.waitForTimeout(200)

    // 17. Slash overlay (Ctrl+/) — needs an active terminal pane focused
    await page.locator('[data-testid="pane-container"]').first().click().catch(() => undefined)
    await page.waitForTimeout(200)
    await page.keyboard.press('Control+/')
    await page.waitForTimeout(300)
    await shot(page, '17-slash-overlay')
    await page.keyboard.press('Escape')
    await page.waitForTimeout(200)

    // 18. Scripts panel via tools menu
    await page.locator('.tools-menu-trigger').first().click().catch(() => undefined)
    await page.waitForTimeout(200)
    await page.locator('text=Scripts').first().click().catch(() => undefined)
    await page.waitForTimeout(400)
    await shot(page, '18-scripts-panel')

    // 19. Web preview panel
    await page.locator('.tools-menu-trigger').first().click().catch(() => undefined)
    await page.waitForTimeout(200)
    await page.locator('text=Web Preview').first().click().catch(() => undefined)
    await page.waitForTimeout(400)
    await shot(page, '19-web-preview-panel')

    // 20. Background dock
    await page.locator('.tools-menu-trigger').first().click().catch(() => undefined)
    await page.waitForTimeout(200)
    await page.locator('text=Background').first().click().catch(() => undefined)
    await page.waitForTimeout(400)
    await shot(page, '20-background-dock')

    // 21. Review panel
    await page.locator('.tools-menu-trigger').first().click().catch(() => undefined)
    await page.waitForTimeout(200)
    await page.locator('text=Review').first().click().catch(() => undefined)
    await page.waitForTimeout(400)
    await shot(page, '21-review-panel')
  } finally {
    await app.close()
  }
})
