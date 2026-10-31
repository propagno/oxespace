import { modeButton } from './helpers/modes'
import { expect, test } from '@playwright/test'
import { launchApp, openDemoWorkspace, resizeWindow } from './helpers/launch'
import { installThreadFixtures, registerThreadProject } from './helpers/thread-fixtures'

/**
 * A conversation in its own worktree, end to end in the real renderer: the option in the new-thread dialog
 * (off at first, remembered afterwards), the branch and badge in the conversation header, and the question
 * asked before an archive. The main process is the fixture's stand-in, so git itself is not run here; the
 * worktree lifecycle against a real repository is covered by tests/integration/thread-worktree-lifecycle.test.ts.
 */
test('a conversation can work in its own worktree, shows its branch, and is cleaned up on archive', async () => {
  test.setTimeout(120_000)
  const { app, page, workspaceRoot } = await launchApp()
  try {
    // The header folds its context row away at 700px or less. Windows runners cap the window at a small screen, so the
    // page is zoomed out to give the layout room, and the width is checked below before anything relies on it.
    await resizeWindow(app, 1440, 900)
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.setZoomFactor(0.8))
    await installThreadFixtures(app, workspaceRoot)
    await openDemoWorkspace(page, workspaceRoot)
    await registerThreadProject(app, page, workspaceRoot)

    // A thread store of its own, so a created conversation can carry the worktree it was made in.
    await app.evaluate(({ ipcMain, BrowserWindow }, { root }) => {
      const g = globalThis as Record<string, unknown>
      const threads: Record<string, unknown>[] = []
      const calls = { create: [] as unknown[], finish: [] as unknown[], inspect: 0 }
      g.worktreeCalls = calls
      const changed = (id: string) => { for (const window of BrowserWindow.getAllWindows()) window.webContents.send('thread:changed', { threadId: id }) }
      for (const channel of ['list', 'read', 'create', 'command', 'worktree-inspect', 'worktree-finish']) ipcMain.removeHandler(`thread:${channel}`)
      for (const channel of ['git:get-status']) ipcMain.removeHandler(channel)
      ipcMain.handle('git:get-status', () => ({ branch: threads.at(-1)?.ownedWorktree ? 'feature/e2e' : 'main', ahead: 0, behind: 0, checkedAt: 1, files: [] }))
      ipcMain.handle('thread:list', () => threads)
      ipcMain.handle('thread:read', (_event, id) => ({ thread: threads.find(thread => thread.id === id), events: [] }))
      ipcMain.handle('thread:create', (_event, input) => {
        calls.create.push(input)
        const path = `${root}-worktrees/feature-e2e-ab12`
        const thread = { id: `t${threads.length + 1}`, workspaceId: g.e2eWorkspaceId, projectId: 'e2e-project', rootPath: input.worktree ? path : root, provider: input.provider,
          nativeSessionId: null, title: 'New conversation', pinned: false, status: 'idle', createdAt: 1, updatedAt: 1,
          ...(input.worktree ? { ownedWorktree: { path, branch: input.worktree.branch ?? 'thread/generated', projectRoot: root, baseSha: 'a'.repeat(40), createdAt: 1 } } : {}) }
        threads.push(thread); changed(String(thread.id)); return { thread, events: [] }
      })
      ipcMain.handle('thread:command', (_event, id, text) => {
        const thread = threads.find(value => value.id === id)
        if (thread && text === '/archive confirm') { thread.archived = true; changed(String(id)) }
        return { kind: 'navigate' }
      })
      ipcMain.handle('thread:worktree-inspect', (_event, id) => {
        calls.inspect++
        const thread = threads.find(value => value.id === id) as { ownedWorktree?: unknown } | undefined
        const state = { missing: false, uncommitted: 0, untracked: 0, unpushed: 0 }
        return thread?.ownedWorktree ? { owned: thread.ownedWorktree, state, decision: { kind: 'remove' } } : null
      })
      ipcMain.handle('thread:worktree-finish', (_event, id, action, choice) => {
        calls.finish.push([id, action, choice])
        const thread = threads.find(value => value.id === id)
        if (thread) { thread.archived = true; changed(String(id)) }
        return { removed: true }
      })
    }, { root: workspaceRoot })

    await modeButton(page, 'thread').click()
    await page.getByRole('button', { name: 'New conversation in repo' }).click()
    const dialog = page.getByRole('dialog', { name: 'New conversation' })
    const option = dialog.getByRole('checkbox', { name: 'Work in an isolated worktree' })
    // Off until the person turns it on.
    await expect(option).not.toBeChecked()
    await option.check()
    await dialog.getByLabel('Branch').fill('feature/e2e')
    await page.screenshot({ path: test.info().outputPath('new-thread-worktree-option.png') })
    await dialog.getByRole('button', { name: 'Create conversation', exact: true }).click()

    // The conversation shows the branch it works on and that it is a worktree.
    const heading = page.locator('.thread-heading')
    const headingWidth = await heading.evaluate(element => element.getBoundingClientRect().width)
    expect(headingWidth, 'the header must be wider than its 700px fold for this check').toBeGreaterThan(700)
    await expect(heading.locator('.thread-heading-branch')).toHaveText('feature/e2e')
    await expect(heading.locator('.thread-heading-branch')).toBeVisible()
    await expect(heading.locator('.thread-heading-worktree')).toBeVisible()
    await page.screenshot({ path: test.info().outputPath('thread-header-worktree-branch.png') })
    const calls = () => app.evaluate(() => (globalThis as Record<string, unknown>).worktreeCalls as { create: unknown[]; finish: unknown[] })
    expect((await calls()).create).toEqual([{ projectId: 'e2e-project', rootPath: workspaceRoot, provider: 'claude', worktree: { branch: 'feature/e2e' } }])

    // The choice is remembered for this project.
    await page.getByRole('button', { name: 'New conversation in repo' }).click()
    await expect(page.getByRole('dialog', { name: 'New conversation' }).getByRole('checkbox', { name: 'Work in an isolated worktree' })).toBeChecked()
    await page.getByRole('dialog', { name: 'New conversation' }).getByRole('button', { name: 'Cancel' }).click()

    // Archiving asks about the worktree first; an empty one goes with the conversation.
    const composer = page.locator('.thread-composer textarea')
    await composer.fill('/archive')
    await composer.press('Enter')
    const question = page.getByRole('dialog', { name: 'Archive this conversation?' })
    await expect(question.getByText(/has no changes, so it is removed together with the conversation/)).toBeVisible()
    await question.getByRole('button', { name: 'Archive and remove worktree' }).click()
    await expect(question).toHaveCount(0)
    expect((await calls()).finish).toEqual([['t1', 'archive', 'auto']])
  } finally {
    await app.close()
  }
})
