import { expect, test, type Page } from '@playwright/test'
import { launchApp, openDemoWorkspace } from './helpers/launch'

/**
 * Connectivity (app:connectivity, mocked per run with OXESPACE_E2E_OFFLINE) and About OXESpace (app:about) in the real
 * renderer. Offline shows in the status bar and goes away when the main process says the network is back; About opens
 * from the Help menu and from the palette with the build facts.
 */
const statusBar = (page: Page) => page.locator('.app-statusbar')

test('offline shows in the status bar, and online removes it', async () => {
  test.setTimeout(120_000)
  process.env.OXESPACE_E2E_OFFLINE = '1'
  const { app, page, workspaceRoot, consoleErrors } = await launchApp()
  delete process.env.OXESPACE_E2E_OFFLINE
  try {
    await openDemoWorkspace(page, workspaceRoot)
    const indicator = page.getByTestId('offline-indicator')
    await expect(indicator).toBeVisible()
    await expect(indicator).toHaveText('You are offline')
    await expect(indicator).toHaveAttribute('role', 'status')
    await expect(statusBar(page).getByTestId('offline-indicator')).toHaveCount(1)
    // The main process pushes the change; the window follows it.
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.send('app:connectivity-changed', { state: 'online', checkedAt: Date.now() }))
    await expect(indicator).toHaveCount(0)
    expect(consoleErrors.filter(line => line.startsWith('pageerror:'))).toEqual([])
  } finally {
    await app.close()
  }
})

test('About OXESpace opens from the Help menu and the palette with the build facts', async () => {
  test.setTimeout(120_000)
  const { app, page, consoleErrors } = await launchApp()
  try {
    await page.getByRole('button', { name: 'Application menu' }).click()
    const help = page.locator('[role="menu"]').first().getByRole('menuitem', { name: 'Help', exact: true })
    await help.hover()
    await help.press('ArrowRight').catch(() => undefined)
    await page.getByRole('menuitem', { name: /^About OXESpace/ }).click()
    const about = page.getByRole('dialog', { name: 'About OXESpace' })
    await expect(about).toBeVisible()
    await expect(about).toContainText('e2e0000')
    await expect(about).toContainText('Development')
    await expect(about.getByRole('button', { name: /Third-party licenses/ })).toBeVisible()
    await about.getByRole('button', { name: 'Copy details' }).click()
    await expect(page.getByText('Build details copied')).toBeVisible()
    await about.getByRole('button', { name: 'Close' }).last().click()
    await expect(about).toHaveCount(0)

    await page.keyboard.press('Control+k')
    await page.keyboard.insertText('About OXESpace')
    await page.locator('[cmdk-item]', { hasText: 'About OXESpace' }).first().click()
    await expect(page.getByRole('dialog', { name: 'About OXESpace' })).toBeVisible()
    expect(consoleErrors.filter(line => line.startsWith('pageerror:'))).toEqual([])
  } finally {
    await app.close()
  }
})
