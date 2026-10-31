import { test, type ElectronApplication, type Page } from '@playwright/test'
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { launchApp, openDemoWorkspace, resizeWindow } from '../helpers/launch'

/**
 * F26 (#280 + its main side) on main, black box: closing the window with and without unsaved work. Each scenario is
 * a fresh app, since the window goes away: nothing unsaved; an unsaved editor file (Escape, Cancel, "Fechar sem
 * salvar"); "Salvar tudo e fechar" writes the file; a save that fails (read-only file); a renderer that never answers
 * (forced close, incident closeUnanswered); an OxePost draft. The dialog is the app's own (UnsavedWorkDialog).
 * Output: e2e/screenshots/homologation/check-f26/
 */
const OUT = join(process.cwd(), 'e2e', 'screenshots', 'homologation', 'check-f26')
mkdirSync(OUT, { recursive: true })
const notes: Record<string, unknown> = {}
test.afterAll(() => writeFileSync(join(OUT, 'notes.json'), JSON.stringify(notes, null, 2)))
const focused = (page: Page) => page.evaluate(() => { const el = document.activeElement as HTMLElement | null; return el ? `${el.tagName} ${(el.textContent ?? '').trim().slice(0, 30)}` : null })
const askClose = (app: ElectronApplication) => app.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows()[0]?.close() }).catch(() => undefined)
const windows = (app: ElectronApplication) => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length).catch(() => 0)
async function closedWithin(app: ElectronApplication, ms: number): Promise<number | null> {
  const start = Date.now()
  while (Date.now() - start < ms) { if ((await windows(app)) === 0) return Date.now() - start; await new Promise(r => setTimeout(r, 100)) }
  return null
}
async function dirtyFile(page: Page, root: string, name = 'nota.txt'): Promise<string> {
  const file = join(root, name); writeFileSync(file, 'original\n')
  await page.keyboard.press('Control+k'); await page.locator('[cmdk-item][data-value="cmd-tool-editor"]').click()
  await page.locator('.editor-browser-file', { hasText: name }).first().click({ timeout: 10_000 })
  await page.locator('.monaco-editor').first().click(); await page.keyboard.press('Control+End'); await page.keyboard.insertText('alterado sem salvar\n')
  await page.waitForTimeout(400)
  return file
}
const dialog = (page: Page) => page.getByRole('alertdialog').or(page.getByRole('dialog')).filter({ hasText: /salv|save/i }).last()

test('nothing unsaved: closes right away (pt-BR)', async () => {
  test.setTimeout(120_000)
  const { app, page, workspaceRoot } = await launchApp({ locale: 'pt-BR' })
  await resizeWindow(app, 1280, 860); await openDemoWorkspace(page, workspaceRoot)
  await askClose(app)
  notes.nothingUnsaved = { closedInMs: await closedWithin(app, 5_000) }
  await app.close().catch(() => undefined)
})

test('unsaved editor file: the dialog, Escape, Cancel, then close without saving (pt-BR)', async () => {
  test.setTimeout(150_000)
  const { app, page, workspaceRoot } = await launchApp({ locale: 'pt-BR' })
  await resizeWindow(app, 1280, 860); await openDemoWorkspace(page, workspaceRoot)
  const file = await dirtyFile(page, workspaceRoot)
  const t0 = Date.now(); await askClose(app)
  const d = dialog(page)
  const shown = await d.waitFor({ timeout: 4_000 }).then(() => Date.now() - t0, () => null)
  const entry: Record<string, unknown> = { dialogInMs: shown }
  if (shown !== null) {
    entry.text = (await d.innerText()).slice(0, 500); entry.buttons = await d.getByRole('button').allInnerTexts(); entry.focus = await focused(page)
    await page.screenshot({ path: join(OUT, 'pt-dialog.png') })
    await page.keyboard.press('Escape'); await page.waitForTimeout(400)
    entry.afterEscape = { windows: await windows(app), dialog: await d.isVisible().catch(() => false), focus: await focused(page) }
    await askClose(app); await d.waitFor({ timeout: 4_000 }).catch(() => undefined)
    await d.getByRole('button', { name: /Fechar sem salvar/ }).click()
    entry.closedAfterDiscardMs = await closedWithin(app, 5_000)
    entry.fileOnDisk = readFileSync(file, 'utf8')
  }
  notes.unsavedDiscard = entry
  await app.close().catch(() => undefined)
})

