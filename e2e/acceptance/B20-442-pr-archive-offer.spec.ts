import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { launchApp, openDemoWorkspace, resizeWindow } from '../helpers/launch'
import { installThreadFixtures, openThreadWithState, registerThreadProject } from '../helpers/thread-fixtures'

/**
 * B20 · #442 → #486 (automatic, X17 option A) · When the PR of a conversation's own worktree closes or merges, a toast
 * says it will be archived and offers Keep; when its time runs out (≥10 s, paused on hover or focus) the conversation is
 * archived and a second toast offers Restore. Over the Thread fixture (no agent), with the PR status mocked in main:
 * - an open PR, or one on another branch: nothing;
 * - leaving OxeChat withdraws the toast and archives nothing; coming back offers it again;
 * - hovering the toast pauses it;
 * - Keep, ✕ and Escape keep the conversation (thread:keep-after-pr), nothing archived;
 * - the timeout archives; "Conversation archived" offers Restore.
 */
const BRANCH = 'feat/hml-b20'
type Calls = { keep: Array<[string, number]>; commands: string[] }

async function stubs(app: ElectronApplication) {
  await app.evaluate(({ ipcMain }) => {
    const g = globalThis as Record<string, unknown>
    g.prStatus = null; g.calls = { keep: [], commands: [] }; g.reads = 0
    for (const ch of ['github:get-pull-request-status', 'thread:keep-after-pr', 'thread:command']) ipcMain.removeHandler(ch)
    ipcMain.handle('github:get-pull-request-status', () => { g.reads = (g.reads as number) + 1; return g.prStatus })
    ipcMain.handle('thread:keep-after-pr', (_e, id: string, n: number) => { (g.calls as Calls).keep.push([id, n]) })
    ipcMain.handle('thread:command', (_e, _id: string, text: string) => { (g.calls as Calls).commands.push(text); return { kind: 'applied' } })
  })
}
const setPr = (app: ElectronApplication, number: number, state: 'OPEN' | 'MERGED' | 'CLOSED', head = BRANCH) => app.evaluate((_c, s) => {
  (globalThis as Record<string, unknown>).prStatus = { number: s.number, title: 'HML', state: s.state, isDraft: false, url: null, headRefName: s.head, baseRefName: 'main', mergeable: null, reviewDecision: null, autoMerge: false, checks: [] }
}, { number, state, head })
const calls = (app: ElectronApplication) => app.evaluate(() => (globalThis as Record<string, unknown>).calls as Calls)
const archives = async (app: ElectronApplication) => (await calls(app)).commands.filter(c => /archive/i.test(c)).length
/** The PR bar reads on focus; the CI window can report itself hidden, which pauses reads (and toasts), unlike a person's. */
const read = async (page: Page) => {
  await page.evaluate(() => { Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' }); document.dispatchEvent(new Event('visibilitychange')); window.dispatchEvent(new Event('focus')) })
  await page.waitForTimeout(1_200)
}
const offer = (page: Page) => page.locator('[data-toast]').filter({ hasText: /will be archived/ })
const archivedToast = (page: Page) => page.locator('[data-toast]').filter({ hasText: /Conversation archived/ })

test('B20/#486: the automatic archive after a PR closes or merges, with Keep, pause and Restore', async () => {
  test.setTimeout(300_000)
  const { app, page, workspaceRoot, consoleErrors } = await launchApp({ locale: 'en-US' })
  const log: Record<string, unknown> = {}
  try {
    await resizeWindow(app, 1280, 860)
    await installThreadFixtures(app, workspaceRoot)
    await openDemoWorkspace(page, workspaceRoot)
    await registerThreadProject(app, page, workspaceRoot)
    await openThreadWithState(app, page, workspaceRoot, 'conversation')
    await stubs(app)
    await app.evaluate((_c, { root, branch }) => {
      ;(globalThis as Record<string, (s: unknown) => void>).applyThreadState({ status: 'idle', title: 'B20', provider: 'claude',
        extra: { ownedWorktree: { path: root, branch, projectRoot: root, baseSha: '0000000', createdAt: Date.now() } },
        events: [{ type: 'message', id: 'u1', role: 'user', text: 'work on the branch' }, { type: 'completed', status: 'completed' }] })
    }, { root: workspaceRoot, branch: BRANCH })
    await page.waitForTimeout(800)
    await page.mouse.move(5, 5)

    await setPr(app, 10, 'OPEN'); await read(page)
    expect.soft(await offer(page).count(), 'an open PR: nothing').toBe(0)
    await setPr(app, 10, 'MERGED', 'someone-else'); await read(page)
    expect.soft(await offer(page).count(), 'a PR on another branch: nothing').toBe(0)

    // Leaving OxeChat withdraws the toast, archives nothing; back, it is offered again.
    await setPr(app, 11, 'MERGED'); await read(page)
    await expect.soft(offer(page), 'PR 11 merged: the toast').toBeVisible({ timeout: 35_000 })
    log.text11 = await offer(page).first().innerText().catch(() => '')
    await page.locator('button[data-app-mode="code"]').first().click()
    await page.waitForTimeout(12_000)
    log.leftCount = await offer(page).count()
    expect.soft(log.leftCount, 'leaving OxeChat withdraws it').toBe(0)
    expect.soft(await archives(app), 'and nothing was archived meanwhile').toBe(0)
    await page.locator('button[data-app-mode="thread"]').first().click(); await page.waitForTimeout(800); await read(page)
    await expect.soft(offer(page), 'back on the conversation: offered again').toBeVisible({ timeout: 35_000 })
    // Escape keeps.
    await offer(page).first().getByRole('button', { name: /^Keep/ }).focus().catch(() => undefined)
    await page.keyboard.press('Escape')
    await expect.soft(offer(page)).toHaveCount(0, { timeout: 5_000 })
    expect.soft((await calls(app)).keep.map(k => k[1]), 'Escape keeps PR 11').toContain(11)
    expect.soft(await archives(app), 'Escape archives nothing').toBe(0)

    // Keep keeps.
    await setPr(app, 12, 'CLOSED'); await read(page)
    await expect.soft(offer(page), 'PR 12 closed: the toast').toBeVisible({ timeout: 35_000 })
    await offer(page).first().getByRole('button', { name: /^Keep/ }).click()
    expect.soft((await calls(app)).keep.map(k => k[1]), 'Keep keeps PR 12').toContain(12)
    expect.soft(await archives(app), 'Keep archives nothing').toBe(0)

    // Hover pauses the timer; then the timeout archives, and Restore is offered.
    await setPr(app, 13, 'MERGED'); await read(page)
    await expect.soft(offer(page), 'PR 13 merged: the toast').toBeVisible({ timeout: 35_000 })
    await offer(page).first().hover()
    await page.waitForTimeout(13_000)
    log.hovered = { visible: await offer(page).count(), archives: await archives(app) }
    expect.soft(log.hovered, 'hovered for 13 s: still there, nothing archived').toEqual({ visible: 1, archives: 0 })
    await page.mouse.move(5, 5)
    await expect.soft(archivedToast(page), 'the timeout archives and says so').toBeVisible({ timeout: 20_000 })
    expect.soft(await archives(app), 'archived once').toBe(1)
    log.archivedText = await archivedToast(page).first().innerText().catch(() => '')
    await archivedToast(page).first().getByRole('button', { name: /^Restore/ }).click().catch(() => undefined)
    await page.waitForTimeout(1_000)
    log.final = await calls(app)
    expect.soft((await calls(app)).commands.some(c => /resume/i.test(c)), 'Restore restores it (/resume)').toBe(true)
    expect.soft(consoleErrors.filter(l => l.startsWith('pageerror')), 'no page error').toEqual([])
  } finally {
    log.reads = await app.evaluate(() => (globalThis as Record<string, unknown>).reads).catch(() => null)
    console.log('B20', JSON.stringify(log))
    await app.close()
  }
})
