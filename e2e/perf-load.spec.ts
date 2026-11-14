/**
 * OXE-120, Phase 0: the app under a real terminal load, on CI (linux-x64 and windows-x64).
 *
 * The performance gate runs mostly with the E2E mocks, which hide what eight busy terminals cost. This spec starts the
 * built app with the real natives (database, PTYs, services) and a throwaway profile, opens a workspace with nine
 * terminals, and has eight of them print ~1 MiB/s of ANSI text (colors, carriage-return progress, long wrapped lines)
 * for 20 s while the ninth sits idle at its prompt. Under that load, three rounds measure:
 *  - the main process's event-loop delay, from the performance journal's `main:loop` (#786), plus a finer histogram;
 *  - a key typed in the idle pane: keydown to its echo reaching the window's terminal stream, to the next frame;
 *  - Ctrl+K to the command bar's first option;
 *  - a workspace switch to the shown grid with all its panes;
 *  - the app's working set (every Electron process) at the peak of the load and 10 s after it.
 * Each prints `[LOAD] <metric> median/p95 <value> <ms|MB>`; CI keeps those lines in the perf-load-<os> artifact.
 * Report only (CA-5): no budget fails it until main's first five runs set them. What does fail it is a scenario that
 * did not run, or a load that did not reach the terminals: the bytes the eight panes received must be within 10% of
 * 8 × 20 MiB.
 *
 * Build first: npm run build · Run: npx playwright test --config playwright.tools.config.ts perf-load.spec.ts
 */
import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { launchApp, type LaunchedApp } from './helpers/launch'
import { armInputTimerUntil, readInputTimer } from './helpers/input-timer'
import { emptyStat, mergeStat, quantile, type PerfStat } from '../electron/main/services/perf/perf-journal'

const ROUNDS = 3
const LOAD_PANES = 8
const LOAD_SECONDS = 20
const LOAD_BYTES = 20 * 1024 * 1024
const ECHO_KEYS = 'abcdefgh'
const COMMAND_BAR_OPENS = 4
const SWITCH_PAIRS = 2
/** CA-5: report only. Budgets come from the median of main's first five runs, and are not set yet. */
const BUDGETS: Record<string, number> = {}

/** The load each busy pane runs: 20 MiB of ASCII with ANSI, at ~1 MiB/s, between two markers. */
const LOAD_SCRIPT = `
const TOTAL = ${LOAD_BYTES}, DURATION = ${LOAD_SECONDS * 1000}, TICK = 20
const colors = [31, 32, 33, 34, 35, 36, 37, 90, 91, 92, 93, 94]
let pattern = ''
for (let line = 0; pattern.length < 64 * 1024; line++) {
  const color = colors[line % colors.length]
  if (line % 7 === 0) {
    // A progress bar redrawn in place with carriage returns.
    for (let step = 0; step <= 100; step += 20) pattern += '\\x1b[1;' + color + 'mprogress ' + String(step).padStart(3) + '% ' + '#'.repeat(step / 4).padEnd(25, '.') + '\\x1b[0m\\r'
    pattern += '\\n'
  } else if (line % 5 === 0) {
    // A long line that wraps several times in a narrow pane.
    pattern += '\\x1b[' + color + 'm' + ('long-line-' + line + ' ').repeat(160) + '\\x1b[0m\\n'
  } else {
    pattern += '\\x1b[2m' + String(line).padStart(6, '0') + '\\x1b[0m \\x1b[' + color + 'mINFO\\x1b[0m \\x1b[4mworker-' + (line % 9) + '\\x1b[24m ' + 'lorem ipsum dolor sit amet '.repeat(3) + '\\x1b[38;5;' + (line % 256) + 'm256\\x1b[0m\\n'
  }
}
let sent = 0
const start = Date.now()
process.stdout.write('OXE_LOAD_BEGIN\\n')
function tick() {
  const due = Math.min(TOTAL, Math.round(TOTAL * (Date.now() - start) / DURATION))
  let chunk = ''
  while (sent + chunk.length < due) {
    const at = (sent + chunk.length) % pattern.length
    chunk += pattern.slice(at, at + (due - sent - chunk.length))
  }
  sent += chunk.length
  const flowing = chunk ? process.stdout.write(chunk) : true
  if (sent >= TOTAL) { process.stdout.write('\\x1b[0m\\nOXE_LOAD_END ' + (Date.now() - start) + '\\n'); return }
  if (flowing) setTimeout(tick, TICK)
  else process.stdout.once('drain', () => setTimeout(tick, TICK))
}
tick()
`

