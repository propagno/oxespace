import { test, type ElectronApplication, type Page } from '@playwright/test'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { launchApp, openDemoWorkspace, resizeWindow } from '../helpers/launch'

/**
 * #270 (F29) on main, black box, pt-BR light: four OxeCode panes get their state from the main process through the
 * #268 hook (the same entry point the agents' lifecycle hooks use): blocked (waiting), done (working → done), working,
 * idle. Compared with the UX-01 baseline: can a person tell blocked from done in the pane header, the sidebar row, the
 * order, the OxeCode counter, the activity center (right away), the system notification (window blurred, recorded,
 * not shown), the screen reader and "Por que este status?". Output: e2e/screenshots/homologation/check-270/
 */
const OUT = join(process.cwd(), 'e2e', 'screenshots', 'homologation', 'check-270')
mkdirSync(OUT, { recursive: true })

const look = (page: Page) => page.evaluate(() => {
  const label = (el: Element | null) => el ? `${el.getAttribute('aria-label') ?? ''}|${el.getAttribute('title') ?? ''}|${(el.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 100)}` : null
  const dot = (root: Element) => { const d = root.querySelector('[class*="status-dot"], [class*="activity-dot"]'); return d ? `${String((d as HTMLElement).className).slice(0, 70)} bg=${getComputedStyle(d).backgroundColor}` : null }
  return {
    headers: [...document.querySelectorAll('[data-testid="pane-container"]')].map(p => ({ head: label(p.querySelector('header, [class*="header"]')), dot: dot(p) })),
    rows: [...document.querySelectorAll('[data-testid="pane-session-row"]')].map(r => ({ row: label(r), dot: dot(r) })),
    modes: [...document.querySelectorAll('button[data-app-mode="code"], button[data-app-mode="thread"]')].map(b => label(b)),
    live: [...document.querySelectorAll('[aria-live], [role="status"], [role="alert"]')].map(r => (r.textContent ?? '').trim()).filter(Boolean).slice(-5)
  }
})
const hook = (app: ElectronApplication, paneId: string, state: string, hookEvent?: string) => app.evaluate((_e, input) => (globalThis as Record<string, (i: unknown) => unknown>).__oxeE2eAgentState?.(input), { paneId, state, ...(hookEvent ? { hookEvent } : {}) })

test('F29: blocked is not done (pt-BR light)', async () => {
  test.setTimeout(240_000)
  const notes: Record<string, unknown> = {}
  const { app, page, workspaceRoot, consoleErrors } = await launchApp({ locale: 'pt-BR', appearance: 'light', env: { OXESPACE_E2E_AGENT_STATE: '1' } })
  try {
    await resizeWindow(app, 1440, 900)
    await openDemoWorkspace(page, workspaceRoot)
    notes.hookPresent = await app.evaluate(() => typeof (globalThis as Record<string, unknown>).__oxeE2eAgentState === 'function')
    await app.evaluate(({ Notification }) => {
      const g = globalThis as Record<string, unknown>; g.notes = []
      Notification.prototype.show = function (this: Electron.Notification) { (g.notes as unknown[]).push({ title: this.title, body: this.body }) }
    })
    const panes = await page.evaluate(() => (window as unknown as { oxe: { workspace: { list: () => Promise<Array<{ panes: Array<{ id: string }> }>> } } }).oxe.workspace.list().then(l => (l.find(w => w.panes.length >= 4) ?? l[0]).panes.map(p => p.id)))
    // Blur the window so the system notification path is taken.
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].blur())
    for (const p of panes.slice(0, 3)) await hook(app, p, 'working')
    await hook(app, panes[0], 'waiting', 'PermissionRequest')
    await hook(app, panes[1], 'done')
    await page.waitForTimeout(1_200)
    notes.now = await look(page)
    notes.systemNotifications = await app.evaluate(() => (globalThis as Record<string, unknown>).notes)
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].focus())
    await page.screenshot({ path: join(OUT, 'panes.png') })
    const n = notes.now as { headers: Array<Record<string, string | null>>; rows: Array<Record<string, string | null>> }
    notes.sameHeader = JSON.stringify(n.headers[0]) === JSON.stringify(n.headers[1])
    notes.sameRow = n.rows[0]?.row?.replace(/terminal \d/i, '') === n.rows[1]?.row?.replace(/terminal \d/i, '') && n.rows[0]?.dot === n.rows[1]?.dot
    // Activity center, right away.
    await page.keyboard.press('Control+Shift+A'); await page.waitForTimeout(500)
    notes.activity = (await page.getByRole('dialog').last().innerText().catch(() => '')).slice(0, 700)
    await page.screenshot({ path: join(OUT, 'activity.png') }); await page.keyboard.press('Escape')
    // "Por que este status?"
    const why = page.getByRole('button', { name: /Por que este status/ }).first()
    notes.whyPresent = await why.isVisible().catch(() => false)
    if (notes.whyPresent) { await why.click(); await page.waitForTimeout(500); notes.why = (await page.getByRole('dialog').last().innerText().catch(() => page.locator('[role="tooltip"], [role="note"]').last().innerText().catch(() => ''))).slice(0, 500); await page.screenshot({ path: join(OUT, 'why.png') }); await page.keyboard.press('Escape') }
    notes.errors = consoleErrors
  } finally {
    writeFileSync(join(OUT, 'notes.json'), JSON.stringify(notes, null, 2))
    await app.close()
  }
})
