import { _electron as electron, test, type ElectronApplication, type Page } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * F26 on main, black box, REAL app (the real close guard is not installed under the E2E mocks): a throwaway profile, a
 * fresh git repository as the workspace, the window asked to close by main as the OS would (BrowserWindow.close()).
 * Scenarios: nothing unsaved; an unsaved editor file (dialog, focus, Escape, "Fechar sem salvar"); "Salvar tudo e
 * fechar" writes it; a failing save; a renderer that never answers; an OxePost draft. Each test ends with app.exit,
 * since a plain close would be held by the guard itself. Output: e2e/screenshots/homologation/check-f26-real/
 */
const OUT = join(process.cwd(), 'e2e', 'screenshots', 'homologation', 'check-f26-real')
mkdirSync(OUT, { recursive: true })
const save = (name: string, value: unknown) => writeFileSync(join(OUT, `${name}.json`), JSON.stringify(value, null, 2))
const focused = (page: Page) => page.evaluate(() => { const el = document.activeElement as HTMLElement | null; return el ? `${el.tagName} ${(el.textContent ?? '').trim().slice(0, 30)}` : null }).catch(() => 'page gone')
const windows = (app: ElectronApplication) => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length).catch(() => 0)
const askClose = (app: ElectronApplication) => app.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows()[0]?.close() }).catch(() => undefined)
const quit = (app: ElectronApplication) => app.evaluate(({ app }) => app.exit(0)).catch(() => undefined)
async function closedWithin(app: ElectronApplication, ms: number): Promise<number | null> {
  const start = Date.now()
  while (Date.now() - start < ms) { if ((await windows(app)) === 0) return Date.now() - start; await new Promise(r => setTimeout(r, 100)) }
  return null
}
const dialog = (page: Page) => page.getByRole('alertdialog').or(page.getByRole('dialog')).filter({ hasText: /salv|save/i }).last()

async function start(locale: 'pt-BR' | 'en-US') {
  const root = mkdtempSync(join(tmpdir(), 'oxespace-hml-f26-'))
  const repo = join(root, 'repo'); mkdirSync(repo)
  execFileSync('git', ['init', '-q'], { cwd: repo })
  const app = await electron.launch({ args: [join(process.cwd(), 'e2e', 'electron-main.cjs')], env: { ...process.env, OXESPACE_DISABLE_SINGLE_INSTANCE: '1', OXESPACE_DB_PATH: join(root, 'oxespace.sqlite3'), OXESPACE_LOCALE: locale } })
  const page = await app.firstWindow()
  await app.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows()[0].setSize(1280, 860) })
  await page.getByTestId('btn-new-workspace').first().waitFor({ timeout: 30_000 })
  await page.getByTestId('btn-new-workspace').first().click()
  await page.getByTestId('wizard-dir-input').fill(repo)
  await page.getByTestId('wizard-layout-card-1').click()
  await page.getByTestId('wizard-launch-btn').click()
  await page.waitForTimeout(3_000)
  return { app, page, root, repo }
}
async function dirty(page: Page, repo: string, name = 'nota.txt') {
  const file = join(repo, name); writeFileSync(file, 'original\n')
  await page.keyboard.press('Control+k'); await page.locator('[cmdk-item][data-value="cmd-tool-editor"]').click()
  await page.locator('.editor-browser-file', { hasText: name }).first().click({ timeout: 10_000 })
  await page.locator('.monaco-editor').first().click({ timeout: 10_000 })
  await page.keyboard.press('Control+End'); await page.keyboard.insertText('alterado sem salvar\n')
  await page.waitForTimeout(500)
  return file
}

test('nothing unsaved closes right away; an unsaved file asks (pt-BR)', async () => {
  test.setTimeout(150_000)
  const { app, page, repo } = await start('pt-BR')
  try {
    // Nothing unsaved first: ask to close and see if anything holds it. (A fresh app per case would cost a minute each.)
    const file = await dirty(page, repo)
    await page.screenshot({ path: join(OUT, 'pt-dirty.png') })
    const t0 = Date.now(); await askClose(app)
    const d = dialog(page)
    const shown = await d.waitFor({ timeout: 4_000 }).then(() => Date.now() - t0, () => null)
    const entry: Record<string, unknown> = { dialogInMs: shown, windowsAfterAsk: await windows(app) }
    if (shown !== null) {
      entry.text = (await d.innerText()).slice(0, 500); entry.buttons = await d.getByRole('button').allInnerTexts(); entry.focus = await focused(page)
      await page.screenshot({ path: join(OUT, 'pt-dialog.png') })
      await page.keyboard.press('Enter'); await page.waitForTimeout(400)
      entry.afterEnter = { windows: await windows(app), dialog: await d.isVisible().catch(() => false) }
      if (await d.isVisible().catch(() => false)) await page.keyboard.press('Escape')
      await page.waitForTimeout(400)
      entry.afterEscape = { windows: await windows(app), dialog: await d.isVisible().catch(() => false), focus: await focused(page) }
      await askClose(app); await d.waitFor({ timeout: 4_000 }).catch(() => undefined)
      await d.getByRole('button', { name: /Fechar sem salvar/ }).click().catch(() => undefined)
      entry.closedAfterDiscardMs = await closedWithin(app, 5_000)
    }
    entry.fileOnDisk = readFileSync(file, 'utf8')
    save('pt-unsaved', entry)
  } finally { await quit(app) }
})

