/**
 * The app under real terminal load (OXE-120, 1.5.2): what the mocked-native benchmark hides. A workspace of 10 real
 * PTY panes, 8 of them printing ~1 MB/s of ANSI-coloured text for 20 s and 1 idle pane where keys are typed, measured
 * in 3 rounds:
 *  - main:loop: the main process's event-loop delay, with the recorder the performance journal uses for `main:loop`
 *    (monitorEventLoopDelay, 20 ms resolution, perf-journal.ts), reset at each round's start;
 *  - key echo: a key typed in the idle pane, from the key event to its echo arriving from the PTY;
 *  - Ctrl K: from the key to the first command palette item painted;
 *  - workspace switch: from the click to the other workspace's grid active (to a second workspace and back);
 *  - working set: every process of the app, at the peak while loaded and 10 s after the load ends.
 * Report only (CA-5): the first runs on main set the limits; until e2e/perf-load-limits.json exists nothing here fails
 * on a number. What fails is a load that did not happen (CA-4) or a run that reached the user's data (CA-6).
 * Lines: `[LOAD] <metric> median=<v> p95=<v> <unit>`, on stdout and in OXESPACE_LOAD_RESULTS (default
 * test-results/perf-load/results.txt), which .github/workflows/perf-load.yml publishes. CI only (RT-1).
 */
import { test, expect, type ElectronApplication, type Page } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { armInputTimerUntil, readInputTimer } from './helpers/input-timer'
import { launchForPerf } from './helpers/perf-launch'

const ROUNDS = Number(process.env.OXESPACE_LOAD_ROUNDS ?? 3)
const LOADERS = 8
const LOAD_SECONDS = 20
const LOAD_BYTES = 20 * 1024 * 1024
const RESULTS = process.env.OXESPACE_LOAD_RESULTS || join(process.cwd(), 'test-results', 'perf-load', 'results.txt')
const LIMITS_FILE = join(process.cwd(), 'e2e', 'perf-load-limits.json')
/** Variables of the live app that a run must never inherit (CA-6); the launcher sets its own few. */
const INHERITED = /^(OXESPACE_|AI_MEMORY_)/i

/** Prints LOAD_BYTES over LOAD_SECONDS in 50 ms steps, ANSI colours on every line, then exits. */
const LOADER = `
const total = ${LOAD_BYTES}, seconds = ${LOAD_SECONDS}
const line = (n) => '\\x1b[3' + (n % 7 + 1) + 'm' + String(n).padStart(8, '0') + ' ' + 'load '.repeat(16) + '\\x1b[0m\\r\\n'
let sent = 0, n = 0
const start = Date.now()
const tick = () => {
  const due = Math.min(total, Math.round(total * (Date.now() - start) / (seconds * 1000)))
  let chunk = ''
  while (sent + chunk.length < due) chunk += line(n++)
  if (sent + chunk.length > total) chunk = chunk.slice(0, total - sent)
  sent += chunk.length
  process.stdout.write(chunk)
  if (sent >= total) { clearInterval(timer); setTimeout(() => process.exit(0), 200) }
}
const timer = setInterval(tick, 50)
`

interface Samples { [metric: string]: { unit: 'ms' | 'MB'; values: number[] } }
const samples: Samples = {}
const bytesPerRound: number[] = []
let launchEnv: Record<string, string> = {}

function add(metric: string, unit: 'ms' | 'MB', value: number): void {
  if (!Number.isFinite(value)) return
  ;(samples[metric] ??= { unit, values: [] }).values.push(value)
}
function quantile(values: number[], q: number): number {
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(q * sorted.length) - 1))]
}
function loadLines(all: Samples): string[] {
  return Object.entries(all).map(([metric, { unit, values }]) => values.length
    ? `[LOAD] ${metric} median=${quantile(values, 0.5).toFixed(1)} p95=${quantile(values, 0.95).toFixed(1)} ${unit} (n=${values.length})`
    : `[LOAD] ${metric} — not measured`)
}

/** The launch environment: the runner's, minus anything of the live app, plus a temporary profile (CA-6). */
function cleanEnv(root: string): Record<string, string> {
  const env: Record<string, string> = {}
  for (const [key, value] of Object.entries(process.env)) if (value !== undefined && !INHERITED.test(key)) env[key] = value
  return { ...env, OXESPACE_DISABLE_SINGLE_INSTANCE: '1', OXESPACE_E2E_MOCK_NATIVE: '0', OXESPACE_DB_PATH: join(root, 'db.sqlite3') }
}

