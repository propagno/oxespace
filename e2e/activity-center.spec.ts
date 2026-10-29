import { _electron as electron, expect, test } from '@playwright/test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

test('the activity center lists what needs you, opens it, and marks everything read', async () => {
  test.setTimeout(90_000)
  const root = mkdtempSync(join(tmpdir(), 'oxe-activity-'))
  const app = await electron.launch({ args: [join(process.cwd(), 'e2e/electron-main.cjs')], env: {
    ...process.env, OXESPACE_DISABLE_SINGLE_INSTANCE: '1', OXESPACE_E2E_MOCK_NATIVE: '1', OXESPACE_DB_PATH: join(root, 'db.sqlite3')
  } })
  try {
    const page = await app.firstWindow()
    await page.waitForURL(/index\.html/)
    // Two conversations already waiting for a decision when the app opens.
    await app.evaluate(({ ipcMain }) => {
      const now = Date.now()
      const thread = (id: string, title: string) => ({ id, workspaceId: '', projectId: 'project', rootPath: '/repo', provider: 'codex', nativeSessionId: null, title, pinned: false, status: 'approval', createdAt: now, updatedAt: now })
      const threads = [thread('t-login', 'Fix the login bug'), thread('t-docs', 'Update the docs')]
      for (const channel of ['thread:list', 'thread:pending-requests-all', 'thread:read']) ipcMain.removeHandler(channel)
      ipcMain.handle('thread:list', () => threads)
      ipcMain.handle('thread:pending-requests-all', () => threads.map((item, index) => ({ threadId: item.id, workspaceId: '', threadTitle: item.title, requestId: `r-${index}`, kind: 'approval', title: index ? 'Edit README.md' : 'Run npm test', createdAt: now - index * 1000 })))
      ipcMain.handle('thread:read', (_event, id: string) => ({ thread: threads.find(item => item.id === id) ?? threads[0], events: [], turns: [] }))
    })
    await page.reload()
    await app.evaluate(({ BrowserWindow }) => { const window = BrowserWindow.getAllWindows()[0]; window.show(); window.focus() })
    await page.getByTestId('btn-new-workspace').waitFor({ state: 'visible' })

    const bell = page.getByTestId('activity-bell')
    await expect(page.getByTestId('activity-count')).toHaveText('2')
    await expect(bell).toHaveAccessibleName('Activity, 2 unread')

    // The shortcut opens it, grouped under "Needs you". Nothing in it approves anything.
    await page.locator('[data-testid="btn-open-tools"]:visible').focus()
    await page.keyboard.press('Control+Shift+A')
    const center = page.getByTestId('activity-center')
    await expect(center).toBeVisible()
    const needsYou = center.getByRole('region', { name: 'Needs you' })
    await expect(needsYou.getByTestId('activity-item')).toHaveCount(2)
    await expect(needsYou).toContainText('Fix the login bug')
    await expect(needsYou).toContainText('Run npm test')
    await expect(center.getByRole('button', { name: /approve|allow|accept/i })).toHaveCount(0)
    await page.waitForTimeout(300)
    await page.screenshot({ path: 'test-results/activity-center.png' })

    // A click goes to the conversation and marks that entry read.
    await needsYou.getByRole('button', { name: /Fix the login bug/ }).click()
    await expect(center).toBeHidden()
    await expect(page.getByRole('button', { name: 'Thread', exact: true })).toHaveAttribute('aria-pressed', 'true')
    await expect(page.getByTestId('activity-count')).toHaveText('1')

    // The palette command opens it again; "Mark all as read" clears the count.
    await page.locator('[data-testid="btn-open-tools"]:visible').focus().catch(() => undefined)
    await page.keyboard.press('Control+k')
    const input = page.locator('input[placeholder="Search files and commands…"]')
    await expect(input).toBeVisible()
    await input.fill('activity center')
    await page.getByRole('option', { name: /Open activity center/ }).click()
    await expect(center).toBeVisible()
    await center.page().getByRole('button', { name: 'Mark all as read' }).click()
    await expect(page.getByTestId('activity-count')).toHaveCount(0)
    await expect(bell).toHaveAccessibleName('Activity')
  } finally {
    await Promise.race([app.close().catch(() => undefined), new Promise(resolve => setTimeout(resolve, 4000))])
  }
})