interface Round {
  loopJournal: PerfStat | null
  loopFine: { p50: number; p95: number; max: number } | null
  echo: number[]
  commandBar: number[]
  workspaceSwitch: number[]
  /** Samples taken while every busy pane was still printing. */
  underLoad: number
  samples: number
  peakMb: number
  afterMb: number
  bytes: number[]
  loadMs: number[]
}

const rounds: Round[] = []
let launched: LaunchedApp | null = null
let inheritedRemoved: string[] = []

const sorted = (values: number[]): number[] => [...values].sort((a, b) => a - b)
/** Nearest-rank percentile. */
function percentile(values: number[], q: number): number {
  const list = sorted(values)
  if (!list.length) return Number.NaN
  return list[Math.min(list.length - 1, Math.max(0, Math.ceil(list.length * q) - 1))]
}
const fixed = (value: number): string => Number.isFinite(value) ? value.toFixed(1) : 'n/a'

test.describe.configure({ mode: 'serial' })

test.afterAll(async () => {
  if (!launched) return
  const { app } = launched
  await Promise.race([app.close().catch(() => undefined), new Promise(resolveWait => setTimeout(resolveWait, 8_000))])
})

test('no user data: a temporary profile and no inherited OXESPACE_ variable', async () => {
  test.setTimeout(90_000)
  // The runner's own variables never reach the app: launchApp sets the ones it needs on top of what is left.
  inheritedRemoved = Object.keys(process.env).filter(key => /^OXESPACE_/i.test(key))
  for (const key of inheritedRemoved) delete process.env[key]
  if (inheritedRemoved.length) console.log(`[LOAD] note: removed inherited ${inheritedRemoved.join(', ')}`)
  launched = await launchApp({ mockNative: false, realClock: true })
  const { app, root } = launched
  const main = await app.evaluate(({ app: electronApp }) => ({
    userData: electronApp.getPath('userData'),
    oxespace: Object.keys(process.env).filter(key => /^OXESPACE_/i.test(key)).sort()
  }))
  expect(resolve(main.userData).toLowerCase().startsWith(resolve(root).toLowerCase()), `userData ${main.userData} is under the temporary root`).toBe(true)
  // What the app sees is what launchApp set (and what the app sets for itself), never one the runner had.
  console.log(`[LOAD] note: OXESPACE_ variables in the main process: ${main.oxespace.join(', ') || 'none'}`)
  const own = ['OXESPACE_DB_PATH', 'OXESPACE_DISABLE_SINGLE_INSTANCE', 'OXESPACE_E2E_MOCK_NATIVE', 'OXESPACE_LOCALE']
  expect(main.oxespace.filter(key => inheritedRemoved.some(name => name.toUpperCase() === key.toUpperCase()) && !own.includes(key)), 'no inherited OXESPACE_ variable').toEqual([])
  expect(Object.keys(process.env).filter(key => /^OXESPACE_/i.test(key) && !own.includes(key)), 'the runner env passed on has none left').toEqual([])
  expect(await app.evaluate(() => process.env.OXESPACE_E2E_MOCK_NATIVE), 'real natives').toBe('0')
})

