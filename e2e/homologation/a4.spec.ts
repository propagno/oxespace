import { expect, test, type Page } from '@playwright/test'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { launchApp, openDemoWorkspace, resizeWindow } from '../helpers/launch'
import { installThreadFixtures, registerThreadProject } from '../helpers/thread-fixtures'

/**
 * Homologation of #151 (A4, a worktree per conversation) in pt-BR and dark: a refused creation explains itself and
 * offers the project folder, the header shows the branch and badge, and archiving a worktree that holds work asks
 * (keep, open in Code, discard with a second confirmation). The main process is a stand-in, as in
 * e2e/thread-worktree.spec.ts; git itself is covered by tests/integration/thread-worktree-lifecycle.test.ts.
 */
const OUT = join(process.cwd(), 'e2e', 'screenshots', 'homologation', 'a4')
mkdirSync(OUT, { recursive: true })
const notes: Record<string, unknown> = {}
test.afterAll(() => writeFileSync(join(OUT, 'notes.json'), JSON.stringify(notes, null, 2)))
const shot = (page: Page, name: string) => page.screenshot({ path: join(OUT, `${name}.png`) })

for (const locale of ['pt-BR', 'en-US'] as const) {
  test(`worktree per conversation: refusal, header, archive with work (${locale})`, async () => {
    test.setTimeout(150_000)
    const { app, page, workspaceRoot, consoleErrors } = await launchApp({ locale, appearance: locale === 'pt-BR' ? 'dark' : 'light' })
    try {
      await resizeWindow(app, 1440, 900)
      await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.setZoomFactor(0.8))
      await installThreadFixtures(app, workspaceRoot)
      await openDemoWorkspace(page, workspaceRoot)
      await registerThreadProject(app, page, workspaceRoot)

      await app.evaluate(({ ipcMain, BrowserWindow }, { root }) => {
        const g = globalThis as Record<string, unknown>
        const threads: Record<string, unknown>[] = []
        const calls = { create: [] as unknown[], finish: [] as unknown[] }
        g.a4Calls = calls
        let refused = false
        const changed = (id: string) => { for (const w of BrowserWindow.getAllWindows()) w.webContents.send('thread:changed', { threadId: id }) }
        for (const c of ['list', 'read', 'create', 'command', 'worktree-inspect', 'worktree-finish']) ipcMain.removeHandler(`thread:${c}`)
        ipcMain.removeHandler('git:get-status')
        ipcMain.handle('git:get-status', () => ({ branch: 'feature/a4', ahead: 0, behind: 0, checkedAt: 1, files: [] }))
        ipcMain.handle('thread:list', () => threads)
        ipcMain.handle('thread:read', (_e, id) => ({ thread: threads.find(t => t.id === id), events: [] }))
        ipcMain.handle('thread:create', (_e, input) => {
          calls.create.push(input)
          // The first worktree request finds uncommitted changes in the project.
          if (input.worktree && !refused) { refused = true; throw new Error('[thread-worktree:DIRTY_BASE] The project has uncommitted changes.') }
          const path = `${root}-worktrees/feature-a4-cd34`
          const thread = { id: `t${threads.length + 1}`, workspaceId: g.e2eWorkspaceId, projectId: 'e2e-project', rootPath: input.worktree ? path : root, provider: input.provider,
            nativeSessionId: null, title: 'New conversation', pinned: false, status: 'idle', createdAt: 1, updatedAt: 1,
            ...(input.worktree ? { ownedWorktree: { path, branch: input.worktree.branch ?? 'thread/generated', projectRoot: root, baseSha: 'b'.repeat(40), createdAt: 1 } } : {}) }
          threads.push(thread); changed(String(thread.id)); return { thread, events: [] }
        })
        ipcMain.handle('thread:command', () => ({ kind: 'navigate' }))
        ipcMain.handle('thread:worktree-inspect', (_e, id) => {
          const t = threads.find(v => v.id === id) as { ownedWorktree?: unknown } | undefined
          const state = { missing: false, uncommitted: 2, untracked: 1, unpushed: 1 }
          return t?.ownedWorktree ? { owned: t.ownedWorktree, state, decision: { kind: 'ask', uncommitted: 2, untracked: 1, unpushed: 1, unreadable: false } } : null
        })
        ipcMain.handle('thread:worktree-finish', (_e, id, action, choice) => {
          calls.finish.push([id, action, choice])
          const t = threads.find(v => v.id === id); if (t) { t.archived = true; changed(String(id)) }
          return choice === 'keep' ? { removed: false, left: 'chosen' } : { removed: true }
        })
      }, { root: workspaceRoot })

      await page.keyboard.press('Control+2')
      const newInRepo = page.getByRole('button', { name: /(New thread|New conversation|Nova thread|Nova conversa).*repo/i }).first()
      await newInRepo.click()
      const dialog = page.getByRole('dialog').last()
      notes[`${locale}-dialog`] = await dialog.getAttribute('aria-label')
      const option = dialog.getByRole('checkbox', { name: /worktree/i })
      notes[`${locale}-optionDefault`] = await option.isChecked()
      await option.check()
      await dialog.getByLabel(/^(Branch)$/i).fill('feature/a4')
      await shot(page, `${locale}-new-with-worktree`)
      await dialog.getByRole('button', { name: /^(Create thread|Create conversation|Criar thread|Criar conversa)$/i }).click()
      await page.waitForTimeout(600)
      notes[`${locale}-refusal`] = { text: (await dialog.innerText()).slice(0, 600), buttons: await dialog.getByRole('button').allInnerTexts() }
      await shot(page, `${locale}-refused-dirty-base`)
      // "Create anyway" keeps the worktree request, without the project's changes.
      await dialog.getByRole('button', { name: /^(Create anyway|Criar mesmo assim)$/ }).click()
      await page.waitForTimeout(800)
      const heading = page.locator('.thread-heading')
      notes[`${locale}-header`] = { branch: await heading.locator('.thread-heading-branch').innerText().catch(() => 'missing'), badge: await heading.locator('.thread-heading-worktree').isVisible().catch(() => false), badgeTitle: await heading.locator('.thread-heading-worktree').getAttribute('title').catch(() => null) }
      await shot(page, `${locale}-header`)

      // Archive with work in the worktree: the question, then discard asks a second time.
      const composer = page.locator('.thread-composer textarea')
      await composer.fill('/archive')
      await composer.press('Enter')
      await page.waitForTimeout(600)
      const question = page.getByRole('dialog').last()
      notes[`${locale}-ask`] = { name: await question.getAttribute('aria-label'), text: (await question.innerText()).slice(0, 700), buttons: await question.getByRole('button').allInnerTexts() }
      await shot(page, `${locale}-archive-ask`)
      const discard = question.getByRole('button', { name: /discard|descartar/i }).first()
      await discard.click()
      await page.waitForTimeout(400)
      const confirm = page.getByRole('dialog').last()
      notes[`${locale}-discardConfirm`] = { name: await confirm.getAttribute('aria-label'), buttons: await confirm.getByRole('button').allInnerTexts() }
      await shot(page, `${locale}-discard-confirm`)
      await confirm.getByRole('button', { name: /^(Discard and remove worktree|Descartar e remover a worktree)$/i }).click()
      await page.waitForTimeout(600)
      notes[`${locale}-calls`] = await app.evaluate(() => (globalThis as Record<string, unknown>).a4Calls)
      await shot(page, `${locale}-after-discard`)
      notes[`${locale}-errors`] = consoleErrors
      expect(consoleErrors.filter(l => l.startsWith('pageerror:'))).toEqual([])
    } finally { await app.close() }
  })
}
