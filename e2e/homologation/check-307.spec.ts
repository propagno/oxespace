import { _electron as electron, expect, test, type Page } from '@playwright/test'
import { cleanEnv } from './clean-env'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * #307 (user's split bug) black box, REAL app with real shells, pt-BR: from a 2×2 workspace, split past the preset
 * until 8 panes, then close every pane from its ⋯ menu. Before the fix, the close failed with
 * "SqliteError: UNIQUE constraint failed: panes.workspace_id, panes.row_index, panes.column_index".
 * Output: e2e/screenshots/homologation/check-307/
 */
const OUT = join(process.cwd(), 'e2e', 'screenshots', 'homologation', 'check-307')
mkdirSync(OUT, { recursive: true })
const panes = (page: Page) => page.locator('[data-testid="pane-container"]')

test('#307: split past the preset, then close every pane', async () => {
  test.setTimeout(300_000)
  const root = mkdtempSync(join(tmpdir(), 'oxespace-hml-307-'))
  const repo = join(root, 'repo'); mkdirSync(repo); execFileSync('git', ['init', '-q'], { cwd: repo })
  const app = await electron.launch({ args: [join(process.cwd(), 'e2e', 'electron-main.cjs')], env: { ...cleanEnv(), OXESPACE_DISABLE_SINGLE_INSTANCE: '1', OXESPACE_DB_PATH: join(root, 'oxespace.sqlite3'), OXESPACE_LOCALE: 'pt-BR' } })
  const mainOut: string[] = []
  app.process().stdout?.on('data', d => mainOut.push(String(d)))
  app.process().stderr?.on('data', d => mainOut.push(String(d)))
  const notes: Record<string, unknown> = {}
  try {
    const page = await app.firstWindow()
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1600, 1000))
    await page.getByTestId('btn-new-workspace').first().waitFor({ timeout: 30_000 })
    await page.getByTestId('btn-new-workspace').first().click()
    await page.getByTestId('wizard-dir-input').fill(repo)
    await page.getByTestId('wizard-layout-card-4').click()
    await page.getByTestId('wizard-launch-btn').click()
    await expect(panes(page)).toHaveCount(4, { timeout: 20_000 })
    const counts: number[] = []
    for (let i = 0; i < 4; i++) {
      await panes(page).nth(i).locator('.xterm').click({ timeout: 5_000 }).catch(() => undefined)
      await page.keyboard.press('Control+Shift+Backslash'); await page.waitForTimeout(2_500)
      counts.push(await panes(page).count())
    }
    notes.afterSplits = counts
    notes.notices = await page.getByRole('status').or(page.getByRole('alert')).allInnerTexts().catch(() => [])
    await page.screenshot({ path: join(OUT, '01-after-splits.png') })
    const closes: Array<{ before: number; after: number; dialogs: string[] }> = []
    while (await panes(page).count() > 0 && closes.length < 12) {
      const before = await panes(page).count()
      await panes(page).last().getByRole('button', { name: 'Mais ações do painel' }).click()
      const item = page.getByRole('menuitem', { name: /^Fechar/ }).first()
      await item.waitFor()
      if (closes.length === 0) {
        // Where the bottom pane's menu lands against the status bar (the first run's click was taken by the footer).
        notes.menuVsFooter = await page.evaluate(() => {
          const r = (s: string) => { const e = document.querySelector(s); if (!e) return null; const b = e.getBoundingClientRect(); return { top: Math.round(b.top), bottom: Math.round(b.bottom), left: Math.round(b.left), right: Math.round(b.right) } }
          const close = [...document.querySelectorAll('[role="menuitem"]')].find(e => /^Fechar/.test((e.textContent ?? '').trim()))
          const b = close?.getBoundingClientRect()
          const hit = b ? document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2) : null
          return { popover: r('.pane-actions-popover'), close: b ? { top: Math.round(b.top), bottom: Math.round(b.bottom) } : null, footer: r('footer.app-statusbar'), viewport: innerHeight, hitAtCloseCenter: hit ? `${hit.tagName}.${String(hit.className).slice(0, 50)}` : null }
        })
        await page.screenshot({ path: join(OUT, '02a-menu-open.png') })
      }
      // Keyboard activation, as a person would when the pointer cannot reach it.
      await item.focus(); await page.keyboard.press('Enter')
      const confirm = page.getByRole('dialog').getByRole('button', { name: /^Fechar|Encerrar/ })
      if (await confirm.isVisible({ timeout: 1_000 }).catch(() => false)) await confirm.click()
      await page.waitForTimeout(1_500)
      closes.push({ before, after: await panes(page).count(), dialogs: await page.getByRole('dialog').allInnerTexts().catch(() => []) })
      if (closes.at(-1)!.after === before) break
    }
    notes.closes = closes
    await page.screenshot({ path: join(OUT, '02-after-closes.png') })
    notes.uniqueErrors = mainOut.join('').match(/UNIQUE constraint[^\n]*/g) ?? []
    for (const c of closes) expect(c.after, `close at ${c.before} panes removes one`).toBe(c.before - 1)
    expect(notes.uniqueErrors).toEqual([])
  } finally {
    writeFileSync(join(OUT, 'notes.json'), JSON.stringify(notes, null, 2))
    await app.evaluate(({ app }) => app.exit(0)).catch(() => undefined)
  }
})