/** Creates a workspace through the wizard with the given layout preset and waits for its terminals to run. */
async function createWorkspace(page: Page, root: string, panes: number): Promise<string[]> {
  mkdirSync(root, { recursive: true })
  await page.getByTestId('btn-new-workspace').click()
  await page.getByTestId('wizard-dir-input').fill(root)
  await page.getByTestId(`wizard-layout-card-${panes}`).click()
  await page.getByTestId('wizard-launch-btn').click()
  const host = page.locator('.workspace-host:not(.workspace-host-hidden)')
  await expect(host.getByTestId('terminal-pane')).toHaveCount(panes, { timeout: 30_000 })
  return await host.getByTestId('terminal-pane').evaluateAll(nodes => nodes.map(node => node.getAttribute('data-pane-id') ?? ''))
}

async function waitForRunning(page: Page, count: number): Promise<void> {
  await expect.poll(
    () => page.locator('.workspace-host:not(.workspace-host-hidden) [data-testid="terminal-status-label"]').evaluateAll(nodes => nodes.filter(node => node.textContent?.trim() === 'running').length),
    { message: `${count} terminals running`, timeout: 60_000 }
  ).toBeGreaterThanOrEqual(count)
}

/** A shell is ready once it printed its prompt and then stayed quiet for a moment. */
async function waitForPrompts(page: Page, paneIds: string[]): Promise<void> {
  const lengths = async (): Promise<number[]> => page.evaluate(ids => Promise.all(ids.map(paneId => window.oxe.terminal.attach({ paneId }).then(result => result.replay.length))), paneIds)
  let last = await lengths()
  const deadline = Date.now() + 60_000
  for (;;) {
    await page.waitForTimeout(1_500)
    const next = await lengths()
    if (next.every((length, index) => length > 0 && length === last[index])) return
    if (Date.now() > deadline) throw new Error(`shells never settled at a prompt: ${JSON.stringify(next)}`)
    last = next
  }
}

/** Counts every byte the window receives per pane on the terminal stream TerminalView writes into xterm.js. */
async function armCounters(page: Page, paneIds: string[]): Promise<void> {
  await page.evaluate(ids => {
    type Counters = { bytes: Record<string, number>; tail: Record<string, string>; begun: Record<string, boolean>; ended: Record<string, number | null>; off: Array<() => void> }
    const scope = window as unknown as { __oxeLoad?: Counters }
    for (const off of scope.__oxeLoad?.off ?? []) off()
    const counters: Counters = { bytes: {}, tail: {}, begun: {}, ended: {}, off: [] }
    for (const paneId of ids) {
      counters.bytes[paneId] = 0; counters.tail[paneId] = ''; counters.begun[paneId] = false; counters.ended[paneId] = null
      counters.off.push(window.oxe.terminal.onData(paneId, event => {
        counters.bytes[paneId] += event.data.length
        const text = counters.tail[paneId] + event.data
        if (!counters.begun[paneId] && text.includes('OXE_LOAD_BEGIN')) counters.begun[paneId] = true
        const end = /OXE_LOAD_END (\d+)/.exec(text)
        if (end && counters.ended[paneId] === null) counters.ended[paneId] = Number(end[1])
        counters.tail[paneId] = text.slice(-64)
      }))
    }
    scope.__oxeLoad = counters
  }, paneIds)
}

type LoadState = { bytes: Record<string, number>; begun: Record<string, boolean>; ended: Record<string, number | null> }
const loadState = (page: Page): Promise<LoadState> => page.evaluate(() => {
  const counters = (window as unknown as { __oxeLoad: LoadState }).__oxeLoad
  return { bytes: { ...counters.bytes }, begun: { ...counters.begun }, ended: { ...counters.ended } }
})
const stillLoading = async (page: Page): Promise<boolean> => Object.values((await loadState(page)).ended).every(value => value === null)

/** Writes the performance journal's current window (the diagnostics bundle reads it) and returns its `main:loop`. */
async function flushJournal(page: Page, root: string): Promise<PerfStat | null> {
  await page.evaluate(() => window.oxe.diagnostics.previewBundle?.())
  const file = join(root, 'user-data', 'diagnostics', 'performance.0.jsonl')
  if (!existsSync(file)) return null
  const lines = readFileSync(file, 'utf8').trim().split('\n').reverse()
  for (const line of lines) {
    try {
      const stat = (JSON.parse(line) as { stats?: Record<string, PerfStat> }).stats?.['main:loop']
      if (stat) return stat
    } catch { /* a partial line */ }
  }
  return null
}

