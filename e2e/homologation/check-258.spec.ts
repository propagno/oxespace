import { _electron as electron, test, type Page } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * #258 (F23) on main, black box, REAL app and a real PowerShell in the pane: the shell itself records every key it
 * receives ([Console]::ReadKey into a temp file). Then F6 / Shift+F6, Ctrl+M (Tab moves focus) and Tab are pressed, and
 * the file tells what reached the shell. Also: where focus goes, what is announced, the visible indicator, and the
 * Settings › Teclado entry. pt-BR. Output: e2e/screenshots/homologation/check-258/
 */
const OUT = join(process.cwd(), 'e2e', 'screenshots', 'homologation', 'check-258')
mkdirSync(OUT, { recursive: true })
const focused = (page: Page) => page.evaluate(() => { const el = document.activeElement as HTMLElement | null; return el ? `${el.tagName} ${el.getAttribute('aria-label') ?? ''} ${el.closest('[data-testid]')?.getAttribute('data-testid') ?? ''} ${(el.textContent ?? '').trim().slice(0, 30)}`.trim() : null })
const live = (page: Page) => page.evaluate(() => [...document.querySelectorAll('[aria-live], [role="status"], [role="alert"]')].map(r => (r.textContent ?? '').trim()).filter(Boolean).slice(0, 6))
const inTerminal = (page: Page) => page.evaluate(() => !!document.activeElement?.closest('.xterm'))

test('terminal keyboard exit: nothing reaches the shell (pt-BR)', async () => {
  test.setTimeout(240_000)
  const root = mkdtempSync(join(tmpdir(), 'oxespace-hml-258-'))
  const repo = join(root, 'repo'); mkdirSync(repo)
  execFileSync('git', ['init', '-q'], { cwd: repo })
  const keys = join(root, 'keys.txt')
  const app = await electron.launch({ args: [join(process.cwd(), 'e2e', 'electron-main.cjs')], env: { ...process.env, OXESPACE_DISABLE_SINGLE_INSTANCE: '1', OXESPACE_DB_PATH: join(root, 'oxespace.sqlite3'), OXESPACE_LOCALE: 'pt-BR' } })
  const notes: Record<string, unknown> = {}
  const errors: string[] = []
  try {
    const page = await app.firstWindow()
    page.on('pageerror', e => errors.push(String(e).slice(0, 200)))
    await app.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows()[0].setSize(1280, 860) })
    await page.getByTestId('btn-new-workspace').first().waitFor({ timeout: 30_000 })
    await page.getByTestId('btn-new-workspace').first().click()
    await page.getByTestId('wizard-dir-input').fill(repo)
    await page.getByTestId('wizard-layout-card-1').click()
    await page.getByTestId('wizard-launch-btn').click()
    const term = page.locator('.xterm').first()
    await term.waitFor({ timeout: 20_000 })
    await page.waitForTimeout(4_000)
    await term.click()
    notes.announceOnEnter = await live(page)
    // The shell records each key it gets: name and char code.
    await page.keyboard.type(`while($true){ $k=[Console]::ReadKey($true); Add-Content -LiteralPath '${keys}' ("{0} {1} {2}" -f $k.Key,[int]$k.KeyChar,$k.Modifiers) }`, { delay: 5 })
    await page.keyboard.press('Enter')
    await page.waitForTimeout(2_500)
    await page.keyboard.press('a'); await page.waitForTimeout(300)

    // F6 leaves the terminal; follow it through the regions.
    const cycle: unknown[] = []
    await page.keyboard.press('F6'); await page.waitForTimeout(250)
    cycle.push({ key: 'F6', inTerminal: await inTerminal(page), focus: await focused(page), live: await live(page) })
    for (let i = 0; i < 5; i++) { await page.keyboard.press('F6'); await page.waitForTimeout(200); cycle.push({ key: 'F6', inTerminal: await inTerminal(page), focus: await focused(page) }) }
    for (let i = 0; i < 6 && !(await inTerminal(page)); i++) { await page.keyboard.press('Shift+F6'); await page.waitForTimeout(200); cycle.push({ key: 'Shift+F6', inTerminal: await inTerminal(page), focus: await focused(page) }) }
    notes.cycle = cycle
    if (!(await inTerminal(page))) await term.click()
    await page.keyboard.press('b'); await page.waitForTimeout(300)
    // F6 from inside, once more, then back by click: does F6 ever reach the shell?
    await page.keyboard.press('F6'); await page.waitForTimeout(200); await term.click(); await page.keyboard.press('Shift+F6'); await page.waitForTimeout(200); await term.click()

    // Ctrl+M: Tab moves focus.
    await page.keyboard.press('Control+m'); await page.waitForTimeout(400)
    notes.ctrlM = { live: await live(page), indicator: await page.evaluate(() => [...document.querySelectorAll('[class*="tab-moves" i], [data-tab-moves-focus], [aria-pressed="true"][title*="Tab" i], [title*="Tab" i]')].map(e => `${e.tagName} ${e.getAttribute('title') ?? ''} ${(e.textContent ?? '').trim().slice(0, 40)}`).slice(0, 4)) }
    await page.screenshot({ path: join(OUT, 'tab-moves-focus-on.png') })
    await page.keyboard.press('Tab'); await page.waitForTimeout(250)
    notes.tabWithMode = { inTerminal: await inTerminal(page), focus: await focused(page) }
    await term.click()
    await page.keyboard.press('Control+m'); await page.waitForTimeout(300)
    notes.ctrlMOff = { live: await live(page) }
    // With the mode off, Tab belongs to the shell again (expected to be recorded).
    await page.keyboard.press('Tab'); await page.waitForTimeout(300)
    await page.keyboard.press('z'); await page.waitForTimeout(800)
    notes.received = existsSync(keys) ? readFileSync(keys, 'utf8').split(/\r?\n/).filter(Boolean) : 'no file: the recorder did not start'
    await page.keyboard.press('Control+c')

    // Settings › Teclado: is the Tab mode listed, rebindable, can it be turned off?
    await page.keyboard.press('F6'); await page.keyboard.press('Control+,')
    const settings = page.locator('.settings-center'); await settings.waitFor({ timeout: 10_000 }).catch(() => undefined)
    await settings.getByText('Teclado', { exact: true }).locator('visible=true').first().click().catch(() => undefined)
    await page.waitForTimeout(500)
    notes.settingsKeyboard = (await settings.innerText().catch(() => '')).split('\n').filter(l => /Tab|F6|região|regiao|foco/i.test(l)).slice(0, 12)
    await page.screenshot({ path: join(OUT, 'settings-keyboard.png') })
    notes.errors = errors
  } finally {
    writeFileSync(join(OUT, 'notes.json'), JSON.stringify(notes, null, 2))
    await app.close()
  }
})
