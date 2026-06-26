/**
 * OXESpace runtime fluidity benchmark.
 *
 * Drives the REAL built app (mock-native mode → no DB/PTY noise, isolates
 * renderer/UI fluidity) via Playwright+Electron. One ISOLATED test per concern
 * so a crash/hang in one panel can't block the others (Playwright isolates
 * tests). Timing is in-renderer (performance.now across a rAF settle) →
 * click→painted, sub-ms, no protocol overhead.
 *
 * Build first: npm run build   ·   Run: npx playwright test e2e/perf-benchmark.spec.ts
 * Budgets: 1 frame @60fps = 16.7ms · 100ms = perceptible.
 */
import { _electron as electron, test, type ElectronApplication, type Page } from '@playwright/test'
import { mkdirSync, symlinkSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { performance } from 'node:perf_hooks'

const REPEATS = 6

function ensureOutJunction(): void {
  const link = join(process.cwd(), 'e2e', 'out')
  if (existsSync(link)) return
  try { symlinkSync(join(process.cwd(), 'out'), link, 'junction') } catch { /* exists/race */ }
}
function stats(xs: number[]): { min: number; mean: number; p95: number; max: number } {
  const s = [...xs].sort((a, b) => a - b)
  const mean = xs.reduce((a, b) => a + b, 0) / xs.length
  return { min: s[0], mean, p95: s[Math.min(s.length - 1, Math.floor(s.length * 0.95))], max: s[s.length - 1] }
}
function report(op: string, xs: number[]): void {
  const f = (n: number): string => n.toFixed(1)
  if (!xs.length) { console.log(`[RESULT] ${op.padEnd(40)} — no samples`); return }
  const s = stats(xs)
  const flag = s.mean > 100 ? '🔴' : s.mean > 16.7 ? '🟡' : '🟢'
  // eslint-disable-next-line no-console
  console.log(`[RESULT] ${op.padEnd(40)} n=${xs.length} min=${f(s.min)} mean=${f(s.mean)} p95=${f(s.p95)} max=${f(s.max)} ms ${flag}`)
}

async function launchApp(): Promise<{ app: ElectronApplication; page: Page; pid?: number }> {
  ensureOutJunction()
  const root = join(tmpdir(), `oxe-perf-${Date.now()}-${Math.random().toString(36).slice(2)}`)
  const app = await electron.launch({
    args: [join(process.cwd(), 'e2e', 'electron-main.cjs')],
    env: { ...process.env, OXESPACE_DISABLE_SINGLE_INSTANCE: '1', OXESPACE_E2E_MOCK_NATIVE: '1', OXESPACE_DB_PATH: join(root, 'db.sqlite3') }
  })
  const pid = app.process().pid
  const page = await app.firstWindow()
  return { app, page, pid }
}
async function killApp(app: ElectronApplication, pid?: number): Promise<void> {
  await Promise.race([app.close().catch(() => undefined), new Promise((r) => setTimeout(r, 3000))])
  if (pid) { try { process.kill(pid, 'SIGKILL') } catch { /* dead */ } }
}
async function createWorkspace(page: Page): Promise<void> {
  const root = join(tmpdir(), `oxe-ws-${Date.now()}`, 'repo'); mkdirSync(root, { recursive: true })
  await page.getByTestId('btn-new-workspace').click()
  await page.getByTestId('wizard-dir-input').fill(root)
  await page.getByTestId('wizard-layout-card-1').click()
  await page.getByTestId('wizard-launch-btn').click()
  await page.getByTestId('workspace-grid').waitFor({ state: 'visible' })
}
async function timePanelToggle(page: Page, label: string, panelTestId: string, wantVisible: boolean): Promise<number> {
  const res = await page.evaluate(
    async ({ label, panelTestId, wantVisible }) => {
      const vis = (el: Element | null): boolean => !!el && (el as HTMLElement).offsetParent !== null
      const nf = (): Promise<void> => new Promise((r) => requestAnimationFrame(() => r()))
      const trigger = document.querySelector('.tools-menu-trigger') as HTMLElement | null
      if (!trigger) return { error: 'no trigger' }
      if (!document.querySelector('.tools-menu-popover')) trigger.click()
      await nf()
      const item = (Array.from(document.querySelectorAll('.tools-menu-item')) as HTMLElement[])
        .find((b) => b.querySelector('.tools-menu-item-label')?.textContent?.trim() === label)
      if (!item) return { error: `no item: ${label}` }
      const sel = `[data-testid="${panelTestId}"]`
      const t0 = performance.now()
      item.click()
      await new Promise<void>((res) => { const c = (): void => { if (vis(document.querySelector(sel)) === wantVisible) res(); else requestAnimationFrame(c) }; requestAnimationFrame(c) })
      return { ms: performance.now() - t0 }
    },
    { label, panelTestId, wantVisible }
  )
  if ('error' in res) throw new Error(res.error)
  return res.ms
}

test('boot + workspace create', async () => {
  test.setTimeout(60_000)
  const tLaunch = performance.now()
  const { app, page, pid } = await launchApp()
  const tFirst = performance.now()
  await page.getByTestId('btn-new-workspace').waitFor({ state: 'visible' })
  const tInteractive = performance.now()
  report('boot: launch→firstWindow', [tFirst - tLaunch])
  report('boot: firstWindow→interactive', [tInteractive - tFirst])
  const tC = performance.now()
  await createWorkspace(page)
  report('workspace: create→grid (w/ input)', [performance.now() - tC])
  await killApp(app, pid)
})

const PANELS: Array<{ label: string; testId: string }> = [
  { label: 'GitHub', testId: 'workspace-github-panel' },
  { label: 'Editor', testId: 'workspace-editor-panel' },
  { label: 'Review', testId: 'workspace-review-panel' },
  { label: 'Worktrees', testId: 'workspace-worktree-panel' },
  { label: 'Scripts', testId: 'workspace-scripts-panel' },
  { label: 'Web Preview', testId: 'workspace-web-preview-panel' },
  { label: 'OXE', testId: 'workspace-oxe-panel' },
  { label: 'Background Jobs', testId: 'workspace-background-panel' }
]

for (const { label, testId } of PANELS) {
  test(`panel: ${label}`, async () => {
    test.setTimeout(45_000)
    const { app, page, pid } = await launchApp()
    let crashed = false
    try {
      await createWorkspace(page)
      await page.waitForTimeout(250)
      const openS: number[] = []
      const closeS: number[] = []
      for (let i = 0; i < REPEATS; i++) {
        try {
          openS.push(await timePanelToggle(page, label, testId, true))
          await page.waitForTimeout(30)
          closeS.push(await timePanelToggle(page, label, testId, false))
          await page.waitForTimeout(30)
        } catch (err) {
          crashed = /exited|closed|Target page/.test((err as Error).message)
          // eslint-disable-next-line no-console
          console.log(`[RESULT] panel ${label.padEnd(20)} ${crashed ? '🔴 CRASHED app on open' : 'error: ' + (err as Error).message} (rep ${i})`)
          break
        }
      }
      if (openS.length) report(`panel open:  ${label}`, openS)
      if (closeS.length) report(`panel close: ${label}`, closeS)
    } finally {
      if (!crashed) await killApp(app, pid)
      else if (pid) { try { process.kill(pid, 'SIGKILL') } catch { /* dead */ } }
    }
  })
}
