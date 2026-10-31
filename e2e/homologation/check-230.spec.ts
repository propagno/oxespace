import { test, type ElectronApplication, type Page } from '@playwright/test'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { launchApp, resizeWindow } from '../helpers/launch'

/**
 * #230 (F13) on main, black box, pt-BR dark: sections in the OxeChat list. Adversarial names (empty, blank, too long,
 * a line break, an RLO, HTML, a duplicate), moving a conversation without dragging (menu + keyboard), what a screen reader
 * hears, the empty state, deleting a section with conversations, and a reload. Conversations are seeded as the PR's own
 * e2e does (IPC stand-ins), so no agent runs. Output: e2e/screenshots/homologation/check-230/
 */
const OUT = join(process.cwd(), 'e2e', 'screenshots', 'homologation', 'check-230')
mkdirSync(OUT, { recursive: true })
const TITLES = ['Plano Alfa', 'Revisão Bravo', 'Notas Charlie', 'Pico Delta']

async function seed(app: ElectronApplication, rootPath: string) {
  await app.evaluate(({ ipcMain, BrowserWindow }, { rootPath, titles }) => {
    const at = Date.UTC(2026, 9, 14, 11, 0, 0)
    const threads = titles.map((title, i) => ({ id: `t${i}`, workspaceId: 'thread:sections', projectId: 'sections', rootPath, provider: i % 2 ? 'codex' : 'claude', nativeSessionId: null, title, status: 'idle', lastTurnStatus: 'completed', pinned: false, createdAt: at - i * 60_000, updatedAt: at - i * 60_000 }))
    for (const c of ['list', 'read', 'commands', 'projects', 'models']) ipcMain.removeHandler(`thread:${c}`)
    ipcMain.handle('thread:projects', () => ({ projects: [{ projectId: 'sections', displayName: 'demo-repo', identityLabel: rootPath, hidden: false, contexts: [{ workspaceId: 'thread:sections', rootPath, label: 'demo-repo' }] }], unavailable: [] }))
    ipcMain.handle('thread:list', () => threads)
    ipcMain.handle('thread:read', (_e, id: string) => ({ thread: threads.find(t => t.id === id) ?? threads[0], events: [] }))
    ipcMain.handle('thread:commands', () => ({ commands: [] }))
    ipcMain.handle('thread:models', () => ({ defaultModel: 'm', models: [{ id: 'm', label: 'M', description: '', efforts: ['low'], defaultEffort: 'low' }] }))
    for (const w of BrowserWindow.getAllWindows()) w.webContents.send('thread:changed', { threadId: threads[0].id })
  }, { rootPath, titles: TITLES })
}
const nav = (page: Page) => page.locator('.thread-navigation')
const live = (page: Page) => page.evaluate(() => [...document.querySelectorAll('[aria-live], [role="status"], [role="alert"]')].map(r => (r.textContent ?? '').trim()).filter(Boolean).slice(-4))
const sections = (page: Page) => nav(page).locator('.thread-section').evaluateAll(ns => ns.map(n => ({ name: n.getAttribute('aria-label'), titles: [...n.querySelectorAll('.thread-session-title')].map(t => t.textContent), text: (n.textContent ?? '').trim().slice(0, 120) })))