async function createWorkspace(page: Page, root: string, panes: number): Promise<void> {
  mkdirSync(root, { recursive: true })
  await page.getByTestId('btn-new-workspace').click()
  await page.getByTestId('wizard-dir-input').fill(root)
  await page.getByTestId(`wizard-layout-card-${panes}`).click()
  await page.getByTestId('wizard-launch-btn').click()
  const host = page.locator('.workspace-host:not(.workspace-host-hidden)')
  await expect(host.getByTestId('terminal-pane')).toHaveCount(panes, { timeout: 60_000 })
  await expect(host.getByTestId('terminal-status-label').filter({ hasText: 'running' })).toHaveCount(panes, { timeout: 90_000 })
}

async function workingSetMb(app: ElectronApplication): Promise<number> {
  return await app.evaluate(({ app: electronApp }) => electronApp.getAppMetrics().reduce((sum, metric) => sum + metric.memory.workingSetSize, 0) / 1024)
}

/** Starts the main process's loop-delay recorder (the journal's main:loop recorder), or reports that it cannot. */
async function startLoopRecorder(app: ElectronApplication): Promise<boolean> {
  return await app.evaluate(() => {
    const builtin = (process as unknown as { getBuiltinModule?: (id: string) => unknown }).getBuiltinModule
    const hooks = builtin?.('node:perf_hooks') as typeof import('node:perf_hooks') | undefined
    if (!hooks) return false
    const scope = globalThis as unknown as { __oxeLoadLoop?: ReturnType<typeof hooks.monitorEventLoopDelay> }
    scope.__oxeLoadLoop ??= hooks.monitorEventLoopDelay({ resolution: 20 })
    scope.__oxeLoadLoop.reset()
    scope.__oxeLoadLoop.enable()
    return true
  })
}
async function readLoop(app: ElectronApplication): Promise<{ p50: number; p95: number; max: number }> {
  return await app.evaluate(() => {
    const loop = (globalThis as unknown as { __oxeLoadLoop: { percentile: (p: number) => number; max: number; disable: () => void } }).__oxeLoadLoop
    loop.disable()
    return { p50: loop.percentile(50) / 1e6, p95: loop.percentile(95) / 1e6, max: loop.max / 1e6 }
  })
}

/** Counts, in the window, the characters each loader pane receives from its PTY. */
async function countBytes(page: Page, paneIds: string[]): Promise<void> {
  await page.evaluate((ids) => {
    const scope = window as unknown as { __oxeLoadBytes?: { total: number; off: Array<() => void> } }
    scope.__oxeLoadBytes?.off.forEach(off => off())
    const counter = { total: 0, off: [] as Array<() => void> }
    for (const id of ids) counter.off.push(window.oxe.terminal.onData(id, event => { counter.total += event.data.length }))
    scope.__oxeLoadBytes = counter
  }, paneIds)
}
const readBytes = (page: Page): Promise<number> => page.evaluate(() => (window as unknown as { __oxeLoadBytes: { total: number } }).__oxeLoadBytes.total)

/** A key typed in the idle pane, from its key event to its echo arriving from the PTY. */
async function keyEcho(page: Page, idlePane: string): Promise<number> {
  await page.evaluate((id) => {
    const scope = window as unknown as { __oxeEcho?: { start: number | null; done: number | null; off: () => void } }
    scope.__oxeEcho?.off()
    const echo = { start: null as number | null, done: null as number | null, off: () => undefined as void }
    const onKey = (event: KeyboardEvent): void => { if (echo.start === null && event.key === 'a') echo.start = event.timeStamp }
    const offData = window.oxe.terminal.onData(id, event => { if (echo.start !== null && echo.done === null && event.data.includes('a')) echo.done = performance.now() })
    window.addEventListener('keydown', onKey, true)
    echo.off = () => { offData(); window.removeEventListener('keydown', onKey, true) }
    scope.__oxeEcho = echo
  }, idlePane)
  await page.keyboard.press('a')
  await page.waitForFunction(() => (window as unknown as { __oxeEcho: { done: number | null } }).__oxeEcho.done !== null, undefined, { timeout: 10_000 })
  const ms = await page.evaluate(() => { const echo = (window as unknown as { __oxeEcho: { start: number; done: number; off: () => void } }).__oxeEcho; echo.off(); return echo.done - echo.start })
  await page.keyboard.press('Backspace')
  return ms
}

