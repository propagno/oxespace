import { expect, test } from '@playwright/test'
import { launchApp, openDemoWorkspace, resizeWindow } from './helpers/launch'
import { installThreadFixtures, openThreadWithState, registerThreadProject } from './helpers/thread-fixtures'

/**
 * F15 / B1.3: nested conversations. A conversation started by another shows under it in the list, the parent's
 * header lists its children (from main's `thread:children`, seeded by OXESPACE_E2E_THREAD_CHILDREN) with a way to
 * each, here or beside it, and archiving a parent whose children still work asks again before taking them along.
 */
const CHILD = { id: 'e2e-child', title: 'Write the tests', status: 'running', via: 'thread_create', archived: false, updatedAt: 1 }

test('a conversation and the ones it started: tree, list, open beside, and archive with them', async () => {
  test.setTimeout(150_000)
  const { app, page, workspaceRoot, consoleErrors } = await launchApp({ env: { OXESPACE_E2E_THREAD_CHILDREN: JSON.stringify({ 'e2e-thread': [CHILD] }) } })
  try {
    await resizeWindow(app, 1280, 800)
    await installThreadFixtures(app, workspaceRoot)
    await openDemoWorkspace(page, workspaceRoot)
    await registerThreadProject(app, page, workspaceRoot)
    // Before the conversation exists: the list will carry its child, started by the open conversation; archiving answers like main does (B1.3).
    await app.evaluate(({ ipcMain }, child) => {
      const g = globalThis as Record<string, unknown> & { __archiveCommands?: string[] }
      g.__archiveCommands = []
      ipcMain.removeHandler('thread:list')
      ipcMain.handle('thread:list', () => {
        const parent = (g.e2eThreadSnapshot as () => { thread: Record<string, unknown> } | null)()?.thread
        return parent ? [parent, { ...parent, id: child.id, title: child.title, status: child.status, nativeSessionId: null, parent: { threadId: 'e2e-thread', via: child.via }, createdAt: 1, updatedAt: 1 }] : []
      })
      ipcMain.removeHandler('thread:command')
      ipcMain.handle('thread:command', (_event, _id: string, text: string) => {
        g.__archiveCommands!.push(text)
        if (text === '/archive confirm') return { kind: 'confirm', refusal: 'hasActiveChildren', confirm: { title: 'x', description: 'x', confirmLabel: 'x', command: '/archive confirm-with-children', childConversations: { active: 1, total: 1 } } }
        return { kind: 'applied' }
      })
    }, CHILD)
    await openThreadWithState(app, page, workspaceRoot, 'conversation')
    // Main announces the new child as it does for any conversation the window does not know yet, so the list reloads.
    await app.evaluate(({ BrowserWindow }, id) => { for (const window of BrowserWindow.getAllWindows()) window.webContents.send('thread:changed', { threadId: id }) }, CHILD.id)


    const childRow = page.locator('.thread-navigation-row', { hasText: CHILD.title })
    await expect(childRow).toHaveAttribute('data-depth', '1')
    const parentRow = page.locator('.thread-navigation-row').filter({ has: page.getByTestId('thread-started-count') })
    await expect(parentRow.getByTestId('thread-started-count')).toHaveText('1')

    // The header lists the children from main, and opens one beside this one.
    const button = page.getByTestId('thread-children-button')
    await expect(button).toHaveAccessibleName('Started 1 conversation: 1 working, 0 waiting for you')
    await button.click()
    const list = page.getByTestId('thread-children-list')
    await expect(list).toContainText(CHILD.title)
    await page.waitForTimeout(300)
    await page.screenshot({ path: 'test-results/thread-children.png' })
    await list.getByRole('button', { name: `Open ${CHILD.title} beside this one` }).click()
    await expect(list).toHaveCount(0)

    // Archiving the parent: main asks again, naming the child still working; confirming takes it along.
    await parentRow.getByRole('button', { name: /^Actions for / }).click()
    await page.getByRole('menuitem', { name: 'Archive conversation' }).click()
    await page.getByRole('dialog').getByRole('button', { name: 'Archive conversation' }).click()
    const again = page.getByRole('dialog', { name: 'Archive this conversation and the ones it started?' })
    await expect(again).toContainText('1 conversation that')
    await again.getByRole('button', { name: 'Archive all' }).click()
    await expect.poll(() => app.evaluate(() => (globalThis as { __archiveCommands?: string[] }).__archiveCommands)).toEqual(['/archive confirm', '/archive confirm-with-children'])

    expect(consoleErrors.filter(line => line.startsWith('pageerror'))).toEqual([])
  } finally {
    await app.close()
  }
})
