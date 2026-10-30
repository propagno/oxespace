/**
 * Memory footprint of the realistic "one long Thread, a few terminals" session.
 *
 * Unlike the perf benchmark this does NOT mock the Thread IPC: the database is seeded with the shape of a real
 * user's (2 Threads x ~6,000 events of 1-8 KB with some 20+ KB tool outputs, plus ~600 checkpoint file images),
 * and the Thread is opened through the production read path. Real PTYs are used for the Code terminals.
 *
 * Reports private bytes per Electron process type (app.getAppMetrics), the main process heap and the renderer
 * heap. With OXESPACE_PERF_GATE=1 the totals are held to the budgets below, which sit 25% above the measured
 * steady state so ordinary variation passes and a new retained structure does not.
 *
 * Build first: npm run build. Run: npx playwright test e2e/memory-footprint.spec.ts
 */
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const ENFORCE_BUDGETS = process.env.OXESPACE_PERF_GATE === '1'
const TERMINALS = Number(process.env.MF_TERMINALS ?? 4)

/**
 * Private megabytes per process type with the scenario below, 25% above what the memory-footprint work
 * measured on Windows (total 544, main 213, renderer 158, with 20,000 lines in each of four terminals).
 * Other platforms have a different process mix (no separate GPU baseline, zygote), so they take their
 * numbers from the CI output of this test through the override variables until calibrated.
 */
const WINDOWS_BUDGETS_MB = { total: 680, browser: 270, renderer: 200 }
export const MEMORY_BUDGETS_MB: Record<'total' | 'browser' | 'renderer', number> = {
  total: Number(process.env.OXESPACE_MEMORY_BUDGET_TOTAL_MB) || (process.platform === 'win32' ? WINDOWS_BUDGETS_MB.total : 0),
  browser: Number(process.env.OXESPACE_MEMORY_BUDGET_BROWSER_MB) || (process.platform === 'win32' ? WINDOWS_BUDGETS_MB.browser : 0),
  renderer: Number(process.env.OXESPACE_MEMORY_BUDGET_RENDERER_MB) || (process.platform === 'win32' ? WINDOWS_BUDGETS_MB.renderer : 0)
}
/** JS heaps are the same on every platform: what a long Thread and its terminals may retain after a collection. */
const MAIN_HEAP_GROWTH_MB = 20
const RENDERER_HEAP_MB = 45

function ensureOutJunction(): void {
  const link = join(process.cwd(), 'e2e', 'out')
  if (existsSync(link)) return
  try { symlinkSync(join(process.cwd(), 'out'), link, 'junction') } catch { /* exists/race */ }
}

async function launch(dbPath: string): Promise<{ app: ElectronApplication; page: Page; pid?: number }> {
  ensureOutJunction()
  const app = await electron.launch({
    args: [join(process.cwd(), 'e2e', 'electron-main.cjs')],
    env: { ...process.env, OXESPACE_DISABLE_SINGLE_INSTANCE: '1', OXESPACE_E2E_MOCK_NATIVE: '0', OXESPACE_DB_PATH: dbPath }
  })
  return { app, page: await app.firstWindow(), pid: app.process().pid }
}

