import { _electron as electron, expect, test } from '@playwright/test'
import { mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

test('renders the Orca-inspired project, editor and source-control shell', async () => {
  const testRoot = join(tmpdir(), `oxespace-orca-shell-${Date.now()}`)
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
  const pageErrors: Error[] = []
  page.on('pageerror', (error) => pageErrors.push(error))

  try {
    await page.getByTestId('btn-new-workspace').click()
    await page.getByTestId('wizard-dir-input').fill(workspaceRoot)
    await page.getByTestId('wizard-launch-btn').click()
    await page.waitForSelector('[data-testid="workspace-grid"], [data-testid="workspace-split-grid"]')

    const expandSidebar = page.getByRole('button', { name: 'Expand sidebar' })
    if (await expandSidebar.isVisible().catch(() => false)) await expandSidebar.click()

    const navItems = page.locator('.sidebar-quick-nav .sidebar-nav-item')
    await expect(navItems).toHaveCount(3)
    const boxes = await navItems.evaluateAll((items) => items.map((item) => item.getBoundingClientRect().toJSON()))
    expect(boxes[1]?.y).toBeGreaterThan(boxes[0]?.y ?? 0)
    expect(boxes[2]?.y).toBeGreaterThan(boxes[1]?.y ?? 0)
    await expect(page.locator('.app-statusbar')).toBeVisible()

    // Move focus out of xterm first: Ctrl+E is a shell line-editing key while
    // the terminal owns focus, and an application shortcut elsewhere.
    await page.locator('.sidebar-section-header').last().click()
    await page.keyboard.press('Control+e')
    await expect(page.getByTestId('workspace-editor-panel')).toBeVisible()
    await page.getByRole('button', { name: 'Source control' }).click()
    await expect(page.getByTestId('workspace-github-panel')).toBeVisible()
    await expect(page.getByTestId('github-changes-card')).toBeVisible()
    await expect(page.getByText('Algo falhou ao renderizar esta janela.')).toHaveCount(0)
    expect(pageErrors).toEqual([])

    await page.screenshot({ path: join(process.cwd(), 'e2e', 'screenshots', '22-orca-shell-source-control.png') })
  } finally {
    await app.close()
  }
})