/** A finer event-loop histogram in the main process (10 ms resolution), next to the journal's 20 ms buckets. */
async function resetFineLoop(app: ElectronApplication): Promise<void> {
  await app.evaluate(() => {
    const scope = globalThis as unknown as { __oxeLoadLoop?: { enable(): void; reset(): void } }
    if (!scope.__oxeLoadLoop) {
      const { monitorEventLoopDelay } = process.getBuiltinModule('node:perf_hooks')
      scope.__oxeLoadLoop = monitorEventLoopDelay({ resolution: 10 })
      scope.__oxeLoadLoop.enable()
    }
    scope.__oxeLoadLoop.reset()
  })
}
async function readFineLoop(app: ElectronApplication): Promise<Round['loopFine']> {
  return await app.evaluate(() => {
    const histogram = (globalThis as unknown as { __oxeLoadLoop?: { count: number; max: number; percentile(q: number): number } }).__oxeLoadLoop
    if (!histogram || !histogram.count) return null
    const delay = (ns: number): number => Math.max(0, ns / 1e6 - 10)
    return { p50: delay(histogram.percentile(50)), p95: delay(histogram.percentile(95)), max: delay(histogram.max) }
  })
}

/** Samples the working set of every Electron process every 500 ms in the main process; returns the peak since start. */
async function startMemorySampler(app: ElectronApplication): Promise<void> {
  await app.evaluate(({ app: electronApp }) => {
    const scope = globalThis as unknown as { __oxeLoadMemory?: { peak: number; timer: ReturnType<typeof setInterval> } }
    if (scope.__oxeLoadMemory) clearInterval(scope.__oxeLoadMemory.timer)
    const total = (): number => electronApp.getAppMetrics().reduce((sum, metric) => sum + metric.memory.workingSetSize, 0) / 1024
    const state = { peak: total(), timer: setInterval(() => { state.peak = Math.max(state.peak, total()) }, 500) }
    scope.__oxeLoadMemory = state
  })
}
async function stopMemorySampler(app: ElectronApplication): Promise<number> {
  return await app.evaluate(() => {
    const state = (globalThis as unknown as { __oxeLoadMemory?: { peak: number; timer: ReturnType<typeof setInterval> } }).__oxeLoadMemory
    if (!state) return Number.NaN
    clearInterval(state.timer)
    return state.peak
  })
}
const workingSetMb = (app: ElectronApplication): Promise<number> => app.evaluate(({ app: electronApp }) => electronApp.getAppMetrics().reduce((sum, metric) => sum + metric.memory.workingSetSize, 0) / 1024)

/** Keydown in the idle pane to the first output the window receives for it (its echo), to the next frame. */
async function timeEcho(page: Page, idlePane: string, key: string): Promise<number> {
  await page.evaluate(paneId => {
    type Echo = { start: number | null; done: number | null; off: () => void }
    const scope = window as unknown as { __oxeEcho?: Echo }
    scope.__oxeEcho?.off()
    const echo: Echo = { start: null, done: null, off: () => undefined }
    const begin = (event: KeyboardEvent): void => { if (echo.start === null) echo.start = event.timeStamp }
    window.addEventListener('keydown', begin, true)
    const unsubscribe = window.oxe.terminal.onData(paneId, () => {
      if (echo.start === null || echo.done !== null) return
      requestAnimationFrame(() => { if (echo.done === null) echo.done = performance.now() })
    })
    echo.off = () => { window.removeEventListener('keydown', begin, true); unsubscribe() }
    scope.__oxeEcho = echo
  }, idlePane)
  await page.keyboard.press(key)
  await page.waitForFunction(() => (window as unknown as { __oxeEcho?: { done: number | null } }).__oxeEcho?.done != null, undefined, { timeout: 10_000 })
  return await page.evaluate(() => {
    const echo = (window as unknown as { __oxeEcho: { start: number; done: number; off: () => void } }).__oxeEcho
    echo.off()
    return echo.done - echo.start
  })
}