async function stop(app: ElectronApplication, pid?: number): Promise<void> {
  await Promise.race([app.close().catch(() => undefined), new Promise(resolve => setTimeout(resolve, 5000))])
  if (!pid) return
  try { process.kill(pid, 0) } catch { return }
  try { if (process.platform === 'win32') execFileSync('taskkill.exe', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' }); else process.kill(pid, 'SIGKILL') } catch { /* gone */ }
}

interface Metrics { webglPanes: number; byType: Record<string, number>; totalMb: number; mainHeapMb: number; mainRssMb: number; rendererHeapMb: number; mainHeapTotalMb: number; mainExternalMb: number }
const mb = (kb: number): number => Math.round(kb / 1024 * 10) / 10

async function sample(app: ElectronApplication, page: Page): Promise<Metrics> {
  // Collect first so garbage that has not been swept yet does not count: this measures what is retained.
  // performance.memory is quantised; the inspector's heap usage is exact.
  const session = await page.context().newCDPSession(page)
  await session.send('HeapProfiler.collectGarbage')
  const rendererHeap = (await session.send('Runtime.getHeapUsage')).usedSize
  await session.detach()
  const main = await app.evaluate(async ({ app: electronApp }) => {
    // Same reason as the renderer: count what is retained, not what has not been swept yet.
    const v8 = process.getBuiltinModule('node:v8')
    v8.setFlagsFromString('--expose_gc')
    ;(process.getBuiltinModule('node:vm').runInNewContext('gc') as () => void)()
    const processes = electronApp.getAppMetrics().map(p => ({ type: p.type, name: p.name ?? '', privateKb: p.memory.privateBytes ?? 0, workingSetKb: p.memory.workingSetSize }))
    const usage = process.memoryUsage()
    return { processes, heap: usage.heapUsed, rss: usage.rss, heapTotal: usage.heapTotal, external: usage.external }
  })
  const byType: Record<string, number> = {}
  for (const p of main.processes) byType[p.type] = (byType[p.type] ?? 0) + mb(p.privateKb)
  const total = Object.values(byType).reduce((a, b) => a + b, 0)
  const webglPanes = await page.evaluate(() => document.querySelectorAll('.xterm-screen canvas.xterm-webgl, .xterm-screen > canvas:not(.xterm-link-layer)').length)
  return { webglPanes, byType, totalMb: Math.round(total * 10) / 10, mainHeapMb: Math.round(main.heap / 1048576 * 10) / 10, mainRssMb: Math.round(main.rss / 1048576 * 10) / 10, rendererHeapMb: Math.round(rendererHeap / 1048576 * 10) / 10,
    mainHeapTotalMb: Math.round(main.heapTotal / 1048576 * 10) / 10, mainExternalMb: Math.round(main.external / 1048576 * 10) / 10 }
}

test('memory footprint: one long Thread, four terminals, seeded history', async () => {
  test.setTimeout(240_000)
  const root = mkdtempSync(join(tmpdir(), 'oxe-memory-'))
  const repo = join(root, 'repo')
  mkdirSync(repo, { recursive: true })
  const dbPath = join(root, 'db.sqlite3')

  // Phase 1: let the app create and migrate its own database and a workspace, then stop it.
  let workspaceId: string
  {
    const { app, page, pid } = await launch(dbPath)
    try {
      await page.getByTestId('btn-new-workspace').click()
      await page.getByTestId('wizard-dir-input').fill(repo)
      await page.getByTestId(`wizard-layout-card-${TERMINALS}`).click()
      await page.getByTestId('wizard-launch-btn').click()
      await page.waitForSelector('[data-testid="workspace-grid"], [data-testid="workspace-split-grid"]', { state: 'visible' })
      workspaceId = await page.evaluate(async () => (await window.oxe.workspace.list())[0].id)
    } finally { await stop(app, pid) }
  }

  // Seed with the real schema, on Electron's Node so the native module matches.
  const electronBinary = (await import('electron') as unknown as { default: string }).default
  execFileSync(electronBinary, [join(process.cwd(), 'scripts', 'memory-footprint-seed.mjs'), dbPath, workspaceId, repo, '2', process.env.MF_EVENTS ?? '6000', process.env.MF_FILES ?? '600'],
    { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, stdio: 'inherit' })

  // Phase 2: the session being measured.
  const { app, page, pid } = await launch(dbPath)
  try {
    await page.waitForSelector('[data-testid="workspace-grid"], [data-testid="workspace-split-grid"]', { state: 'visible' })
    await expect(page.getByTestId('terminal-status-label').filter({ hasText: 'running' })).toHaveCount(TERMINALS, { timeout: 60_000 })
    // Agent CLIs that draw into the normal screen (Claude, Codex) leave their whole session in the scrollback.
    const lines = Number(process.env.MF_OUTPUT_LINES ?? 20_000)
    if (lines > 0) {
      const panes = page.getByTestId('terminal-pane')
      for (let index = 0; index < TERMINALS; index++) {
        await panes.nth(index).click()
        await page.keyboard.type(`node -e "for(let i=0;i<${lines};i++)console.log('line '+i+' '+'x'.repeat(100))"`)
        await page.keyboard.press('Enter')
      }
      await page.waitForTimeout(20_000)
    }
    await page.waitForTimeout(3_000)
    const codeOnly = await sample(app, page)
    console.log(`[MEMORY] code only ${JSON.stringify(codeOnly)}`)

    await page.getByRole('navigation', { name: 'Application view' }).getByRole('button', { name: 'Thread', exact: true }).click()
    await page.getByText('Long conversation 1').first().click()
    await page.locator('.thread-virtual-space').waitFor({ timeout: 30_000 })
    await page.waitForTimeout(8_000)
    const thread = await sample(app, page)
    console.log(`[MEMORY] thread open ${JSON.stringify(thread)}`)

    // Scroll to the top and back: the renderer must not keep what it scrolled past.
    await page.locator('.thread-timeline').evaluate(el => { el.scrollTop = 0 })
    await page.waitForTimeout(2_000)
    await page.locator('.thread-timeline').evaluate(el => { el.scrollTop = el.scrollHeight })
    await page.waitForTimeout(5_000)
    const scrolled = await sample(app, page)
    console.log(`[MEMORY] thread scrolled ${JSON.stringify(scrolled)}`)

    if (ENFORCE_BUDGETS) {
      expect(scrolled.webglPanes, 'hidden terminals give their WebGL renderer back').toBe(0)
      expect(scrolled.mainHeapMb - codeOnly.mainHeapMb, 'opening a long Thread must not leave its history parsed in the main process').toBeLessThanOrEqual(MAIN_HEAP_GROWTH_MB)
      expect(scrolled.rendererHeapMb, 'renderer heap with a long Thread and four filled terminals').toBeLessThanOrEqual(RENDERER_HEAP_MB)
      for (const [key, value] of [['total', scrolled.totalMb], ['browser', scrolled.byType.Browser ?? 0], ['renderer', scrolled.byType.Tab ?? 0]] as const) {
        const budget = MEMORY_BUDGETS_MB[key]
        if (budget) expect(value, `${key} private memory ${value} MB exceeded ${budget} MB`).toBeLessThanOrEqual(budget)
      }
    }
  } finally { await stop(app, pid) }
})
