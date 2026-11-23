/**
 * OXE-411 · What the terminal costs under load, lever by lever (shared/terminal-levers.ts), on the built app with real
 * PTYs. CI only (.github/workflows/terminal-load.yml); never in the smoke run (playwright.config.ts ignores e2e/perf/).
 *
 * Each arm is the app launched with OXESPACE_TERM_LEVERS set: base is 'none' (the terminal before OXE-411), H+Q is the
 * default since 1.6.0; OXESPACE_BREAKDOWN_ARMS picks others (earlier runs measured Q, H, M, I and H+M+I). Arms alternate their
 * order every round, on the same runner. Each launch opens a quiet workspace (2 panes) and a load workspace (10 panes,
 * 8 of them printing ~1 MB/s of ANSI text for LOAD_SECONDS) and measures two phases while the load runs:
 *  - visible: the load workspace is on screen (the OXE-120/OXE-349 perf-load scenario); typing in its idle pane;
 *  - hidden: the quiet workspace is on screen and the load goes on behind it; typing in a quiet pane.
 * Per phase: key echo (key event → echo painted from the PTY), Ctrl K → first item, main:loop p95 (net of the
 * recorder's tick), and CPU (% of one core) per process type: main, renderer, GPU, PTY host. Per launch: workspace
 * switch both ways, and the working set per process type at the peak and 10 s after the load.
 * In round 1, the base and H+Q arms also record a CPU profile of the renderer (top 10 functions by self time).
 *
 * Output: OXESPACE_BREAKDOWN_RESULTS (default test-results/terminal-load-breakdown): results.json, summary.md and the
 * renderer profiles. The numbers are reported, never asserted; what fails is a run that measured nothing.
 */
