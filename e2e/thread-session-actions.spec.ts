import { _electron as electron, expect, test } from '@playwright/test'
import { mkdtempSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

test('session actions open to the side, archive, restore and delete through Electron IPC', async () => {
  test.setTimeout(60_000)
  const root = mkdtempSync(join(tmpdir(), 'oxe-thread-actions-'))
  const repo = join(root, 'repo'); mkdirSync(repo)
  const app = await electron.launch({ args: [join(process.cwd(), 'e2e/electron-main.cjs')], env: {
    ...process.env, OXESPACE_DISABLE_SINGLE_INSTANCE: '1', OXESPACE_E2E_MOCK_NATIVE: '1', OXESPACE_DB_PATH: join(root, 'db.sqlite3')
  } })
  try {
    const page = await app.firstWindow()
    await page.setViewportSize({ width: 1280, height: 800 })
    await page.getByTestId('btn-new-workspace').click()
    await page.getByTestId('wizard-dir-input').fill(repo)
    await page.getByTestId('wizard-layout-card-1').click()
    await page.getByTestId('wizard-launch-btn').click()
    await app.evaluate(({ ipcMain, BrowserWindow }, rootPath) => {
      const threads: Record<string, unknown>[] = []
      const changed = (id: string) => { for (const window of BrowserWindow.getAllWindows()) window.webContents.send('thread:changed', { threadId: id }) }
      for (const channel of ['list', 'read', 'create', 'command', 'commands', 'projects', 'models']) ipcMain.removeHandler(`thread:${channel}`)
      ipcMain.handle('thread:projects', () => ({ projects: [{ projectId: 'test-project', displayName: 'repo', identityLabel: rootPath, hidden: false, contexts: [{ workspaceId: 'thread:test-project', rootPath, label: 'repo' }] }], unavailable: [] }))
      ipcMain.handle('thread:commands', () => ({ commands: [] }))
      ipcMain.handle('thread:models', () => ({ defaultModel: 'test-model', models: [{ id: 'test-model', label: 'Test model', description: '', efforts: ['low'], defaultEffort: 'low' }] }))
      ipcMain.handle('thread:list', () => threads)
      ipcMain.handle('thread:read', (_event, id) => ({ thread: threads.find(thread => thread.id === id), events: [] }))
      ipcMain.handle('thread:create', (_event, input) => {
        const thread = { id: `session-${threads.length + 1}`, workspaceId: 'thread:test-project', projectId: 'test-project', rootPath, provider: input.provider, nativeSessionId: null, title: 'New thread', status: 'idle', pinned: false, createdAt: Date.now(), updatedAt: Date.now() }
        threads.push(thread); changed(String(thread.id)); return { thread, events: [] }
      })
      ipcMain.handle('thread:command', (_event, id, command) => {
        const thread = threads.find(value => value.id === id)
        if (!thread) throw Error('Conversation not found')
        if (command.startsWith('/rename ')) thread.title = command.slice(8)
        else if (command === '/archive confirm') thread.archived = true
        else if (command === `/resume ${id}`) thread.archived = false
        else if (command === '/delete confirm') threads.splice(threads.indexOf(thread), 1)
        changed(id)
        return { kind: 'navigate', threadId: id }
      })
    }, repo)
    await page.evaluate(async () => {
      for (const name of ['Alpha session', 'Beta session']) {
        const snapshot = await window.oxe.thread!.create({ projectId: 'test-project', provider: 'codex' })
        await window.oxe.thread!.command!(snapshot.thread.id, `/rename ${name}`)
      }
    })
    await page.getByRole('button', { name: 'Thread', exact: true }).click()
    const alpha = page.locator('.thread-navigation-row:not(.thread-archived-row) .thread-navigation-item').filter({ hasText: 'Alpha session' })
    const beta = page.locator('.thread-navigation-row:not(.thread-archived-row) .thread-navigation-item').filter({ hasText: 'Beta session' })
    await expect(alpha).toBeVisible()
    await expect(beta).toBeVisible()
    await alpha.click()
    await page.getByRole('button', { name: 'Actions for Alpha session' }).click()
    await page.getByRole('menuitem', { name: 'Open to the side' }).click()
    await expect(page.getByRole('group', { name: 'Side-by-side conversations' })).toBeVisible()
    await expect(page.locator('.thread-cell')).toHaveCount(2)
    await page.getByRole('button', { name: 'Close side-by-side conversation' }).click()

    await page.getByRole('button', { name: 'Actions for Alpha session' }).click()
    await page.getByRole('menuitem', { name: 'Archive conversation' }).click()
    await page.getByRole('dialog', { name: 'Archive conversation' }).getByRole('button', { name: 'Archive conversation', exact: true }).click()
    await expect(alpha).toHaveCount(0)
    const archived = page.getByRole('region', { name: 'Archived conversations' })
    await expect(archived.getByRole('button', { name: 'Archived 1' })).toBeVisible()
    if (await archived.getByRole('button', { name: 'Archived 1' }).getAttribute('aria-expanded') === 'false') await archived.getByRole('button', { name: 'Archived 1' }).click()
    await archived.getByRole('button', { name: 'Restore Alpha session' }).click()
    await expect(alpha).toBeVisible()

    await page.getByRole('button', { name: 'Actions for Beta session' }).click()
    await page.getByRole('menuitem', { name: 'Delete conversation' }).click()
    await page.getByRole('dialog', { name: 'Delete thread' }).getByRole('button', { name: 'Delete thread', exact: true }).click()
    await expect(beta).toHaveCount(0)
    await expect(alpha).toBeVisible()
    await page.screenshot({ path: test.info().outputPath('thread-session-actions.png') })
  } finally { await app.close() }
})