async function focusPane(page: Page, paneId: string): Promise<void> {
  const input = page.locator(`[data-terminal-pane="${paneId}"] .xterm-helper-textarea`)
  await input.focus()
  await expect.poll(() => page.evaluate(id => document.activeElement?.closest('[data-terminal-pane]')?.getAttribute('data-terminal-pane') === id, paneId)).toBe(true)
}

async function selectWorkspace(page: Page, label: string, panes: number): Promise<number> {
  const target = page.getByTestId('sidebar-workspace-item').filter({ hasText: label })
  await armInputTimerUntil(page, [
    { selector: '.ws-group.active', text: label },
    { selector: '.workspace-host:not(.workspace-host-hidden) [data-testid="terminal-pane"]', countAbove: panes - 1 }
  ])
  await target.getByTestId('sidebar-workspace-select').click()
  return await readInputTimer(page, 15_000)
}

test('load scenario: 8 terminals at ~1 MiB/s of ANSI text and an idle one, measured over 3 rounds', async () => {
  test.setTimeout(600_000)
  expect(launched, 'the app started (previous test)').not.toBeNull()
  const { app, page, root } = launched!
  await page.getByTestId('btn-new-workspace').waitFor({ state: 'visible', timeout: 60_000 })

  const alphaRoot = join(root, 'load-alpha')
  const betaRoot = join(root, 'load-beta')
  const loadPanes = await createWorkspace(page, alphaRoot, LOAD_PANES)
  await waitForRunning(page, LOAD_PANES)
  // The ninth pane, idle at its prompt: a split of the first.
  await page.locator('.workspace-host:not(.workspace-host-hidden) [data-testid="pane-container"]').first().click()
  await page.getByRole('button', { name: 'Files & commands' }).first().click()
  const commandInput = page.getByPlaceholder('Search files and commands…')
  await commandInput.fill('split')
  const split = page.locator('[cmdk-item][data-value="cmd-split-vertical"]')
  await split.waitFor({ state: 'visible' })
  await split.click()
  const host = page.locator('.workspace-host:not(.workspace-host-hidden)')
  await expect(host.getByTestId('terminal-pane'), 'a ninth pane from the split').toHaveCount(LOAD_PANES + 1, { timeout: 15_000 })
  const allAlpha = await host.getByTestId('terminal-pane').evaluateAll(nodes => nodes.map(node => node.getAttribute('data-pane-id') ?? ''))
  const idlePane = allAlpha.find(id => !loadPanes.includes(id))!
  expect(idlePane, 'the idle pane has an id').toBeTruthy()
  await waitForRunning(page, LOAD_PANES + 1)
  writeFileSync(join(alphaRoot, 'oxe-load.js'), LOAD_SCRIPT)

  const betaPanes = await createWorkspace(page, betaRoot, 1)
  await waitForRunning(page, 1)
  await waitForPrompts(page, betaPanes)
  await selectWorkspace(page, 'load-alpha', LOAD_PANES + 1)
  await waitForPrompts(page, [...loadPanes, idlePane])
  // The first bundle loads the diagnostics runtime; its cost stays out of the first round.
  await flushJournal(page, root)

  for (let round = 1; round <= ROUNDS; round++) {
    const result: Round = { loopJournal: null, loopFine: null, echo: [], commandBar: [], workspaceSwitch: [], underLoad: 0, samples: 0, peakMb: 0, afterMb: 0, bytes: [], loadMs: [] }
    await page.waitForTimeout(1_000)
    await armCounters(page, loadPanes)
    await flushJournal(page, root)
    await resetFineLoop(app)
    await startMemorySampler(app)
    await page.evaluate(ids => Promise.all(ids.map(paneId => window.oxe.terminal.write({ paneId, data: 'node oxe-load.js\r' }))), loadPanes)
    await expect.poll(async () => Object.values((await loadState(page)).begun).filter(Boolean).length, { message: 'every busy pane started its load', timeout: 20_000 }).toBe(LOAD_PANES)
    const startedAt = Date.now()
    const sample = async (list: number[], measure: () => Promise<number>): Promise<void> => {
      const loading = await stillLoading(page)
      list.push(await measure())
      result.samples++
      if (loading && await stillLoading(page)) result.underLoad++
    }

    await page.waitForTimeout(1_500)
    await focusPane(page, idlePane)
    for (const key of ECHO_KEYS) {
      await sample(result.echo, () => timeEcho(page, idlePane, key))
      await page.waitForTimeout(250)
    }
    for (let i = 0; i < ECHO_KEYS.length; i++) await page.keyboard.press('Backspace')

    const firstOption = '[role="dialog"][aria-modal="true"] [role="option"]'
    for (let i = 0; i < COMMAND_BAR_OPENS; i++) {
      await sample(result.commandBar, async () => {
        await armInputTimerUntil(page, [{ selector: firstOption }])
        await page.keyboard.press('Control+K')
        return await readInputTimer(page, 15_000)
      })
      await page.keyboard.press('Escape')
      await expect(page.locator('[role="dialog"][aria-modal="true"] [role="combobox"]')).toHaveCount(0)
      await page.waitForTimeout(200)
    }

    for (let i = 0; i < SWITCH_PAIRS; i++) {
      await sample(result.workspaceSwitch, () => selectWorkspace(page, 'load-beta', 1))
      await page.waitForTimeout(200)
      await sample(result.workspaceSwitch, () => selectWorkspace(page, 'load-alpha', LOAD_PANES + 1))
      await page.waitForTimeout(200)
    }

    await expect.poll(async () => Object.values((await loadState(page)).ended).filter(value => value !== null).length, { message: 'every busy pane finished its load', timeout: 120_000, intervals: [1_000] }).toBe(LOAD_PANES)
    // What was still in flight to the window when the last marker arrived.
    await page.waitForTimeout(1_000)
    const state = await loadState(page)
    result.bytes = loadPanes.map(id => state.bytes[id])
    result.loadMs = loadPanes.map(id => state.ended[id] ?? Number.NaN)
    result.loopJournal = await flushJournal(page, root)
    result.loopFine = await readFineLoop(app)
    result.peakMb = await stopMemorySampler(app)
    await page.waitForTimeout(10_000)
    result.afterMb = await workingSetMb(app)
    rounds.push(result)
    const total = result.bytes.reduce((sum, value) => sum + value, 0)
    console.log(
      `[LOAD] round ${round}: ${(total / 1024 / 1024).toFixed(1)} MiB received in ${((Date.now() - startedAt) / 1000).toFixed(1)} s; ` +
      `load ${fixed(percentile(result.loadMs, 0.5) / 1000)}-${fixed(Math.max(...result.loadMs) / 1000)} s per pane; ` +
      `${result.underLoad}/${result.samples} samples under load; peak ${fixed(result.peakMb)} MB, after 10 s ${fixed(result.afterMb)} MB`
    )
  }
  expect(rounds).toHaveLength(ROUNDS)
})