import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { existsSync, mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { LOOP_RESOLUTION_MS, loopReadingMs, type LoopRawNs } from '../../shared/perfLoop'
import { armInputTimerUntil, readInputTimer } from '../helpers/input-timer'
import { launchForPerf } from '../helpers/perf-launch'
import { armEnv, forceKill } from '../helpers/pty-host'

const ROUNDS = Number(process.env.OXESPACE_BREAKDOWN_ROUNDS ?? 5)
const ARMS: Array<{ name: string; levers: string }> = (process.env.OXESPACE_BREAKDOWN_ARMS ?? 'base,H+Q')
  .split(',').map(name => ({ name, levers: name === 'base' ? 'none' : name.split('+').join(',') }))
const OUT = process.env.OXESPACE_BREAKDOWN_RESULTS || join(process.cwd(), 'test-results', 'terminal-load-breakdown')
const LOADERS = 8
const LOAD_SECONDS = 40
const LOAD_RATE = 1024 * 1024
/** Each phase measures for at most this long, so both fit in the load. */
const PHASE_MS = 15_000

/** Prints LOAD_RATE bytes a second for LOAD_SECONDS in 50 ms steps, ANSI colours on every line, then exits. */
const LOADER = `
const total = ${LOAD_RATE * LOAD_SECONDS}, seconds = ${LOAD_SECONDS}
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

type Group = 'main' | 'renderer' | 'gpu' | 'ptyHost' | 'other'
type ByGroup = Record<Group, number>
interface Phase { echoMs: number[]; ctrlKMs: number[]; loopP95: number | null; cpu: ByGroup }
interface Launch {
  arm: string
  round: number
  /** main:loop p95 with the app open and nothing printing: the reading's floor on this runner. */
  idleLoopP95: number | null
  visible: Phase
  hidden: Phase
  switchToQuietMs: number | null
  switchBackMs: number | null
  peakMb: ByGroup
  afterMb: ByGroup
  loadedBytes: number
  profile?: Array<{ fn: string; selfMs: number }>
  errors: string[]
}
const launches: Launch[] = []

const zero = (): ByGroup => ({ main: 0, renderer: 0, gpu: 0, ptyHost: 0, other: 0 })

/** CPU seconds so far and working set (MB) of every process of the app, by type. */
async function processes(app: ElectronApplication): Promise<{ cpuSeconds: ByGroup; mb: ByGroup; at: number }> {
  const metrics = await app.evaluate(({ app: electronApp }) => electronApp.getAppMetrics().map(metric => ({
    type: metric.type, name: metric.name ?? '', cumulative: (metric.cpu as { cumulativeCPUUsage?: number }).cumulativeCPUUsage ?? null,
    percent: metric.cpu.percentCPUUsage, kb: metric.memory.workingSetSize
  })))
  const cpuSeconds = zero(), mb = zero()
  for (const metric of metrics) {
    const group: Group = metric.type === 'Browser' ? 'main' : metric.type === 'Tab' ? 'renderer' : metric.type === 'GPU' ? 'gpu'
      : metric.type === 'Utility' && metric.name === 'oxespace-pty-host' ? 'ptyHost' : 'other'
    cpuSeconds[group] += metric.cumulative ?? 0
    mb[group] += metric.kb / 1024
  }
  return { cpuSeconds, mb, at: Date.now() }
}

function cpuPercent(start: { cpuSeconds: ByGroup; at: number }, end: { cpuSeconds: ByGroup; at: number }): ByGroup {
  const seconds = (end.at - start.at) / 1000
  const out = zero()
  for (const key of Object.keys(out) as Group[]) out[key] = seconds > 0 ? ((end.cpuSeconds[key] - start.cpuSeconds[key]) / seconds) * 100 : 0
  return out
}

async function createWorkspace(page: Page, root: string, panes: number): Promise<string[]> {
  mkdirSync(root, { recursive: true })
  await page.getByTestId('btn-new-workspace').click()
  await page.getByTestId('wizard-dir-input').fill(root)
  await page.getByTestId(`wizard-layout-card-${panes}`).click()
  await page.getByTestId('wizard-launch-btn').click()
  const host = page.locator('.workspace-host:not(.workspace-host-hidden)')
  await expect(host.getByTestId('terminal-pane')).toHaveCount(panes, { timeout: 60_000 })
  await expect(host.getByTestId('terminal-status-label').filter({ hasText: 'running' })).toHaveCount(panes, { timeout: 90_000 })
  return (await host.getByTestId('terminal-pane').evaluateAll(nodes => nodes.map(node => node.getAttribute('data-pane-id') ?? ''))).filter(Boolean)
}

async function startLoop(app: ElectronApplication): Promise<boolean> {
  return await app.evaluate((_electron, resolution) => {
    const builtin = (process as unknown as { getBuiltinModule?: (id: string) => unknown }).getBuiltinModule
    const hooks = builtin?.('node:perf_hooks') as typeof import('node:perf_hooks') | undefined
    if (!hooks) return false
    const scope = globalThis as unknown as { __oxeBreakLoop?: ReturnType<typeof hooks.monitorEventLoopDelay> }
    scope.__oxeBreakLoop ??= hooks.monitorEventLoopDelay({ resolution })
    scope.__oxeBreakLoop.reset()
    scope.__oxeBreakLoop.enable()
    return true
  }, LOOP_RESOLUTION_MS)
}
async function readLoop(app: ElectronApplication): Promise<number> {
  const raw: LoopRawNs = await app.evaluate(() => {
    const loop = (globalThis as unknown as { __oxeBreakLoop: { percentile: (p: number) => number; max: number; disable: () => void } }).__oxeBreakLoop
    loop.disable()
    return { p50: loop.percentile(50), p95: loop.percentile(95), max: loop.max }
  })
  return loopReadingMs(raw).p95
}

/** A key typed in a pane, from its key event to its echo arriving from the PTY. */
async function keyEcho(page: Page, paneId: string): Promise<number> {
  await page.evaluate((id) => {
    const scope = window as unknown as { __oxeEcho?: { start: number | null; done: number | null; off: () => void } }
    scope.__oxeEcho?.off()
    const echo = { start: null as number | null, done: null as number | null, off: () => undefined as void }
    const onKey = (event: KeyboardEvent): void => { if (echo.start === null && event.key === 'a') echo.start = event.timeStamp }
    const offData = window.oxe.terminal.onData(id, event => { if (echo.start !== null && echo.done === null && event.data.includes('a')) echo.done = performance.now() })
    window.addEventListener('keydown', onKey, true)
    echo.off = () => { offData(); window.removeEventListener('keydown', onKey, true) }
    scope.__oxeEcho = echo
  }, paneId)
  await page.keyboard.press('a')
  await page.waitForFunction(() => (window as unknown as { __oxeEcho: { done: number | null } }).__oxeEcho.done !== null, undefined, { timeout: 10_000 })
  const ms = await page.evaluate(() => { const echo = (window as unknown as { __oxeEcho: { start: number; done: number; off: () => void } }).__oxeEcho; echo.off(); return echo.done - echo.start })
  await page.keyboard.press('Backspace')
  return ms
}

async function ctrlK(page: Page): Promise<number> {
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
}

async function switchTo(page: Page, label: string): Promise<number> {
  await armInputTimerUntil(page, [{ selector: '[data-testid="sidebar-workspace-item"][data-active]', text: label }])
  await page.getByTestId('sidebar-workspace-item').filter({ hasText: label }).getByTestId('sidebar-workspace-select').click({ timeout: 5_000 })
  return await readInputTimer(page, 5_000)
}

async function phase(app: ElectronApplication, page: Page, paneId: string, loaded: () => boolean, errors: string[], label: string): Promise<Phase> {
  const hasLoop = await startLoop(app)
  const start = await processes(app)
  const deadline = Date.now() + PHASE_MS
  const echoMs: number[] = [], ctrlKMs: number[] = []
  await page.locator(`[data-testid="terminal-pane"][data-pane-id="${paneId}"]`).click({ timeout: 5_000 })
  for (let i = 0; i < 5 && loaded() && Date.now() < deadline; i++) {
    try { echoMs.push(await keyEcho(page, paneId)) } catch (error) { errors.push(`${label} echo: ${String(error).split('\n')[0]}`) }
  }
  for (let i = 0; i < 3 && loaded() && Date.now() < deadline; i++) {
    try { ctrlKMs.push(await ctrlK(page)) } catch (error) { errors.push(`${label} Ctrl K: ${String(error).split('\n')[0]}`) }
  }
  // CPU over a fixed window, so every arm is charged for the same stretch of load.
  while (Date.now() < deadline && loaded()) await page.waitForTimeout(250)
  const end = await processes(app)
  return { echoMs, ctrlKMs, loopP95: hasLoop ? await readLoop(app) : null, cpu: cpuPercent(start, end) }
}

/** The renderer's CPU profile, top functions by self time. Null when this Electron gives no CDP session. */
async function startProfile(page: Page): Promise<null | (() => Promise<Array<{ fn: string; selfMs: number }>>)> {
  try {
    const cdp = await page.context().newCDPSession(page)
    await cdp.send('Profiler.enable')
    await cdp.send('Profiler.setSamplingInterval', { interval: 1000 })
    await cdp.send('Profiler.start')
    return async () => {
      const { profile } = await cdp.send('Profiler.stop') as { profile: { nodes: Array<{ id: number; callFrame: { functionName: string; url: string; lineNumber: number } }>; samples: number[]; timeDeltas: number[] } }
      writeFileSync(join(OUT, `renderer-${Date.now()}.cpuprofile`), JSON.stringify(profile))
      const byNode = new Map(profile.nodes.map(node => [node.id, node]))
      const self = new Map<string, number>()
      profile.samples.forEach((id, index) => {
        const frame = byNode.get(id)?.callFrame
        if (!frame) return
        const key = `${frame.functionName || '(anonymous)'} ${frame.url.split('/').pop() ?? ''}:${frame.lineNumber + 1}`
        self.set(key, (self.get(key) ?? 0) + (profile.timeDeltas[index] ?? 0) / 1000)
      })
      return [...self.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([fn, selfMs]) => ({ fn, selfMs }))
    }
  } catch { return null }
}

async function runArm(arm: { name: string; levers: string }, round: number): Promise<Launch> {
  const link = join(process.cwd(), 'e2e', 'out')
  if (!existsSync(link)) { try { symlinkSync(join(process.cwd(), 'out'), link, 'junction') } catch { /* exists */ } }
  const root = mkdtempSync(join(tmpdir(), `oxe-break-${arm.name.replace(/\W/g, '')}-`))
  const loaderFile = join(root, 'load.cjs')
  writeFileSync(loaderFile, LOADER)
  const env = { ...armEnv('B', root), ...(arm.levers ? { OXESPACE_TERM_LEVERS: arm.levers } : {}) }
  const app = await launchForPerf(env)
  const child = app.process()
  const errors: string[] = []
  try {
    const page = await app.firstWindow()
    const quiet = await createWorkspace(page, join(root, 'quiet-repo'), 2)
    const load = await createWorkspace(page, join(root, 'load-repo'), 10)
    const loaders = load.slice(0, LOADERS)
    const idle = load[LOADERS]
    await page.evaluate((ids) => {
      const scope = window as unknown as { __oxeBreakBytes?: { total: number } }
      const counter = { total: 0 }
      for (const id of ids) window.oxe.terminal.onData(id, event => { counter.total += event.data.length })
      scope.__oxeBreakBytes = counter
    }, loaders)
    // The loop's floor: 5 s with nothing printing, before the load.
    let idleLoopP95: number | null = null
    if (await startLoop(app)) { await page.waitForTimeout(5_000); idleLoopP95 = await readLoop(app) }
    const profile = round === 1 && (arm.name === 'base' || arm.name === 'H+Q') ? await startProfile(page) : null
    for (const paneId of loaders) await page.evaluate(({ paneId, command }) => window.oxe.terminal.write({ paneId, data: command }), { paneId, command: `node "${loaderFile}"\r` })
    const startedAt = Date.now()
    const loaded = (): boolean => Date.now() - startedAt < (LOAD_SECONDS - 2) * 1000
    const peak = zero()
    const sampler = setInterval(() => { void processes(app).then(now => { for (const key of Object.keys(peak) as Group[]) peak[key] = Math.max(peak[key], now.mb[key]) }).catch(() => undefined) }, 1000)

    await page.waitForTimeout(1500)
    const visible = await phase(app, page, idle, loaded, errors, 'visible')
    const loadedBytes = await page.evaluate(() => (window as unknown as { __oxeBreakBytes: { total: number } }).__oxeBreakBytes.total)
    let switchToQuietMs: number | null = null
    try { switchToQuietMs = await switchTo(page, 'quiet-repo') } catch (error) { errors.push(`switch to quiet: ${String(error).split('\n')[0]}`) }
    const hidden = await phase(app, page, quiet[0], loaded, errors, 'hidden')
    let switchBackMs: number | null = null
    try { switchBackMs = await switchTo(page, 'load-repo') } catch (error) { errors.push(`switch back: ${String(error).split('\n')[0]}`) }
    const top = profile ? await profile().catch(() => undefined) : undefined

    while (Date.now() - startedAt < (LOAD_SECONDS + 3) * 1000) await page.waitForTimeout(1000)
    clearInterval(sampler)
    const end = await processes(app)
    for (const key of Object.keys(peak) as Group[]) peak[key] = Math.max(peak[key], end.mb[key])
    await page.waitForTimeout(10_000)
    const after = await processes(app)
    return { arm: arm.name, round, idleLoopP95, visible, hidden, switchToQuietMs, switchBackMs, peakMb: peak, afterMb: after.mb, loadedBytes, ...(top ? { profile: top } : {}), errors }
  } finally {
    await Promise.race([app.close().catch(() => undefined), new Promise(resolve => setTimeout(resolve, 5_000))])
    forceKill(child)
  }
}

const median = (values: number[]): number | null => quantile(values, 0.5)
function quantile(values: number[], q: number): number | null {
  const list = values.filter(Number.isFinite).sort((a, b) => a - b)
  return list.length ? list[Math.min(list.length - 1, Math.max(0, Math.ceil(q * list.length) - 1))] : null
}
const f = (value: number | null | undefined, digits = 0): string => (value === null || value === undefined ? '—' : value.toFixed(digits))

function summary(): string {
  const lines = [`## ${process.platform} (${ROUNDS} rounds; median, p95 over every sample of the arm)`, '']
  for (const which of ['visible', 'hidden'] as const) {
    lines.push(`### Load ${which === 'visible' ? 'on screen' : 'in a hidden workspace'}`, '',
      '| Arm | Echo p50 / p95 ms | Ctrl K p50 / p95 ms | main:loop p95 ms (idle floor) | CPU % main | renderer | GPU | PTY host | total |',
      '| --- | --- | --- | --- | --- | --- | --- | --- | --- |')
    for (const arm of ARMS) {
      const rows = launches.filter(launch => launch.arm === arm.name)
      const echo = rows.flatMap(row => row[which].echoMs), ctrl = rows.flatMap(row => row[which].ctrlKMs)
      const cpu = (key: Group): number | null => median(rows.map(row => row[which].cpu[key]))
      const total = median(rows.map(row => Object.values(row[which].cpu).reduce((a, b) => a + b, 0)))
      lines.push(`| ${arm.name} | ${f(median(echo))} / ${f(quantile(echo, 0.95))} | ${f(median(ctrl))} / ${f(quantile(ctrl, 0.95))} | ${f(median(rows.map(row => row[which].loopP95 ?? NaN)), 1)} (${f(median(rows.map(row => row.idleLoopP95 ?? NaN)), 1)}) | ${f(cpu('main'))} | ${f(cpu('renderer'))} | ${f(cpu('gpu'))} | ${f(cpu('ptyHost'))} | ${f(total)} |`)
    }
    lines.push('')
  }
  lines.push('### Workspace switch and memory', '',
    '| Arm | Switch to quiet / back p50 ms | Peak MB main | renderer | GPU | PTY host | total | 10 s after total |',
    '| --- | --- | --- | --- | --- | --- | --- | --- |')
  for (const arm of ARMS) {
    const rows = launches.filter(launch => launch.arm === arm.name)
    const mb = (key: Group): number | null => median(rows.map(row => row.peakMb[key]))
    lines.push(`| ${arm.name} | ${f(median(rows.map(row => row.switchToQuietMs ?? NaN)))} / ${f(median(rows.map(row => row.switchBackMs ?? NaN)))} | ${f(mb('main'))} | ${f(mb('renderer'))} | ${f(mb('gpu'))} | ${f(mb('ptyHost'))} | ${f(median(rows.map(row => Object.values(row.peakMb).reduce((a, b) => a + b, 0))))} | ${f(median(rows.map(row => Object.values(row.afterMb).reduce((a, b) => a + b, 0))))} |`)
  }
  for (const launch of launches.filter(row => row.profile)) {
    lines.push('', `### Renderer CPU profile, ${launch.arm} (round ${launch.round}): top 10 by self time`, '', '| Function | Self ms |', '| --- | --- |')
    for (const entry of launch.profile ?? []) lines.push(`| \`${entry.fn.replace(/\|/g, '/')}\` | ${f(entry.selfMs)} |`)
  }
  const errors = launches.flatMap(row => row.errors.map(error => `${row.arm} r${row.round}: ${error}`))
  if (errors.length) lines.push('', '### Samples not measured', '', ...errors.map(error => `- ${error}`))
  return lines.join('\n')
}

