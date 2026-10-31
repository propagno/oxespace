import { expect, test } from '@playwright/test'
import { scanSurface } from './helpers/a11y'
import { launchApp, openDemoWorkspace, resizeWindow } from './helpers/launch'

/**
 * F25: a quarantined MCP server (one that changed after it was trusted) is hard to miss and never trusted by accident.
 * The `quarantine` fixture (electron/main/e2e/mcp-fixture.ts) lists two quarantined servers, one never trusted and one
 * trusted; nothing runs. The top bar and the activity center point at them, the Installed tab counts them, each row
 * has an alert chip, and Test is replaced by "Trust again…", a confirmation that shows what changed with Cancel first.
 */
test('quarantined MCP servers: counted, flagged, in the activity center, and trusted again only after a confirmation', async () => {
  test.setTimeout(120_000)
  const { app, page, workspaceRoot, consoleErrors } = await launchApp({ env: { OXESPACE_E2E_MCP_FIXTURE: 'quarantine' } })
  try {
    await resizeWindow(app, 1280, 800)
    await openDemoWorkspace(page, workspaceRoot)

    // The top bar's MCP button carries the count, and says it in its name.
    const mcpButton = page.getByTestId('workspace-topbar-mcp')
    await expect(page.getByTestId('workspace-topbar-mcp-quarantined')).toHaveText('2')
    await expect(mcpButton).toHaveAccessibleName('Open MCP servers: 2 quarantined')
    // Visible, not only in the name, also in a narrow window where the button labels are hidden.
    await expect(page.getByTestId('workspace-topbar-mcp-quarantined')).toBeVisible()
    await resizeWindow(app, 820, 700)
    await expect(page.getByTestId('workspace-topbar-mcp-quarantined')).toBeVisible()
    const box = (await page.getByTestId('workspace-topbar-mcp').boundingBox())!
    await page.screenshot({ path: 'test-results/mcp-topbar-badge-narrow.png', clip: { x: box.x - 8, y: box.y - 8, width: box.width + 16, height: box.height + 16 } })
    await resizeWindow(app, 1280, 800)

    // The activity center has one "needs you" entry per quarantined server, and it leads to the MCP panel.
    await page.getByTestId('activity-bell').click()
    const center = page.getByTestId('activity-center')
    const needsYou = center.getByRole('region', { name: 'Needs you' })
    await expect(needsYou).toContainText('docs-search is quarantined')
    await expect(needsYou).toContainText('deploy-helper is quarantined')
    await needsYou.getByRole('button', { name: /docs-search is quarantined/ }).click()

    const panel = page.locator('.mcp-panel-list').first()
    await page.getByRole('tab', { name: /Installed/ }).click()
    await expect(page.getByTestId('mcp-installed-quarantined')).toHaveText('2 quarantined')
    await expect(page.getByTestId('mcp-quarantine-chip')).toHaveCount(2)
    await expect(panel.getByRole('button', { name: 'Trust docs-search again' })).toBeVisible()
    // docs-search listed 2 tools; while quarantined it offers none.
    await expect(panel.locator('.mcp-server-row', { hasText: 'docs-search' }).getByTestId('mcp-server-tools')).toHaveText('No tools while quarantined')
    await page.waitForTimeout(300)
    await page.screenshot({ path: 'test-results/mcp-quarantine-installed.png' })

    // Trust again asks first: what changed, the instructions hidden in a description, and Cancel focused.
    await panel.getByRole('button', { name: 'Trust docs-search again' }).click()
    const dialog = page.getByTestId('mcp-trust-again')
    await expect(dialog).toBeVisible()
    await expect(dialog.getByTestId('mcp-quarantine')).toContainText('upload_file')
    await expect(dialog.getByTestId('mcp-description-warning')).toBeVisible()
    await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeFocused()
    await page.waitForTimeout(300)
    await page.screenshot({ path: 'test-results/mcp-trust-again.png' })
    const dialogFindings = await scanSurface(page, 'mcp-trust-again')
    // Only what this feature draws: the dialog and the panel behind it.
    expect(dialogFindings.filter(item => item.nodes.some(node => /mcp|dialog/i.test(node)))).toEqual([])
    // Enter on the focused Cancel trusts nothing.
    await page.keyboard.press('Enter')
    await expect(dialog).toHaveCount(0)
    await expect(page.getByTestId('mcp-quarantine-chip')).toHaveCount(2)

    // deploy-helper's configuration changed: its confirmation shows what it runs now.
    await panel.getByRole('button', { name: 'Trust deploy-helper again' }).click()
    await expect(dialog.getByTestId('mcp-runs-now-command')).toContainText('--target dev --token [redacted]')
    await expect(dialog.getByTestId('mcp-runs-now-command')).toContainText('--target staging')
    await page.waitForTimeout(300)
    await page.screenshot({ path: 'test-results/mcp-trust-again-config.png' })
    await dialog.getByRole('button', { name: 'Cancel' }).click()
    await expect(dialog).toHaveCount(0)

    // Confirming trusts it again and tests it: one fewer everywhere.
    await panel.getByRole('button', { name: 'Trust docs-search again' }).click()
    await dialog.getByRole('button', { name: 'Trust again and test' }).click()
    await expect(dialog).toHaveCount(0)
    await expect(page.getByTestId('mcp-installed-quarantined')).toHaveText('1 quarantined')
    await expect(panel.getByRole('button', { name: 'Trust docs-search again' })).toHaveCount(0)
    // The MCP panel is modal: close it, then the top bar and the activity center say one.
    await page.keyboard.press('Escape')
    await expect(page.getByTestId('workspace-topbar-mcp-quarantined')).toHaveText('1')
    await page.getByTestId('activity-bell').click()
    await expect(center.getByRole('region', { name: 'Needs you' })).not.toContainText('docs-search is quarantined')
    await expect(center.getByRole('region', { name: 'Needs you' })).toContainText('deploy-helper is quarantined')

    expect(consoleErrors.filter(line => line.startsWith('pageerror'))).toEqual([])
  } finally {
    await app.close()
  }
})