test('[LOAD] output: median and p95 of every measure', async () => {
  expect(rounds, 'the scenario ran its rounds').toHaveLength(ROUNDS)
  const os = process.platform === 'win32' ? 'windows' : process.platform
  const lines: Array<{ metric: string; median: number; p95: number; unit: 'ms' | 'MB'; note: string }> = []
  const merged = emptyStat()
  for (const round of rounds) if (round.loopJournal) mergeStat(merged, round.loopJournal)
  // Bucket bounds (16, 33, 50, 100…), as the journal keeps them; n is one sample per 20 ms tick.
  lines.push({ metric: 'main:loop (perf-journal)', median: merged.n ? quantile(merged, 0.5) : Number.NaN, p95: merged.n ? quantile(merged, 0.95) : Number.NaN, unit: 'ms', note: `bucket bounds, n=${merged.n}, max=${fixed(merged.max)} ms` })
  const fine = rounds.map(round => round.loopFine).filter((value): value is NonNullable<Round['loopFine']> => value !== null)
  lines.push({ metric: 'main:loop (10 ms histogram)', median: percentile(fine.map(value => value.p50), 0.5), p95: percentile(fine.map(value => value.p95), 0.5), unit: 'ms', note: `per-round p50 and p95, median of ${fine.length} rounds; max=${fixed(Math.max(...fine.map(value => value.max)))} ms` })
  const pooled = (pick: (round: Round) => number[]): number[] => rounds.flatMap(pick)
  for (const [metric, values] of [
    ['echo in the idle pane', pooled(round => round.echo)],
    ['Ctrl+K to first item', pooled(round => round.commandBar)],
    ['workspace switch to grid', pooled(round => round.workspaceSwitch)]
  ] as const) lines.push({ metric, median: percentile([...values], 0.5), p95: percentile([...values], 0.95), unit: 'ms', note: `n=${values.length}, max=${fixed(Math.max(...values))} ms` })
  lines.push({ metric: 'working set at peak', median: percentile(rounds.map(round => round.peakMb), 0.5), p95: percentile(rounds.map(round => round.peakMb), 0.95), unit: 'MB', note: `${ROUNDS} rounds, every Electron process` })
  lines.push({ metric: 'working set 10 s after', median: percentile(rounds.map(round => round.afterMb), 0.5), p95: percentile(rounds.map(round => round.afterMb), 0.95), unit: 'MB', note: `${ROUNDS} rounds, every Electron process` })
  const underLoad = rounds.reduce((sum, round) => sum + round.underLoad, 0)
  const samples = rounds.reduce((sum, round) => sum + round.samples, 0)
  console.log(`[LOAD] ${os}: ${LOAD_PANES} panes × ${LOAD_BYTES / 1024 / 1024} MiB in ${LOAD_SECONDS} s + 1 idle pane, ${ROUNDS} rounds; ${underLoad}/${samples} interaction samples taken under load`)
  for (const line of lines) console.log(`[LOAD] ${line.metric} median/p95 ${fixed(line.median)}/${fixed(line.p95)} ${line.unit} (${line.note})`)
  for (const line of lines) expect(Number.isFinite(line.median) && Number.isFinite(line.p95), `${line.metric} was measured`).toBe(true)
  // CA-5: report only while BUDGETS is empty.
  for (const line of lines) if (BUDGETS[line.metric] !== undefined) expect(line.p95, `${line.metric} p95`).toBeLessThanOrEqual(BUDGETS[line.metric])
})

