import { modeButton } from './helpers/modes'
import { expect, test } from '@playwright/test'
import { launchApp, openDemoWorkspace, resizeWindow } from './helpers/launch'
import { installThreadFixtures, registerThreadProject } from './helpers/thread-fixtures'

/**
 * T40 (B20, X17; DESIGN option A on #442), end to end in the real renderer: the conversation's own PR merged, so a toast
 * says it will be archived. Leaving OxeChat withdraws it and archives nothing; back on the conversation it comes again,
 * its time runs out, the conversation is archived and that is said; then it is restored from Archived in the sidebar.
 * Main is the fixture's stand-in (as in thread-worktree.spec.ts), so git and GitHub are not run here.
 */
test('a merged PR archives its conversation when the toast runs out, never off screen, and Archived restores it', async () => {
  test.setTimeout(120_000)
  const { app, page, workspaceRoot } = await launchApp()
  try {
    await resizeWindow(app, 1440, 900)
    await installThreadFixtures(app, workspaceRoot)
    await openDemoWorkspace(page, workspaceRoot)
    await registerThreadProject(app, page, workspaceRoot)

    await app.evaluate(({ ipcMain, BrowserWindow }, { root }) => {
      const g = globalThis as Record<string, unknown>
      const threads: Record<string, unknown>[] = []
      const calls = { commands: [] as string[], kept: [] as unknown[] }
      g.archiveCalls = calls
      const changed = (id: string) => { for (const window of BrowserWindow.getAllWindows()) window.webContents.send('thread:changed', { threadId: id }) }
      for (const channel of ['list', 'read', 'create', 'command', 'keep-after-pr']) ipcMain.removeHandler(`thread:${channel}`)
      ipcMain.removeHandler('github:get-pull-request-status')
      ipcMain.handle('thread:list', () => threads)
      ipcMain.handle('thread:read', (_event, id) => ({ thread: threads.find(thread => thread.id === id), events: [] }))
      ipcMain.handle('thread:create', (_event, input) => {
        const path = `${root}-worktrees/feature-e2e-ab12`
        const thread = { id: `t${threads.length + 1}`, workspaceId: g.e2eWorkspaceId, projectId: 'e2e-project', rootPath: path, provider: input.provider,
          nativeSessionId: null, title: 'New conversation', pinned: false, status: 'idle', createdAt: 1, updatedAt: 1,
          ownedWorktree: { path, branch: 'feature/e2e', projectRoot: root, baseSha: 'a'.repeat(40), createdAt: 1 } }
        threads.push(thread); changed(String(thread.id)); return { thread, events: [] }
      })
      ipcMain.handle('thread:command', (_event, id, text) => {
        calls.commands.push(String(text))
        const thread = threads.find(value => value.id === id)
        if (thread && text === '/archive confirm') { thread.archived = true; changed(String(id)) }
        if (thread && text === `/resume ${id}`) { thread.archived = false; changed(String(id)) }
        return { kind: 'navigate' }
      })
      ipcMain.handle('thread:keep-after-pr', (_event, id, number) => { calls.kept.push([id, number]) })
      ipcMain.handle('github:get-pull-request-status', () => ({ number: 41, title: 'Fix login', state: 'MERGED', isDraft: false, url: null, headRefName: 'feature/e2e',
        baseRefName: 'main', mergeable: null, reviewDecision: null, autoMerge: false, checks: [] }))
    }, { root: workspaceRoot })
    const calls = () => app.evaluate(() => (globalThis as Record<string, unknown>).archiveCalls as { commands: string[]; kept: unknown[] })
    const archived = async () => (await calls()).commands.filter(command => command === '/archive confirm').length

    await modeButton(page, 'thread').click()
    await page.getByRole('button', { name: 'New conversation in repo' }).click()
    const dialog = page.getByRole('dialog', { name: 'New conversation' })
    await dialog.getByRole('checkbox', { name: 'Work in an isolated worktree' }).check()
    await dialog.getByLabel('Branch').fill('feature/e2e')
    await dialog.getByRole('button', { name: 'Create conversation', exact: true }).click()
    // The pointer away from the corner: hovering the toast would rightly hold its timer.
    await page.mouse.move(10, 450)

    const toast = page.locator('[data-toast]').filter({ hasText: 'Pull request #41 was merged' })
    await expect(toast).toBeVisible()
    await expect(toast).toContainText('This conversation will be archived. You can restore it from Archived in the sidebar.')
    await expect(toast.getByRole('button', { name: 'Keep' })).toBeVisible()
    await page.screenshot({ path: test.info().outputPath('pr-merged-toast.png') })

    // Leaving OxeChat withdraws it: nothing is archived while the conversation is not on screen.
    await modeButton(page, 'code').click()
    await expect(toast).toHaveCount(0)
    await page.waitForTimeout(11_000)
    expect(await archived()).toBe(0)

    // Back on the conversation: it comes again with a fresh timer, and its end archives the conversation.
    await modeButton(page, 'thread').click()
    await page.mouse.move(10, 450)
    await expect(toast).toBeVisible()
    await expect(page.locator('[data-toast]').filter({ hasText: 'Conversation archived' })).toBeVisible({ timeout: 15_000 })
    expect(await archived()).toBe(1)
    expect((await calls()).kept).toEqual([])
    await page.screenshot({ path: test.info().outputPath('pr-archived-toast.png') })

    // Restored from Archived in the sidebar, as the toast said.
    await page.getByRole('region', { name: /Archived/ }).getByRole('button', { name: /^Archived/ }).click()
    await page.locator('.thread-archived-row').getByRole('button').first().click()
    await expect.poll(async () => (await calls()).commands).toContain('/resume t1')
    await expect(page.locator('.thread-archived-row')).toHaveCount(0)
  } finally {
    await app.close()
  }
})
