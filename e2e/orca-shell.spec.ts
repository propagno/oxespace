import { _electron as electron, expect, test } from '@playwright/test'
import { mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'

test('renders the Orca-inspired project, editor and source-control shell', async () => {
  const testRoot = join(tmpdir(), `oxespace-orca-shell-${Date.now()}`)
  const workspaceRoot = join(testRoot, 'demo-repo')
  mkdirSync(workspaceRoot, { recursive: true })
  execFileSync('git', ['init', '-q', workspaceRoot])

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
  await page.setViewportSize({ width: 1600, height: 900 })
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
    await expect(navItems.first()).toContainText('New workspace')
    await expect(navItems.filter({ hasText: 'Files & commands' })).toHaveCount(1)
    await expect(page.getByTestId('btn-open-tools')).toBeVisible()
    await expect(page.locator('.app-statusbar')).toBeVisible()
    const terminalToggle = page.locator('.ws-group-expand-btn')
    await expect(terminalToggle).toHaveCount(1)
    await expect(terminalToggle).toHaveAttribute('aria-expanded', 'true')
    const terminalRows = page.getByTestId('pane-session-row')
    const visibleTerminals = await terminalRows.count()
    expect(visibleTerminals).toBeGreaterThan(0)
    await terminalToggle.click()
    await expect(terminalToggle).toHaveAttribute('aria-expanded', 'false')
    await expect(terminalRows).toHaveCount(0)
    await terminalToggle.click()
    await expect(terminalToggle).toHaveAttribute('aria-expanded', 'true')
    await expect(terminalRows).toHaveCount(visibleTerminals)
    await page.getByTestId('btn-new-workspace').click()
    await page.getByTestId('wizard-dir-input').fill(workspaceRoot)
    await expect(page.getByRole('region', { name: 'Existing workspaces' })).toBeVisible()
    await expect(page.getByTestId('wizard-layout-grid')).toHaveCount(0)
    await page.getByTestId('wizard-launch-btn').click()
    await expect(page.getByTestId('sidebar-workspace-item')).toHaveCount(1)
    await expect(terminalRows).toHaveCount(visibleTerminals)

    // Move focus out of xterm first: Ctrl+E is a shell line-editing key while
    // the terminal owns focus, and an application shortcut elsewhere.
    await page.locator('.sidebar-section-header').last().click()
    await page.keyboard.press('Control+e')
    await expect(page.getByTestId('workspace-editor-panel')).toBeVisible()
    await page.getByRole('button', { name: 'Expand editor' }).click()
    const treeSplitter = page.getByRole('separator', { name: 'File tree width' })
    await expect(treeSplitter).toHaveAttribute('aria-valuenow', '240')
    await treeSplitter.focus()
    await page.keyboard.press('ArrowRight')
    await expect(treeSplitter).toHaveAttribute('aria-valuenow', '256')
    await expect(page.locator('.editor-sidebar')).toHaveCSS('width', '256px')
    await page.setViewportSize({ width: 850, height: 900 })
    await expect(treeSplitter).toHaveAttribute('aria-valuenow', '180')
    await page.setViewportSize({ width: 1600, height: 900 })
    await expect(treeSplitter).toHaveAttribute('aria-valuenow', '256')

    await page.getByRole('button', { name: 'Open connections' }).click()
    await expect(page.getByRole('dialog', { name: 'Connections' })).toBeVisible()
    await expect(page.getByRole('searchbox', { name: 'Search MCP servers' })).toBeVisible()
    await page.screenshot({ path: test.info().outputPath('connections.png') })
    await page.getByRole('dialog', { name: 'Connections' }).getByRole('button', { name: 'Close' }).click()
    await expect(page.locator('.app-statusbar')).not.toContainText('Branch')
    await page.getByRole('button', { name: 'Toggle background activity' }).click()
    await expect(page.getByTestId('workspace-background-panel')).toBeVisible()
    await page.getByTestId('workspace-background-panel').getByRole('button', { name: 'Delegated work' }).click()
    await expect(page.getByTestId('workspace-background-panel').getByText('No delegated work')).toBeVisible()
    await page.getByRole('button', { name: 'Toggle background activity' }).click()
    await page.getByRole('button', { name: 'Source control' }).click()
    await expect(page.getByTestId('workspace-github-panel')).toBeVisible()
    await expect(page.locator('.git-control')).toBeVisible()
    await expect(page.locator('.git-control-empty').getByText('Working tree clean')).toBeVisible()
    await expect(page.getByText('Algo falhou ao renderizar esta janela.')).toHaveCount(0)
    expect(pageErrors).toEqual([])

    await page.screenshot({ path: join(process.cwd(), 'e2e', 'screenshots', '22-orca-shell-source-control.png') })
  } finally {
    await app.close()
  }
})

test('restores a collapsed workspace terminal list after restart', async () => {
  test.setTimeout(120000)
  const testRoot = join(tmpdir(), `oxespace-sidebar-restart-${Date.now()}`)
  const workspaceRoot = join(testRoot, 'demo-repo')
  mkdirSync(workspaceRoot, { recursive: true })
  const env = {
    ...process.env,
    OXESPACE_DISABLE_SINGLE_INSTANCE: '1',
    OXESPACE_E2E_MOCK_NATIVE: '0',
    OXESPACE_DB_PATH: join(testRoot, 'oxespace.sqlite3')
  }
  const args = [join(process.cwd(), 'e2e', 'electron-main.cjs')]
  const firstApp = await electron.launch({ args, env })
  try {
    const page = await firstApp.firstWindow()
    await page.getByTestId('btn-new-workspace').click()
    await page.getByTestId('wizard-dir-input').fill(workspaceRoot)
    await page.getByTestId('wizard-launch-btn').click()
    const toggle = page.locator('.ws-group-expand-btn')
    await expect(toggle).toHaveAttribute('aria-expanded', 'true')
    await toggle.click()
    await expect(toggle).toHaveAttribute('aria-expanded', 'false')
  } finally {
    await firstApp.close()
  }

  const resumedApp = await electron.launch({ args, env })
  try {
    const page = await resumedApp.firstWindow()
    await expect(page.getByTestId('sidebar-workspace-item')).toHaveCount(1)
    await expect(page.locator('.ws-group-expand-btn')).toHaveAttribute('aria-expanded', 'false')
    await expect(page.getByTestId('pane-session-row')).toHaveCount(0)
    await page.locator('.ws-group-expand-btn').click()
    await expect(page.locator('.ws-group-expand-btn')).toHaveAttribute('aria-expanded', 'true')
    await expect(page.getByTestId('pane-session-row')).toHaveCount(4)
  } finally {
    await resumedApp.close()
  }
})