test('real load: the bytes the 8 terminals received are within 10% of 8 × 20 MiB', async () => {
  expect(rounds, 'the scenario ran its rounds').toHaveLength(ROUNDS)
  const expected = LOAD_PANES * LOAD_BYTES
  const results = rounds.map(round => round.bytes.reduce((sum, value) => sum + value, 0))
  const worst = results.reduce((far, value) => Math.abs(value - expected) > Math.abs(far - expected) ? value : far, results[0])
  const verdict = results.every(value => Math.abs(value - expected) / expected <= 0.1) ? 'PASS' : 'FAIL'
  console.log(`[LOAD] real-load ${verdict}: received ${results.map(value => (value / 1024 / 1024).toFixed(1)).join(' / ')} MiB per round, expected ${(expected / 1024 / 1024).toFixed(0)} MiB ±10% (worst ${(100 * (worst - expected) / expected).toFixed(1)}%)`)
  for (const [index, round] of rounds.entries()) console.log(`[LOAD] real-load round ${index + 1} per pane MiB: ${round.bytes.map(value => (value / 1024 / 1024).toFixed(2)).join(' ')}`)
  for (const value of results) expect(Math.abs(value - expected) / expected, `received ${value} bytes, expected ${expected} ±10%`).toBeLessThanOrEqual(0.1)
})