test.describe.serial('the terminal under load, lever by lever (OXE-411)', () => {
  test('each lever against the baseline under the perf-load scenario', async () => {
    test.setTimeout(ROUNDS * ARMS.length * 4 * 60_000)
    mkdirSync(OUT, { recursive: true })
    for (let round = 1; round <= ROUNDS; round++) {
      const shift = (round - 1) % ARMS.length
      for (const arm of [...ARMS.slice(shift), ...ARMS.slice(0, shift)]) {
        const launch = await runArm(arm, round)
        launches.push(launch)
        console.log(`[BREAKDOWN] ${arm.name} r${round} echo visible ${f(median(launch.visible.echoMs))} hidden ${f(median(launch.hidden.echoMs))} ms; cpu total visible ${f(Object.values(launch.visible.cpu).reduce((a, b) => a + b, 0))}% hidden ${f(Object.values(launch.hidden.cpu).reduce((a, b) => a + b, 0))}%; ${(launch.loadedBytes / 2 ** 20).toFixed(1)} MiB on screen`)
        writeFileSync(join(OUT, 'results.json'), JSON.stringify(launches, null, 2))
      }
    }
    writeFileSync(join(OUT, 'summary.md'), summary())
    console.log(summary())
    for (const arm of ARMS) {
      const rows = launches.filter(launch => launch.arm === arm.name)
      expect(rows.flatMap(row => row.visible.echoMs).length, `${arm.name}: key echo measured with the load on screen`).toBeGreaterThan(0)
      expect(rows.flatMap(row => row.hidden.echoMs).length, `${arm.name}: key echo measured with the load hidden`).toBeGreaterThan(0)
      expect(Math.max(...rows.map(row => row.loadedBytes)), `${arm.name}: the load reached the window`).toBeGreaterThan(4 * 2 ** 20)
    }
  })

  test('working set by process type at the peak and after the load', () => {
    expect(launches.length).toBeGreaterThan(0)
    for (const launch of launches) expect(launch.peakMb.main + launch.peakMb.renderer, `${launch.arm} r${launch.round}: memory read`).toBeGreaterThan(0)
  })

  test('renderer CPU profile under load', () => {
    const profiled = launches.filter(launch => launch.profile)
    test.info().annotations.push({ type: 'profiles', description: profiled.map(launch => launch.arm).join(', ') || 'none: no CDP session in this Electron' })
    expect(profiled.length, 'the base and H+Q renderer profiles were recorded').toBeGreaterThan(0)
  })
})