const shot = new Set<string>()
async function measure(page: Page, label: string, unit: 'ms', run: () => Promise<number>): Promise<void> {
  try { add(label, unit, await run()) } catch (error) {
    console.log(`[LOAD] ${label} — one sample not measured: ${error instanceof Error ? error.message.split('\n')[0] : String(error)}`)
    // The first miss of each measure leaves what the window showed, for the artifact.
    if (shot.has(label)) return
    shot.add(label)
    const state = await page.evaluate(() => ({
      dialogs: document.querySelectorAll('[role="dialog"]').length,
      options: document.querySelectorAll('[role="option"], [cmdk-item]').length,
      focused: `${document.activeElement?.tagName ?? ''}.${(document.activeElement as HTMLElement | null)?.className ?? ''}`.slice(0, 120),
      workspaces: Array.from(document.querySelectorAll('[data-testid="sidebar-workspace-item"]')).map(node => `${(node.textContent ?? '').trim().slice(0, 40)}:${(node as HTMLElement).offsetParent ? 'shown' : 'hidden'}`)
    })).catch(() => null)
    console.log(`[LOAD] ${label} — window state: ${JSON.stringify(state)}`)
    await page.screenshot({ path: join(dirname(RESULTS), `${label.replace(/[^a-z0-9]+/gi, '-')}.png`) }).catch(() => undefined)
  }
}

