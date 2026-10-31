import { expect, test } from '@playwright/test'
import { launchApp, openDemoWorkspace, resizeWindow } from './helpers/launch'
import { installThreadFixtures, openThreadWithState, registerThreadProject } from './helpers/thread-fixtures'

/**
 * F15 / B1.4: the project's coordinator. Making a conversation the coordinator asks first (it widens what its agent
 * reaches, and it never answers approvals), pins it at the top of the project, and gives it an overview of the
 * project's other conversations, those waiting for a decision first.
 */
const OTHER = { id: 'e2e-waiting', title: 'Deploy the fix', status: 'approval' }

test('a coordinator: asked for, pinned on top, and an overview of who waits', async () => {
  test.setTimeout(150_000)
  const { app, page, workspaceRoot, consoleErrors } = await launchApp()
  try {
    await resizeWindow(app, 1280, 800)
    await installThreadFixtures(app, workspaceRoot)
    await openDemoWorkspace(page, workspaceRoot)
    await registerThreadProject(app, page, workspaceRoot)
    // Another conversation in the project, waiting for a decision; main keeps the coordinator flag, one per project.
    await app.evaluate(({ ipcMain }, other) => {
      const g = globalThis as Record<string, unknown> & { __coordinatorCalls?: unknown[] }
      g.__coordinatorCalls = []
      const parent = () => (g.e2eThreadSnapshot as () => { thread: Record<string, unknown> } | null)()?.thread
      let otherCoordinator = false
      ipcMain.removeHandler('thread:list')
      ipcMain.handle('thread:list', () => { const thread = parent(); return thread ? [thread, { ...thread, id: other.id, title: other.title, status: other.status, coordinator: otherCoordinator || undefined, createdAt: 1, updatedAt: 1 }] : [] })
      ipcMain.removeHandler('thread:set-coordinator')
      ipcMain.handle('thread:set-coordinator', (_event, id: string, on: boolean) => {
        g.__coordinatorCalls!.push([id, on])
        const thread = parent()
        if (thread) thread.coordinator = id === thread.id && on ? true : undefined
        otherCoordinator = id === other.id && on
      })
    }, OTHER)
    await openThreadWithState(app, page, workspaceRoot, 'conversation')
    await app.evaluate(({ BrowserWindow }, id) => { for (const window of BrowserWindow.getAllWindows()) window.webContents.send('thread:changed', { threadId: id }) }, OTHER.id)
    await expect(page.locator('.thread-navigation-row', { hasText: OTHER.title })).toBeVisible()

    // Make the open conversation the coordinator: asked first, Cancel focused.
    const row = page.locator('.thread-navigation-row', { hasText: 'Authentication flow' })
    await row.getByRole('button', { name: /^Actions for / }).click()
    await page.getByRole('menuitem', { name: 'Make it the coordinator…' }).click()
    const dialog = page.getByTestId('thread-coordinator-confirm')
    await expect(dialog).toContainText('never answers a request or an approval')
    await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeFocused()
    await dialog.getByRole('button', { name: 'Make coordinator' }).click()
    await expect.poll(() => app.evaluate(() => (globalThis as { __coordinatorCalls?: unknown[] }).__coordinatorCalls)).toEqual([['e2e-thread', true]])

    // Pinned on top of the project, with its badge.
    const pinned = page.getByTestId('thread-coordinator-row')
    await expect(pinned).toContainText('Authentication flow')
    await expect(pinned).toContainText('Coordinator')

    // Its overview: the waiting conversation first.
    const overview = page.getByTestId('thread-coordinator-overview')
    await expect(overview).toHaveAccessibleName('Project overview: 1 other conversation, 1 waiting for you')
    await overview.click()
    await expect(page.getByTestId('thread-coordinator-waiting')).toContainText(OTHER.title)
    await page.waitForTimeout(300)
    await page.screenshot({ path: 'test-results/thread-coordinator.png' })
    await page.keyboard.press('Escape')

    // Stopping needs no question.
    await row.getByRole('button', { name: /^Actions for / }).click()
    await page.getByRole('menuitem', { name: 'Stop being the coordinator' }).click()
    await expect(page.getByTestId('thread-coordinator-row')).toHaveCount(0)
    expect(consoleErrors.filter(line => line.startsWith('pageerror'))).toEqual([])
  } finally {
    await app.close()
  }
})