test('"Salvar tudo e fechar" writes the file then closes (en)', async () => {
  test.setTimeout(150_000)
  const { app, page, workspaceRoot } = await launchApp({})
  await resizeWindow(app, 1280, 860); await openDemoWorkspace(page, workspaceRoot)
  const file = await dirtyFile(page, workspaceRoot)
  await askClose(app)
  const d = dialog(page); await d.waitFor({ timeout: 4_000 }).catch(() => undefined)
  const entry: Record<string, unknown> = { text: (await d.innerText().catch(() => '')).slice(0, 400), buttons: await d.getByRole('button').allInnerTexts().catch(() => []), focus: await focused(page) }
  await page.screenshot({ path: join(OUT, 'en-dialog.png') })
  await d.getByRole('button', { name: /Save all and close/i }).click().catch(() => undefined)
  entry.closedMs = await closedWithin(app, 6_000)
  entry.fileOnDisk = readFileSync(file, 'utf8')
  notes.saveAll = entry
  await app.close().catch(() => undefined)
})

test('a save that fails keeps the window open with an alert (pt-BR)', async () => {
  test.setTimeout(150_000)
  const { app, page, workspaceRoot } = await launchApp({ locale: 'pt-BR' })
  await resizeWindow(app, 1280, 860); await openDemoWorkspace(page, workspaceRoot)
  const file = await dirtyFile(page, workspaceRoot, 'travado.txt')
  chmodSync(file, 0o444)
  await askClose(app)
  const d = dialog(page); await d.waitFor({ timeout: 4_000 }).catch(() => undefined)
  await d.getByRole('button', { name: /Salvar tudo e fechar/ }).click().catch(() => undefined)
  await page.waitForTimeout(2_000)
  notes.saveFails = { windows: await windows(app), alerts: await page.locator('[role="alert"]').allInnerTexts().catch(() => []), dialogText: (await d.innerText().catch(() => '')).slice(0, 400), fileOnDisk: readFileSync(file, 'utf8') }
  await page.screenshot({ path: join(OUT, 'pt-save-fails.png') }).catch(() => undefined)
  chmodSync(file, 0o666)
  await app.close().catch(() => undefined)
})

test('a renderer that never answers: forced close after 3 s, journalled (en)', async () => {
  test.setTimeout(150_000)
  const { app, page, workspaceRoot } = await launchApp({})
  await resizeWindow(app, 1280, 860); await openDemoWorkspace(page, workspaceRoot)
  await dirtyFile(page, workspaceRoot)
  void page.evaluate(() => { const end = Date.now() + 15_000; while (Date.now() < end) { /* busy */ } }).catch(() => undefined)
  await new Promise(r => setTimeout(r, 300))
  await askClose(app)
  const closed = await closedWithin(app, 10_000)
  const journal = join(dirname(workspaceRoot), 'user-data', 'diagnostics', 'incidents.json')
  notes.hung = { closedMs: closed, journal: existsSync(journal) ? readFileSync(journal, 'utf8').slice(0, 600) : 'no journal file' }
  await app.close().catch(() => undefined)
})

test('an OxePost draft is protected too (pt-BR)', async () => {
  test.setTimeout(120_000)
  const { app, page, workspaceRoot } = await launchApp({ locale: 'pt-BR' })
  await resizeWindow(app, 1280, 860); await openDemoWorkspace(page, workspaceRoot)
  await page.locator('button[data-app-mode="post"]').click(); await page.waitForTimeout(600)
  const url = page.getByRole('textbox', { name: /url/i }).first()
  notes.oxepostField = await url.evaluate(e => `${e.tagName} ${e.getAttribute('aria-label') ?? ''} ${e.getAttribute('placeholder') ?? ''}`).catch(() => 'not found')
  await url.click(); await page.keyboard.insertText('https://api.example.invalid/rascunho')
  await page.waitForTimeout(600)
  notes.oxepostValue = await url.inputValue().catch(() => null)
  await page.screenshot({ path: join(OUT, 'pt-oxepost-before-close.png') })
  await askClose(app)
  const d = dialog(page)
  notes.oxepostDraft = { shown: await d.waitFor({ timeout: 4_000 }).then(() => true, () => false), text: (await d.innerText().catch(() => '')).slice(0, 400) }
  await page.screenshot({ path: join(OUT, 'pt-oxepost.png') }).catch(() => undefined)
  await app.close().catch(() => undefined)
})