test('F13 sections: names, keyboard move, announcements, delete, reload (pt-BR dark)', async () => {
  test.setTimeout(240_000)
  const notes: Record<string, unknown> = {}
  const { app, page, workspaceRoot, consoleErrors } = await launchApp({ locale: 'pt-BR', appearance: 'dark' })
  try {
    await resizeWindow(app, 1280, 860)
    await seed(app, workspaceRoot)
    await page.locator('button[data-app-mode="thread"]').click()
    await nav(page).locator('.thread-navigation-item').first().waitFor({ timeout: 15_000 })
    const openNew = async () => {
      await nav(page).getByRole('button', { name: /demo-repo/ }).filter({ hasText: '' }).last().click().catch(() => undefined)
      await page.getByRole('menuitem', { name: 'Nova seção…' }).click()
      return page.getByRole('dialog', { name: 'Nova seção' })
    }
    // Names a person (or a paste) might try.
    const tries: Array<[string, string]> = [['vazio', ''], ['só espaços', '   '], ['quebra de linha', 'Linha 1\nLinha 2'], ['RLO', 'Fila‮txt.exe'], ['HTML', '<img src=x onerror=alert(1)>'], ['longo', 'x'.repeat(200)], ['válido', 'Em andamento'], ['duplicado', 'Em andamento'], ['emoji', 'Revisar 🔥']]
    const names: Record<string, unknown> = {}
    for (const [label, value] of tries) {
      const dialog = await openNew()
      const field = dialog.getByRole('textbox', { name: 'Nome da seção' })
      await field.fill(value)
      const create = dialog.getByRole('button', { name: 'Criar seção' })
      const enabled = await create.isEnabled().catch(() => false)
      if (enabled) await create.click()
      await page.waitForTimeout(400)
      const still = await dialog.isVisible().catch(() => false)
      names[label] = { enabled, stillOpen: still, field: (await field.inputValue().catch(() => '')).slice(0, 40), error: still ? (await dialog.innerText()).split('\n').filter(l => /Use de|caracteres|existe/i.test(l)).join(' | ') : null }
      if (still) await page.keyboard.press('Escape')
    }
    notes.names = names
    notes.afterNames = await sections(page)
    await page.screenshot({ path: join(OUT, 'sections-after-names.png') })
    // Empty state of a new section.
    notes.emptyState = (await nav(page).locator('.thread-section', { hasText: 'Em andamento' }).first().innerText().catch(() => '')).slice(0, 200)
    // Move without dragging: the conversation's "…" button by keyboard, its "Mover para seção" submenu, a radio option.
    const actions = nav(page).getByRole('button', { name: /Revisão Bravo/ }).filter({ has: page.locator('svg') }).last()
    await nav(page).locator('.thread-navigation-item', { hasText: 'Revisão Bravo' }).first().focus()
    notes.contextMenuOnRow = await (async () => { await page.keyboard.press('Shift+F10'); await page.waitForTimeout(250); const n = await page.getByRole('menu').count(); await page.keyboard.press('Escape'); return n })()
    await actions.focus(); await page.keyboard.press('Enter'); await page.waitForTimeout(300)
    notes.actionsMenu = await page.getByRole('menuitem').allInnerTexts()
    const move = page.getByRole('menuitem', { name: /Mover para seção/ }).first()
    await move.focus(); await page.keyboard.press('ArrowRight'); await page.waitForTimeout(300)
    notes.moveOptions = await page.getByRole('menuitemradio').allInnerTexts()
    notes.duplicateOptions = (notes.moveOptions as string[]).filter(o => o.trim() === 'Em andamento').length
    await page.getByRole('menuitemradio', { name: 'Revisar 🔥' }).first().focus()
    await page.keyboard.press('Enter'); await page.waitForTimeout(500)
    notes.announceAfterMove = await live(page)
    notes.focusAfterMove = await page.evaluate(() => `${document.activeElement?.tagName} ${document.activeElement?.getAttribute('aria-label') ?? (document.activeElement?.textContent ?? '').trim().slice(0, 30)}`)
    notes.afterMove = await sections(page)
    await page.screenshot({ path: join(OUT, 'after-move.png') })
    // Delete the section with the conversation in it.
    await nav(page).getByRole('button', { name: 'Ações da seção Revisar 🔥' }).first().click()
    await page.getByRole('menuitem', { name: 'Excluir seção…' }).click()
    const del = page.getByRole('dialog', { name: 'Excluir esta seção?' })
    notes.deleteDialog = { text: (await del.innerText().catch(() => '')).slice(0, 300), focus: await page.evaluate(() => (document.activeElement?.textContent ?? '').trim().slice(0, 30)) }
    await page.screenshot({ path: join(OUT, 'delete-dialog.png') })
    await del.getByRole('button', { name: 'Excluir seção' }).click()
    await page.waitForTimeout(400)
    notes.announceAfterDelete = await live(page)
    notes.afterDelete = await sections(page)
    // Reload: what is still there?
    await page.reload(); await page.waitForTimeout(1_500)
    await seed(app, workspaceRoot)
    await page.locator('button[data-app-mode="thread"]').click().catch(() => undefined)
    await page.waitForTimeout(1_000)
    notes.afterReload = await sections(page)
    notes.storage = await page.evaluate(() => Object.keys(localStorage).filter(k => k.startsWith('oxe-thread-sections')))
    notes.errors = consoleErrors
  } finally {
    writeFileSync(join(OUT, 'notes.json'), JSON.stringify(notes, null, 2))
    await app.close()
  }
})
