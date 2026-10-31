import { test, type Page } from '@playwright/test'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { launchApp, openDemoWorkspace, resizeWindow } from '../helpers/launch'

/**
 * UX-01 (#265, F29 acceptance baseline), black box on the E2E mock: four OxeCode panes get the lifecycle main
 * publishes (`agent-state:changed`): blocked (waiting for a decision), done (finished its turn), working, idle. What a
 * person can tell apart: the pane header, the sidebar row, the activity center (right away and after 12 s) and the
 * mode switcher's counter. Today blocked and done are expected to look the same; after F29 they must differ.
 * Output: e2e/screenshots/homologation/ux01/
 */
const OUT = join(process.cwd(), 'e2e', 'screenshots', 'homologation', 'ux01')
mkdirSync(OUT, { recursive: true })

const look = (page: Page) => page.evaluate(() => {
  const label = (el: Element | null) => el ? `${el.getAttribute('aria-label') ?? ''}|${el.getAttribute('title') ?? ''}|${(el.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 80)}` : null
  const dot = (root: Element) => { const d = root.querySelector('[class*="status-dot"], [class*="dot"]'); return d ? `${String((d as HTMLElement).className).slice(0, 60)} bg=${getComputedStyle(d).backgroundColor} hidden=${d.getAttribute('aria-hidden')}` : null }
  return {
    headers: [...document.querySelectorAll('[data-testid="pane-container"]')].map(p => ({ head: label(p.querySelector('header, [class*="header"]')), dot: dot(p), status: label(p.querySelector('[class*="status"]:not([class*="dot"])')) })),
    rows: [...document.querySelectorAll('[data-testid="pane-session-row"]')].map(r => ({ row: label(r), dot: dot(r) })),
    // Modes by id (#188); by name only on builds without data-app-mode.
    modes: (document.querySelector('button[data-app-mode]') ? [...document.querySelectorAll('button[data-app-mode="code"], button[data-app-mode="thread"]')] : [...document.querySelectorAll('nav button')].filter(b => /Code|Thread/.test(b.textContent ?? ''))).map(b => label(b))
  }
})

test('UX-01: a blocked pane against a done one (en, light)', async () => {
  test.setTimeout(180_000)
  const notes: Record<string, unknown> = {}
  const { app, page, workspaceRoot, consoleErrors } = await launchApp({ appearance: 'light' })
  try {
    await resizeWindow(app, 1440, 900)
    await openDemoWorkspace(page, workspaceRoot)
    const ws = await page.evaluate(() => (window as unknown as { oxe: { workspace: { list: () => Promise<Array<{ id: string; panes: Array<{ id: string }> }>> } } }).oxe.workspace.list().then(l => l.find(w => w.panes.length >= 4) ?? l[0]))
    notes.panes = ws.panes.map(p => p.id)
    const states = ['blocked', 'done', 'working', 'idle'] as const
    notes.before = await look(page)
    await app.evaluate(({ BrowserWindow }, input) => {
      const now = Date.now()
      input.panes.forEach((paneId, i) => {
        const state = input.states[i]; if (!state) return
        for (const win of BrowserWindow.getAllWindows()) win.webContents.send('agent-state:changed', { paneId, workspaceId: input.ws, agent: 'claude', state, source: 'hook', seen: false, since: now - 1000, stateChangeSeq: 2, completionSeq: state === 'done' ? 1 : 0 })
      })
    }, { ws: ws.id, panes: notes.panes as string[], states: [...states] })
    await page.waitForTimeout(800)
    notes.now = await look(page)
    await page.screenshot({ path: join(OUT, 'panes-now.png') })
    // The activity center right away, then after 12 s.
    await page.keyboard.press('Control+Shift+A'); await page.waitForTimeout(600)
    notes.activityNow = (await page.getByRole('dialog').last().innerText().catch(() => page.locator('[class*="activity"]').last().innerText().catch(() => ''))).slice(0, 1200)
    await page.screenshot({ path: join(OUT, 'activity-now.png') })
    await page.keyboard.press('Escape')
    await page.waitForTimeout(12_000)
    notes.after12s = await look(page)
    await page.keyboard.press('Control+Shift+A'); await page.waitForTimeout(600)
    notes.activity12s = (await page.getByRole('dialog').last().innerText().catch(() => page.locator('[class*="activity"]').last().innerText().catch(() => ''))).slice(0, 1200)
    await page.screenshot({ path: join(OUT, 'activity-12s.png') })
    await page.keyboard.press('Escape')
    // Verdict for the baseline: do blocked and done read the same?
    const n = notes.now as { headers: Array<Record<string, string | null>>; rows: Array<Record<string, string | null>> }
    notes.sameHeader = JSON.stringify(n.headers[0]) === JSON.stringify(n.headers[1])
    notes.sameRow = n.rows.length > 1 && n.rows[0]?.row?.replace(/terminal \d/i, '') === n.rows[1]?.row?.replace(/terminal \d/i, '') && n.rows[0]?.dot === n.rows[1]?.dot
    notes.errors = consoleErrors
  } finally {
    writeFileSync(join(OUT, 'notes.json'), JSON.stringify(notes, null, 2))
    await app.close()
  }
})