async function killApp(app: ElectronApplication): Promise<void> {
  const pid = app.process().pid
  await Promise.race([app.close().catch(() => undefined), new Promise(resolve => setTimeout(resolve, 4000))])
  if (!pid) return
  try { process.kill(pid, 0) } catch { return }
  try {
    if (process.platform === 'win32') execFileSync('taskkill.exe', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' })
    else process.kill(pid, 'SIGKILL')
  } catch { /* exited meanwhile */ }
}

test.describe.serial('the app under real terminal load (OXE-120)', () => {
  test('cenário de carga', async () => {
    test.setTimeout(15 * 60_000)
    const link = join(process.cwd(), 'e2e', 'out')
    if (!existsSync(link)) { try { symlinkSync(join(process.cwd(), 'out'), link, 'junction') } catch { /* exists */ } }
    const root = mkdtempSync(join(tmpdir(), 'oxe-load-'))
    const loader = join(root, 'load.cjs')
    writeFileSync(loader, LOADER)
    launchEnv = cleanEnv(root)
    const app = await launchForPerf(launchEnv)
    try {
      const page = await app.firstWindow()
      // The second workspace first: the measured one (10 panes) is then the active one.
      await createWorkspace(page, join(root, 'beta-repo'), 1)
      await createWorkspace(page, join(root, 'alpha-repo'), 10)
      const host = page.locator('.workspace-host:not(.workspace-host-hidden)')
      const paneIds = await host.getByTestId('terminal-pane').evaluateAll(nodes => nodes.map(node => node.getAttribute('data-pane-id') ?? ''))
      expect(paneIds.filter(Boolean)).toHaveLength(10)
      const loaders = paneIds.slice(0, LOADERS)
      const idle = paneIds[LOADERS]
      const hasLoop = await startLoopRecorder(app)
      if (!hasLoop) console.log('[LOAD] main:loop — not measured: process.getBuiltinModule is missing in this Electron')

      for (let round = 1; round <= ROUNDS; round++) {
        await countBytes(page, loaders)
        if (hasLoop) await startLoopRecorder(app)
        for (const paneId of loaders) await page.evaluate(({ paneId, command }) => window.oxe.terminal.write({ paneId, data: command }), { paneId, command: `node "${loader}"\r` })
        const startedAt = Date.now()
        let peak = 0
        const sampler = setInterval(() => { void workingSetMb(app).then(mb => { peak = Math.max(peak, mb) }).catch(() => undefined) }, 1000)

        // Every sample is taken while the 8 panes are still printing; a sample past the load would measure nothing.
        const loaded = (): boolean => Date.now() - startedAt < (LOAD_SECONDS - 1) * 1000
        await page.locator(`[data-testid="terminal-pane"][data-pane-id="${idle}"]`).click({ timeout: 5_000 })
        for (let i = 0; i < 5 && loaded(); i++) await measure(page, 'key echo (idle pane)', 'ms', () => keyEcho(page, idle))
        for (let i = 0; i < 3 && loaded(); i++) {
          // The palette opens with an empty search and lists nothing until a letter is typed (1.5.2), so its first
          // item is the first result: Ctrl K, then "a", until an option is painted. Closed again whatever happened,
          // or it would cover the window for every later sample.
          await measure(page, 'Ctrl K → first item', 'ms', async () => {
            try {
              await armInputTimerUntil(page, [{ selector: '[cmdk-item], [role="dialog"] [role="option"]' }])
              await page.keyboard.press('Control+K')
              await page.locator('[role="dialog"] [role="combobox"]').waitFor({ state: 'visible', timeout: 3_000 })
              await page.keyboard.type('a')
              return await readInputTimer(page, 3_000)
            } finally {
              await page.keyboard.press('Escape')
              await page.locator('[role="dialog"] [role="combobox"]').waitFor({ state: 'hidden', timeout: 3_000 }).catch(() => page.keyboard.press('Escape'))
            }
          })
        }
        for (const label of ['beta-repo', 'alpha-repo']) {
          if (!loaded()) break
          await measure(page, 'workspace switch → grid', 'ms', async () => {
            await armInputTimerUntil(page, [{ selector: '.ws-group.active', text: label }])
            await page.getByTestId('sidebar-workspace-item').filter({ hasText: label }).getByTestId('sidebar-workspace-select').click({ timeout: 5_000 })
            return await readInputTimer(page, 5_000)
          })
        }

        // The load ends on its own; wait for it (and its last bytes), then the memory 10 s later.
        const deadline = startedAt + (LOAD_SECONDS + 25) * 1000
        let last = -1, now = await readBytes(page)
        while (Date.now() < deadline && (now < LOADERS * LOAD_BYTES * 0.9 || now !== last)) {
          await page.waitForTimeout(1000)
          last = now; now = await readBytes(page)
        }
        clearInterval(sampler)
        bytesPerRound.push(now)
        if (hasLoop) {
          const loop = await readLoop(app)
          add('main:loop p95', 'ms', loop.p95)
          add('main:loop max', 'ms', loop.max)
        }
        add('working set at peak', 'MB', Math.max(peak, await workingSetMb(app)))
        await page.waitForTimeout(10_000)
        add('working set 10 s after', 'MB', await workingSetMb(app))
        console.log(`[LOAD] round ${round}: ${(now / 2 ** 20).toFixed(1)} MiB received by the ${LOADERS} panes in ${((Date.now() - startedAt) / 1000).toFixed(0)} s`)
      }
    } finally {
      await killApp(app)
      rmSync(root, { recursive: true, force: true, maxRetries: 3 })
    }
  })

  test('medidas sob carga', () => {
    for (const metric of ['main:loop p95', 'key echo (idle pane)', 'Ctrl K → first item', 'workspace switch → grid', 'working set at peak', 'working set 10 s after']) {
      expect(samples[metric]?.values.length ?? 0, `${metric} was measured`).toBeGreaterThan(0)
    }
  })

  test('saída [LOAD]', () => {
    const lines = [...loadLines(samples), `[LOAD] bytes per round ${bytesPerRound.map(bytes => (bytes / 2 ** 20).toFixed(1)).join(' / ')} MiB (expected ${(LOADERS * LOAD_BYTES / 2 ** 20).toFixed(0)})`]
    for (const line of lines) console.log(line)
    mkdirSync(dirname(RESULTS), { recursive: true })
    writeFileSync(RESULTS, `${lines.join('\n')}\n`)
    expect(lines.filter(line => /^\[LOAD\] .+ median=[\d.]+ p95=[\d.]+ (ms|MB)/.test(line)).length).toBeGreaterThanOrEqual(6)
  })

  test('carga real', () => {
    // Proof that the load happened: the 8 panes received within 10% of 8 × 20 MB in every round.
    expect(bytesPerRound).toHaveLength(ROUNDS)
    for (const bytes of bytesPerRound) expect(Math.abs(bytes - LOADERS * LOAD_BYTES) / (LOADERS * LOAD_BYTES)).toBeLessThanOrEqual(0.1)
  })

  test('modo relatório', () => {
    // No limits until the first 5 runs on main set them (CA-5): the numbers above are reported, never enforced.
    expect(existsSync(LIMITS_FILE), 'e2e/perf-load-limits.json comes from the first 5 runs on main').toBe(false)
  })

  test('sem dados do usuário', () => {
    expect(Object.keys(launchEnv).filter(key => INHERITED.test(key)).sort()).toEqual(['OXESPACE_DB_PATH', 'OXESPACE_DISABLE_SINGLE_INSTANCE', 'OXESPACE_E2E_MOCK_NATIVE'])
    expect(launchEnv.OXESPACE_DB_PATH.startsWith(tmpdir())).toBe(true)
  })
})
