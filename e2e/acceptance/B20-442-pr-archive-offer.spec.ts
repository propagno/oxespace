import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { launchApp, openDemoWorkspace, resizeWindow } from '../helpers/launch'
import { installThreadFixtures, openThreadWithState, registerThreadProject } from '../helpers/thread-fixtures'

/**
 * B20 · #442 (T40) · When the pull request of a conversation's own worktree closes or merges, a toast offers Archive.
 * Over the Thread fixture (no agent), with the PR status mocked in main (no GitHub, no auth):
 * - an open PR, or a PR on another branch: nothing;
 * - closed: the toast says so; letting it time out archives nothing, keeps nothing, and the PR is not offered again;
 * - merged, then Escape: kept (thread:keep-after-pr with the number), nothing archived;
 * - leaving the conversation withdraws the offer, and coming back offers it again;
 * - merged, then Archive: the conversation is archived.
 */
const BRANCH = 'feat/hml-b20'
type Calls = { keep: Array<[string, number]>; commands: string[] }

async function stubs(app: ElectronApplication) {
  await app.evaluate(({ ipcMain }) => {
    const g = globalThis as Record<string, unknown>
    g.prStatus = null; g.calls = { keep: [], commands: [] }
    for (const ch of ['github:get-pull-request-status', 'thread:keep-after-pr', 'thread:command']) ipcMain.removeHandler(ch)
    ipcMain.handle('github:get-pull-request-status', () => { g.reads = ((g.reads as number) ?? 0) + 1; return g.prStatus })
    ipcMain.handle('thread:keep-after-pr', (_e, id: string, n: number) => { (g.calls as Calls).keep.push([id, n]) })
    ipcMain.handle('thread:command', (_e, _id: string, text: string) => { (g.calls as Calls).commands.push(text); return { kind: 'applied' } })
  })
}
const setPr = (app: ElectronApplication, number: number, state: 'OPEN' | 'MERGED' | 'CLOSED', head = BRANCH) => app.evaluate((_c, s) => {
  (globalThis as Record<string, unknown>).prStatus = { number: s.number, title: 'HML', state: s.state, isDraft: false, url: null, headRefName: s.head, baseRefName: 'main', mergeable: null, reviewDecision: null, autoMerge: false, checks: [] }
}, { number, state, head })
const calls = (app: ElectronApplication) => app.evaluate(() => (globalThis as Record<string, unknown>).calls as Calls)
/** The PR bar reads on focus (and every 30 s): a focus is the read. */
const read = async (page: Page) => {
  // The CI window can report itself hidden, and the bar skips its focus and 30 s reads then; a person's window is visible.
  await page.evaluate(() => { Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' }); window.dispatchEvent(new Event('focus')) })
  await page.waitForTimeout(1_200)
}
const toast = (page: Page) => page.locator('[data-toast]').filter({ hasText: /Pull request #\d+/ })

test('B20/#442: the archive offer after a PR closes or merges, and only then', async () => {
  test.setTimeout(240_000)
  const { app, page, workspaceRoot, consoleErrors } = await launchApp({ locale: 'en-US' })
  const log: Record<string, unknown> = {}
  try {
    await resizeWindow(app, 1280, 860)
    await installThreadFixtures(app, workspaceRoot)
    await openDemoWorkspace(page, workspaceRoot)
    await registerThreadProject(app, page, workspaceRoot)
    await openThreadWithState(app, page, workspaceRoot, 'conversation')
    await stubs(app)
    const threadId = 'e2e-thread'
    // The conversation has its own worktree on BRANCH.
    await app.evaluate((_c, { root, branch }) => {
      ;(globalThis as Record<string, (s: unknown) => void>).applyThreadState({ status: 'idle', title: 'B20', provider: 'claude',
        extra: { ownedWorktree: { path: root, branch, projectRoot: root, baseSha: '0000000', createdAt: Date.now() } },
        events: [{ type: 'message', id: 'u1', role: 'user', text: 'work on the branch' }, { type: 'completed', status: 'completed' }] })
    }, { root: workspaceRoot, branch: BRANCH })
    await page.waitForTimeout(800)

    await setPr(app, 10, 'OPEN'); await read(page)
    log.openBar = await page.locator('.pr-status-bar').count()
    log.direct = await page.evaluate('window.oxe.github.getPullRequestStatus({ workspaceId: "x", rootPath: "y" }).then(r => r && r.state, e => "error: " + e.message)')
    log.readsAfterOpen = await app.evaluate(() => (globalThis as Record<string, unknown>).reads ?? 0)
    log.visibility = await page.evaluate(() => document.visibilityState)
    expect.soft(await toast(page).count(), 'an open PR offers nothing').toBe(0)
    await setPr(app, 10, 'MERGED', 'someone-else'); await read(page)
    expect.soft(await toast(page).count(), 'a PR on another branch offers nothing').toBe(0)

    // Closed: the toast, then its time runs out (the pointer away from it).
    await page.mouse.move(5, 5)
    await setPr(app, 11, 'CLOSED'); await read(page)
    await expect.soft(toast(page), 'closed: the offer').toBeVisible({ timeout: 35_000 })
    log.closedText = await toast(page).first().innerText().catch(() => '')
    await expect.soft(toast(page), 'the offer times out').toHaveCount(0, { timeout: 15_000 })
    log.afterTimeout = await calls(app)
    expect.soft((await calls(app)).commands.length, 'the timeout archives nothing').toBe(0)
    expect.soft((await calls(app)).keep.length, 'and keeps nothing').toBe(0)
    await read(page)
    expect.soft(await toast(page).count(), 'the same PR is not offered again this session').toBe(0)

    // Merged, then Escape: kept.
    await setPr(app, 12, 'MERGED'); await read(page)
    await expect.soft(toast(page), 'merged: the offer').toBeVisible({ timeout: 35_000 })
    log.mergedText = await toast(page).first().innerText().catch(() => '')
    await toast(page).first().getByRole('button', { name: /Archive/ }).focus().catch(() => undefined)
    await page.keyboard.press('Escape')
    await expect.soft(toast(page), 'Escape closes it').toHaveCount(0, { timeout: 5_000 })
    expect.soft((await calls(app)).keep, 'Escape keeps the conversation for that PR').toEqual([[threadId, 12]])
    expect.soft((await calls(app)).commands.length, 'and archives nothing').toBe(0)

    // Leaving the conversation withdraws the offer; coming back offers it again.
    await setPr(app, 13, 'MERGED'); await read(page)
    await expect.soft(toast(page), 'PR 13 offered').toBeVisible({ timeout: 35_000 })
    await page.locator('button[data-app-mode="code"]').first().click(); await page.waitForTimeout(1_000)
    log.toastAfterLeaving = await toast(page).count()
    expect.soft(log.toastAfterLeaving, 'leaving withdraws the offer').toBe(0)
    await page.locator('button[data-app-mode="thread"]').first().click(); await page.waitForTimeout(1_000)
    await read(page)
    await expect.soft(toast(page), 'coming back offers it again').toBeVisible({ timeout: 35_000 })

    // Archive archives.
    await toast(page).first().getByRole('button', { name: /^Archive/ }).click()
    await page.waitForTimeout(1_500)
    log.final = await calls(app)
    expect.soft((await calls(app)).commands.some(c => /archive/i.test(c)), 'Archive archives the conversation').toBe(true)
    expect.soft(consoleErrors.filter(l => l.startsWith('pageerror')), 'no page error').toEqual([])
  } finally {
    log.reads = await app.evaluate(() => (globalThis as Record<string, unknown>).reads).catch(() => null)
    console.log('B20', JSON.stringify(log))
    await app.close()
  }
})