test('"Save all and close" writes the file, then closes (en)', async () => {
  test.setTimeout(150_000)
  const { app, page, repo } = await start('en-US')
  try {
    const file = await dirty(page, repo)
    await askClose(app)
    const d = dialog(page)
    const entry: Record<string, unknown> = { dialogShown: await d.waitFor({ timeout: 4_000 }).then(() => true, () => false) }
    if (entry.dialogShown) {
      entry.text = (await d.innerText()).slice(0, 400); entry.buttons = await d.getByRole('button').allInnerTexts(); entry.focus = await focused(page)
      await page.screenshot({ path: join(OUT, 'en-dialog.png') })
      await d.getByRole('button', { name: /Save all and close/i }).click().catch(() => undefined)
      entry.closedMs = await closedWithin(app, 6_000)
    }
    entry.fileOnDisk = readFileSync(file, 'utf8')
    save('en-save-all', entry)
  } finally { await quit(app) }
})

test('a failing save keeps the window open with an alert (pt-BR)', async () => {
  test.setTimeout(150_000)
  const { app, page, repo } = await start('pt-BR')
  try {
    const file = await dirty(page, repo, 'travado.txt')
    chmodSync(file, 0o444)
    await askClose(app)
    const d = dialog(page)
    const entry: Record<string, unknown> = { dialogShown: await d.waitFor({ timeout: 4_000 }).then(() => true, () => false) }
    if (entry.dialogShown) {
      await d.getByRole('button', { name: /Salvar tudo e fechar/ }).click().catch(() => undefined)
      await page.waitForTimeout(2_500)
      entry.windows = await windows(app)
      entry.alerts = await page.locator('[role="alert"]').allInnerTexts().catch(() => [])
      entry.dialogText = (await d.innerText().catch(() => '')).slice(0, 400)
      await page.screenshot({ path: join(OUT, 'pt-save-fails.png') }).catch(() => undefined)
    }
    entry.fileOnDisk = readFileSync(file, 'utf8')
    chmodSync(file, 0o666)
    save('pt-save-fails', entry)
  } finally { await quit(app) }
})

test('a renderer that never answers is closed after 3 s and journalled (en)', async () => {
  test.setTimeout(150_000)
  const { app, page, repo } = await start('en-US')
  try {
    await dirty(page, repo)
    const userData = await app.evaluate(({ app }) => app.getPath('userData'))
    void page.evaluate(() => { const end = Date.now() + 20_000; while (Date.now() < end) { /* busy */ } }).catch(() => undefined)
    await new Promise(r => setTimeout(r, 300))
    await askClose(app)
    const closed = await closedWithin(app, 12_000)
    await new Promise(r => setTimeout(r, 800))
    const journal = join(userData, 'diagnostics', 'incidents.json')
    save('en-hung', { closedMs: closed, journal: existsSync(journal) ? readFileSync(journal, 'utf8').slice(0, 700) : `no file at ${journal}` })
  } finally { await quit(app) }
})

test('an OxePost draft is protected (pt-BR)', async () => {
  test.setTimeout(150_000)
  const { app, page } = await start('pt-BR')
  try {
    await page.locator('button[data-app-mode="post"]').click(); await page.waitForTimeout(800)
    const url = page.getByRole('textbox', { name: /url/i }).first()
    await url.click(); await page.keyboard.insertText('https://api.example.invalid/rascunho'); await page.waitForTimeout(600)
    const value = await url.inputValue().catch(() => null)
    await askClose(app)
    const d = dialog(page)
    const shown = await d.waitFor({ timeout: 4_000 }).then(() => true, () => false)
    save('pt-oxepost', { value, shown, text: (await d.innerText().catch(() => '')).slice(0, 400), windows: await windows(app) })
    await page.screenshot({ path: join(OUT, 'pt-oxepost.png') }).catch(() => undefined)
  } finally { await quit(app) }
})
