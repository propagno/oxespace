import { _electron as electron, test, type ElectronApplication, type Page } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * User's bug on installed 1.3.3, reproduced on main, black box, REAL app with real PowerShell panes:
 * OxeCode with 5 panes on top and 2 below; split a terminal; click outside the new pane before typing. Reported: the
 * new pane (and the one it was split from) stop taking keyboard input, cannot be closed from ⋯, titles render
 * truncated. Proof of input: each pane is asked to create a marker file; the file exists only if the keys reached the
 * shell. Output: e2e/screenshots/homologation/bug-split-focus/
 */
const OUT = join(process.cwd(), 'e2e', 'screenshots', 'homologation', 'bug-split-focus')
mkdirSync(OUT, { recursive: true })
const notes: Record<string, unknown> = {}
const save = () => writeFileSync(join(OUT, 'notes.json'), JSON.stringify(notes, null, 2))

const layout = (page: Page) => page.evaluate(async () => {
  const list = await (window as unknown as { oxe: { workspace: { list: () => Promise<Array<Record<string, unknown> & { panes: Array<Record<string, unknown>> }>> } } }).oxe.workspace.list()
  const ws = list[0]
  return { layout: ws?.layout, layoutPreset: ws?.layoutPreset, panes: ws?.panes.length, positions: ws?.panes.map(p => `${String(p.id).slice(0, 4)}@${p.row ?? '?'},${p.col ?? p.column ?? '?'}`) }
})
const headers = (page: Page) => page.evaluate(() => [...document.querySelectorAll('[data-testid="pane-container"]')].map((p, i) => {
  const r = p.getBoundingClientRect(); const head = p.querySelector('header, [class*="header"]') as HTMLElement | null
  const title = p.querySelector('[class*="title"]') as HTMLElement | null
  return `#${i} ${Math.round(r.width)}x${Math.round(r.height)} title="${(title?.innerText ?? head?.innerText ?? '').replace(/\s+/g, ' ').slice(0, 40)}" id=${(p.getAttribute('data-pane-id') ?? '').slice(0, 4)}`
}))
async function typeIn(page: Page, index: number, repo: string, marker: string) {
  const term = page.locator('[data-testid="pane-container"]').nth(index).locator('.xterm')
  await term.click({ timeout: 5_000 }).catch(() => undefined)
  await page.keyboard.type(`echo x > ${marker}`, { delay: 10 }); await page.keyboard.press('Enter')
  await page.waitForTimeout(2_000)
  return existsSync(join(repo, marker))
}
async function split(page: Page, index: number) {
  await page.locator('[data-testid="pane-container"]').nth(index).locator('.xterm').click({ timeout: 5_000 }).catch(() => undefined)
  await page.keyboard.press('Control+Shift+Backslash'); await page.waitForTimeout(2_500)
}

test('split, click outside, then type: does the new pane take input? (pt-BR)', async () => {
  test.setTimeout(300_000)
  const root = mkdtempSync(join(tmpdir(), 'oxespace-hml-bug-'))
  const repo = join(root, 'repo'); mkdirSync(repo); execFileSync('git', ['init', '-q'], { cwd: repo })
  const app: ElectronApplication = await electron.launch({ args: [join(process.cwd(), 'e2e', 'electron-main.cjs')], env: { ...process.env, OXESPACE_DISABLE_SINGLE_INSTANCE: '1', OXESPACE_DB_PATH: join(root, 'oxespace.sqlite3'), OXESPACE_LOCALE: 'pt-BR' } })
  const errors: string[] = []
  try {
    const page = await app.firstWindow()
    page.on('pageerror', e => errors.push(`pageerror ${String(e).slice(0, 200)}`))
    page.on('console', m => { if (m.type() === 'error') errors.push(`console ${m.text().slice(0, 200)}`) })
    await app.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows()[0].setSize(1600, 950) })
    await page.getByTestId('btn-new-workspace').first().waitFor({ timeout: 30_000 })
    await page.getByTestId('btn-new-workspace').first().click()
    await page.getByTestId('wizard-dir-input').fill(repo)
    await page.getByTestId('wizard-layout-card-4').click()
    await page.getByTestId('wizard-launch-btn').click()
    await page.waitForTimeout(6_000)
    notes.start = { layout: await layout(page), headers: await headers(page) }
    // 2 on top → 5 on top: split the top-left pane right three times. (Order on screen: top row first.)
    for (let i = 0; i < 3; i++) await split(page, 0)
    await page.waitForTimeout(2_000)
    notes.fivePlusTwo = { layout: await layout(page), headers: await headers(page) }
    await page.screenshot({ path: join(OUT, '01-five-plus-two.png') })
    const before = await page.locator('[data-testid="pane-container"]').count()
    // The reported step: split a bottom terminal, then click outside the new pane before typing.
    const source = before - 1
    await split(page, source)
    const after = await page.locator('[data-testid="pane-container"]').count()
    await page.locator('aside').first().click({ position: { x: 100, y: 600 } }).catch(() => undefined)
    await page.waitForTimeout(800)
    notes.afterSplit = { before, after, layout: await layout(page), headers: await headers(page) }
    await page.screenshot({ path: join(OUT, '02-after-split.png') })
    // Which pane is new? Compare ids with the earlier list.
    const idsBefore = (notes.fivePlusTwo as { headers: string[] }).headers.map(h => h.split('id=')[1])
    const idsAfter = (await headers(page)).map(h => h.split('id=')[1])
    const newIndex = idsAfter.findIndex(id => !idsBefore.includes(id))
    notes.newIndex = newIndex
    const typed: Record<string, boolean> = {}
    for (let i = 0; i < after; i++) typed[`pane${i}${i === newIndex ? '(new)' : ''}`] = await typeIn(page, i, repo, `m${i}.txt`)
    notes.inputReachedShell = typed
    notes.markers = readdirSync(repo).filter(f => f.endsWith('.txt'))
    // Close the new pane from its ⋯ menu.
    if (newIndex >= 0) {
      const pane = page.locator('[data-testid="pane-container"]').nth(newIndex)
      await pane.getByRole('button', { name: 'Mais ações do painel' }).click().catch(() => undefined)
      notes.paneMenu = await page.getByRole('menuitem').allInnerTexts().catch(() => [])
      await page.getByRole('menuitem', { name: /Fechar|Close/ }).first().click().catch(() => undefined)
      await page.waitForTimeout(1_500)
      notes.afterClose = { panes: await page.locator('[data-testid="pane-container"]').count(), dialogs: await page.getByRole('dialog').allInnerTexts().catch(() => []) }
      await page.screenshot({ path: join(OUT, '03-after-close.png') })
    }
    const userData = await app.evaluate(({ app }) => app.getPath('userData'))
    const journal = join(userData, 'diagnostics', 'incidents.json')
    notes.journal = existsSync(journal) ? readFileSync(journal, 'utf8').slice(0, 800) : 'none'
    notes.errors = errors
  } finally { save(); await app.evaluate(({ app }) => app.exit(0)).catch(() => undefined) }
})
