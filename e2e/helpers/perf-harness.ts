/**
 * Reusable harness for OXESpace runtime fluidity benchmarks (`e2e/perf-benchmark.spec.ts`).
 *
 * Holds budget definitions, metric aggregation/reporting, Electron launch & teardown,
 * workspace/panel/mode timing helpers, 5k-event thread fixtures/probes, and main-process
 * memory sampling helpers.
 */
import { expect, type ElectronApplication, type Locator, type Page } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { performance } from 'node:perf_hooks'
import { armInputTimer, armInputTimerUntil, readInputTimer, WORKSPACE_LAUNCH_DONE_CHECKS } from './input-timer'
import { launchForPerf } from './perf-launch'

export const REPEATS = 6
export const ENFORCE_BUDGETS = process.env.OXESPACE_PERF_GATE === '1'
/** On CI a frame budget missed once is measured again before it fails (OXESPACE_PERF_CONFIRM=0 turns it off). */
export const CONFIRM_ON_CI = process.env.CI === 'true' && process.env.OXESPACE_PERF_CONFIRM !== '0'

export const PERF_BUDGETS_MS: Record<string, number> = {
  'boot: launch→firstWindow': 5_000,
  'boot: firstWindow→interactive': 2_000,
  'workspace: create→grid (w/ input)': 3_000,
  'workspace: launch→grid (in-window)': 1_500,
  'shell: create split pane': 1_500,
  // Warm command menu open uses the per-rootPath fileList cache (OXE-41), aligned to the 100 ms perceptible budget.
  'shell: command menu open': 100,
  'terminal: split→PTY running': 2_000,
  // Modal surfaces perform a full settings-tree mount. Their CI p95 baseline
  // is ~570 ms on Linux runners; keep this explicit instead of weakening the
  // 500 ms budget for all other interactions.
  'modal open:  Usage & limits': 750,
  'modal close: Usage & limits': 750,
  // Track 7 (V12) targets. Calibrated on Windows from the built app in mock-native mode; the CI gate
  // compares the warm p95 with the worst sample removed (report()).
  // Process start to the first painted screen, from the app's own marks: warm 0.97-1.05 s, so 1.5 s
  // leaves about 45% for slower runners while still catching a second of new startup work.
  'boot: process→ready-to-show': 1_500,
  'boot: process→interactive': 1_500,
  // Already-mounted modes: warm p95 23-27 ms. 100 ms is the threshold of a perceptible delay; a
  // regression that remounts a mode (hundreds of ms) fails it.
  'mode switch: Code→Thread': 100,
  'mode switch: Thread→OxeQuery': 100,
  'mode switch: OxeQuery→Code': 100,
  // 5,000-event Thread, 600 px per frame: p95 15 ms, max 15-23 ms. 50 ms is three dropped frames at 60 Hz.
  'thread 5k: scroll frame': 50,
  // Composer key to painted frame with 5,000 events above it: mean 12 ms, p95 22 ms. Typing that lags
  // 50 ms is noticeable, so this is both the target and about 2x headroom.
  'thread 5k: keystroke→paint': 50,
  // One streamed event (delta read) to painted: 142-150 ms, of which 100 ms is App.tsx's deliberate
  // thread:changed coalescing window. 250 ms gives the remaining ~45 ms of read, render and two frames
  // more than 3x headroom.
  'thread 5k: streaming append': 250
}

export const DEFAULT_INTERACTION_BUDGET_MS = 500
export const MAX_WORKING_SET_MB = 750
export const MAX_RENDERER_HEAP_MB = 100
export const THREAD_COUNT = 10

export interface MainMemoryBudget {
  rss: number
  heap: number
  growth: number
}

/**
 * Per platform. RSS and heap are totals, baseline x 1.25 rounded up. `growth` is the resident set gained while opening
 * the Threads, outside V8's young generation: baseline x 1.25 is 8 on Linux and 7 on Windows, held one above until
 * more runs say how much the split itself moves. It was 13 for the whole resident set.
 */
export const MAIN_MEMORY_BUDGETS_MB: Record<string, MainMemoryBudget> = {
  // Windows, 4 runs: rss 162-168 MB, heap 17.0-17.2 MB (after GC). Growth outside the young generation: 5.2 MB.
  win32: { rss: 211, heap: 22, growth: 8 },
  // Linux CI runner (ubuntu-24.04), first run: rss 214.8 MB, heap 16.4 MB. Growth outside the young generation: 5.8 MB.
  linux: { rss: 270, heap: 22, growth: 9 },
  default: { rss: 211, heap: 22, growth: 8 }
}

export interface PerfStats {
  min: number
  mean: number
  p95: number
  max: number
}

export interface LaunchAppOptions {
  mockNative?: boolean
}

export interface PerfAppHandle {
  app: ElectronApplication
  page: Page
  pid?: number
}

export interface WorkspaceCreateTiming {
  totalMs: number
  inWindowMs: number
}

export type AppMode = 'code' | 'thread' | 'data'

export interface MainMemorySample {
  rss: number
  heap: number
  gc: boolean
  anon: number | null
  file: number | null
  detail: string
  young: number
}

export interface SettledMainMemorySample extends MainMemorySample {
  waits: number
}

export function ensureOutJunction(): void {
  const link = join(process.cwd(), 'e2e', 'out')
  if (existsSync(link)) return
  try { symlinkSync(join(process.cwd(), 'out'), link, 'junction') } catch { /* exists/race */ }
}

export function stats(xs: number[]): PerfStats {
  const s = [...xs].sort((a, b) => a - b)
  const mean = xs.reduce((a, b) => a + b, 0) / xs.length
  return { min: s[0], mean, p95: s[Math.min(s.length - 1, Math.floor(s.length * 0.95))], max: s[s.length - 1] }
}

export function report(op: string, xs: number[]): void {
  const f = (n: number): string => n.toFixed(1)
  if (!xs.length) { console.log(`[RESULT] ${op.padEnd(40)} — no samples`); return }
  const s = stats(xs)
  const warm = xs.length > 1 ? stats(xs.slice(1)) : null
  const flag = s.mean > 100 ? '🔴' : s.mean > 16.7 ? '🟡' : '🟢'
  // median= and first= (the first sample of the launch, a surface's first open) are read by the release gate
  // (.github/workflows/perf-gate.yml, perf-gate/summarize.mjs).
  const sorted = [...xs].sort((a, b) => a - b)
  const median = sorted.length % 2
    ? sorted[(sorted.length - 1) / 2]
    : (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2
  console.log(
    `[RESULT] ${op.padEnd(40)} n=${xs.length} min=${f(s.min)} mean=${f(s.mean)} p95=${f(s.p95)} max=${f(s.max)} ms` +
    `${warm ? ` · warm mean=${f(warm.mean)} p95=${f(warm.p95)}` : ''} median=${f(median)} first=${f(xs[0])} ${flag}`
  )
  if (ENFORCE_BUDGETS) {
    // Shared runners occasionally pause a renderer for several seconds while
    // another container/job is scheduled. Keep that spike in the report, but
    // gate on warm samples with the single worst scheduler outlier removed.
    // Functional hangs still fail Playwright's explicit waits/timeouts.
    const warmSamples = xs.length > 1 ? xs.slice(1) : xs
    const gateSamples = warmSamples.length >= 3
      ? [...warmSamples].sort((a, b) => a - b).slice(0, -1)
      : warmSamples
    const observed = stats(gateSamples).p95
    const budget = PERF_BUDGETS_MS[op] ?? DEFAULT_INTERACTION_BUDGET_MS
    expect(observed, `${op} p95 ${f(observed)}ms exceeded ${budget}ms`).toBeLessThanOrEqual(budget)
  }
}

export async function launchApp(options: LaunchAppOptions = {}): Promise<PerfAppHandle> {
  ensureOutJunction()
  const root = join(tmpdir(), `oxe-perf-${Date.now()}-${Math.random().toString(36).slice(2)}`)
  const mockNative = options.mockNative ?? true
  const app = await launchForPerf({
    ...process.env,
    OXESPACE_DISABLE_SINGLE_INSTANCE: '1',
    OXESPACE_E2E_MOCK_NATIVE: mockNative ? '1' : '0',
    OXESPACE_DB_PATH: join(root, 'db.sqlite3')
  })
  const pid = app.process().pid
  const page = await app.firstWindow()
  return { app, page, pid }
}

async function waitForProcessExit(pid: number, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      process.kill(pid, 0)
    } catch {
      return true
    }
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  return false
}

export async function killApp(app: ElectronApplication, pid?: number): Promise<void> {
  await Promise.race([
    app.close().catch(() => undefined),
    new Promise((resolve) => setTimeout(resolve, 3000))
  ])
  if (!pid) return

  // Playwright's close promise can resolve while a Chromium child keeps the
  // process tree alive (observed after 15 repeated Electron launches). Check
  // the exact PID from this test before force-stopping its tree; never target a
  // process name, which could terminate a developer's unrelated Electron app.
  const exited = await waitForProcessExit(pid, 1_000)
  if (exited) return
  try {
    if (process.platform === 'win32') {
      execFileSync('taskkill.exe', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' })
    } else {
      process.kill(pid, 'SIGKILL')
    }
  } catch {
    // Already exited between the liveness check and the signal.
  }
  await waitForProcessExit(pid, 2_000)
}

export async function createWorkspace(page: Page, requestedRoot?: string): Promise<WorkspaceCreateTiming> {
  const tStart = performance.now()
  const root = requestedRoot ?? join(tmpdir(), `oxe-ws-${Date.now()}`, 'repo')
  mkdirSync(root, { recursive: true })
  await page.getByTestId('btn-new-workspace').click()
  await page.getByTestId('wizard-dir-input').fill(root)
  await page.getByTestId('wizard-layout-card-1').click()
  await armInputTimerUntil(page, WORKSPACE_LAUNCH_DONE_CHECKS)
  await page.getByTestId('wizard-launch-btn').click()
  await page.waitForSelector('[data-testid="workspace-grid"], [data-testid="workspace-split-grid"]', {
    state: 'visible'
  })
  // The terminal starts and takes focus a moment later; measurements begin after that settles.
  await page.locator('[data-testid="terminal-pane"]').first().waitFor({ state: 'visible' })
  const inWindowMs = await readInputTimer(page)
  return { totalMs: performance.now() - tStart, inWindowMs }
}

export async function timeDomToggle(
  page: Page,
  action: () => Promise<void>,
  selector: string,
  wantPresent: boolean
): Promise<number> {
  await armInputTimer(page, selector, wantPresent)
  await action()
  return await readInputTimer(page)
}

export async function timePanelToggle(
  page: Page,
  label: string,
  panelTestId: string,
  wantVisible: boolean,
  closeButtonName?: string
): Promise<number> {
  if (!wantVisible && closeButtonName) {
    return timeDomToggle(
      page,
      () => page.getByTestId(panelTestId).getByRole('button', { name: closeButtonName, exact: true }).click(),
      `[data-testid="${panelTestId}"]`,
      false
    )
  }

  const menu = page.getByRole('menu', { name: 'Panels' })
  const item = menu.getByRole('menuitemcheckbox', { name: label, exact: true })
  // Opening the menu is setup, not the measured interaction. Right after a workspace opens the rail can
  // still move while terminals mount, and the menu follows it; reopen it once if it went away.
  for (let attempt = 0; ; attempt++) {
    if (!await menu.isVisible().catch(() => false)) {
      await page.locator('[data-testid="btn-open-tools"]:visible').click()
      await menu.waitFor({ state: 'visible' })
    }
    await item.waitFor({ state: 'visible' })
    await armInputTimer(page, `[data-testid="${panelTestId}"]`, wantVisible)
    try { await item.click({ timeout: 5_000 }); break } catch (error) { if (attempt === 1) throw error }
  }
  return await readInputTimer(page)
}

export async function pressShellShortcut(page: Page, shortcut: string): Promise<void> {
  // Focus has to be on the shell, not in a terminal, for a shell shortcut. The mode switch is on screen in every
  // state; the Panels button this used is not in the collapsed sidebar of 1.5, so the expand step never got its key.
  await page.getByRole('tablist', { name: 'Application view' }).getByRole('tab').first().focus()
  await page.keyboard.press(shortcut)
}

/** Click→painted inside the renderer: a synchronous click, then two frames so layout and paint are included. */
export async function timeModeSwitch(page: Page, mode: AppMode): Promise<number> {
  return page.evaluate(async (name) => {
    const button = document.querySelector<HTMLButtonElement>(`button[data-app-mode="${name}"]`)!
    const started = performance.now()
    button.click()
    await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
    if (button.getAttribute('aria-selected') !== 'true') throw new Error(`${name} did not become the active view`)
    return performance.now() - started
  }, mode)
}

/** Turns of user message, tool, answer and completion: the event shapes of e2e/thread-view.spec.ts. */
export function longThread(turns: number): unknown[] {
  return Array.from({ length: turns }, (_, turn) => [
    { type: 'message', id: `u-${turn}`, role: 'user', text: `Review message ${turn}` },
    { type: 'tool', id: `t-${turn}`, name: 'commandExecution', state: 'completed', detail: 'npm test', output: 'ok', exitCode: 0 },
    { type: 'message', id: `a-${turn}`, role: 'assistant', text: 'A detailed response to verify the conversation history. '.repeat(5) },
    { type: 'completed', status: 'completed' }
  ]).flat()
}

/**
 * Installs an in-memory delta-read thread IPC handler matching the production readWindow/readSince path
 * so streamed events arrive as deltas while earlier events preserve identity.
 */
export async function installLongThreadReadPath(
  app: ElectronApplication,
  events: unknown[],
  rootPath: string
): Promise<void> {
  await app.evaluate(({ ipcMain, BrowserWindow }, { events: rawEvents, rootPath: repoPath }) => {
    const g = globalThis as Record<string, unknown>
    const list = rawEvents as Array<Record<string, unknown>>
    const revisions = list.map(() => 1)
    let revision = 1
    const thread = {
      id: 'e2e-thread',
      workspaceId: g.e2eWorkspaceId,
      projectId: 'e2e-project',
      rootPath: repoPath,
      provider: 'claude',
      nativeSessionId: null,
      title: 'Long history',
      pinned: false,
      status: 'idle',
      createdAt: Date.now(),
      updatedAt: Date.now()
    }
    const changed = (): void => {
      for (const window of BrowserWindow.getAllWindows()) window.webContents.send('thread:changed', { threadId: 'e2e-thread' })
    }
    for (const channel of ['list', 'read', 'read-since', 'send']) ipcMain.removeHandler(`thread:${channel}`)
    ipcMain.handle('thread:list', () => [thread])
    const counts = { reads: 0, deltas: 0 }
    g.perfReadCounts = counts
    ipcMain.handle('thread:read', () => {
      counts.reads++
      return {
        thread,
        events: list,
        turns: [],
        pendingRequests: [],
        sync: { epoch: 'perf', revision },
        page: { hasMore: false, total: list.length, live: list.length }
      }
    })
    ipcMain.handle('thread:read-since', (_event, _id, cursor: { revision: number }) => {
      counts.deltas++
      return {
        ok: true,
        epoch: 'perf',
        revision,
        live: list.length,
        thread,
        turns: [],
        deliveries: {},
        pendingRequests: [],
        events: list.flatMap((event, seq) => revisions[seq] > cursor.revision ? [{ seq, event }] : [])
      }
    })
    ipcMain.handle('thread:send', (_event, _id, text: string) => {
      list.push({ type: 'message', id: `stream-${list.length}`, role: 'assistant', text })
      revisions.push(++revision)
      thread.status = 'running'
      changed()
    })
    changed()
  }, { events, rootPath })
}

export async function instrumentKeystrokeLatency(composer: Locator): Promise<void> {
  await composer.evaluate((field) => {
    const samples: number[] = []
    const starts: number[] = []
    const longTasks: Array<{ at: number; ms: number; source: string }> = []
    const box = window as unknown as {
      __keySamples: number[]
      __keyStarts: number[]
      __keyLongTasks: typeof longTasks
      __keyFrom: number
    }
    box.__keySamples = samples
    box.__keyStarts = starts
    box.__keyLongTasks = longTasks
    box.__keyFrom = performance.now()
    // FL-24 diagnostic (#687): what the main thread was doing when a key took ~400 ms to paint.
    try {
      new PerformanceObserver(list => {
        for (const entry of list.getEntries()) {
          const attribution = (entry as PerformanceEntry & {
            attribution?: Array<{ containerSrc?: string; containerName?: string; containerType?: string }>
          }).attribution?.[0]
          longTasks.push({
            at: Math.round(entry.startTime),
            ms: Math.round(entry.duration),
            source: attribution?.containerSrc || attribution?.containerName || attribution?.containerType || entry.name
          })
        }
      }).observe({ type: 'longtask', buffered: false })
    } catch { /* no longtask entries in this build: the line shows none */ }
    field.addEventListener('keydown', () => {
      const started = performance.now()
      starts.push(Math.round(started))
      requestAnimationFrame(() => requestAnimationFrame(() => samples.push(performance.now() - started)))
    })
  })
}

export async function readKeystrokeDiagnostics(page: Page, keyBudget: number): Promise<string> {
  return page.evaluate((budget) => {
    const box = window as unknown as {
      __keySamples: number[]
      __keyStarts: number[]
      __keyLongTasks: Array<{ at: number; ms: number; source: string }>
      __keyFrom: number
    }
    const to = performance.now()
    const slow = box.__keySamples.flatMap((ms, index) => ms > budget ? [`${box.__keyStarts[index]}+${Math.round(ms)}`] : [])
    const marks = performance.getEntriesByType('mark')
      .filter(mark => mark.startTime >= box.__keyFrom - 2000 && mark.startTime <= to)
      .map(mark => `${mark.name}@${Math.round(mark.startTime)}`)
    const memory = (window.performance as Performance & { memory?: { usedJSHeapSize: number; totalJSHeapSize: number } }).memory
    return [
      `window=${Math.round(box.__keyFrom)}..${Math.round(to)}`,
      `slow=[${slow.join(' ')}]`,
      `longtasks=[${box.__keyLongTasks.map(task => `${task.at}+${task.ms}:${task.source}`).join(' ')}]`,
      `marks=[${marks.join(' ')}]`,
      memory ? `heap=${Math.round(memory.usedJSHeapSize / 1e6)}/${Math.round(memory.totalJSHeapSize / 1e6)}MB` : 'heap=n/a'
    ].join(' ')
  }, keyBudget)
}

/**
 * Scrolls the thread timeline from end to start at 600 px per frame, recording every frame interval.
 * Each step mounts new rows, the virtualizer's worst steady case.
 */
export async function measureThreadScrollFrames(page: Page): Promise<number[]> {
  return page.evaluate(async () => {
    const timeline = document.querySelector<HTMLElement>('.thread-timeline')!
    timeline.scrollTop = timeline.scrollHeight
    await new Promise(resolve => setTimeout(resolve, 300))
    const intervals: number[] = []
    let last = performance.now()
    for (let step = 0; step < 150 && timeline.scrollTop > 0; step++) {
      timeline.scrollTop -= 600
      await new Promise<void>(resolve => requestAnimationFrame(() => resolve()))
      const now = performance.now()
      intervals.push(now - last)
      last = now
    }
    return intervals
  })
}

/**
 * The main process after a forced GC (when available): resident set and live JS heap, in MB. On Linux the
 * resident set is also split into what the process allocated (anon) and what it maps from files (code, database).
 * `detail` says where the memory is: what V8 holds resident per heap space (a young generation that grew during
 * a burst of work stays resident with nothing live in it), what it allocated outside the heap, and Buffers.
 * `young` is what V8's young generation holds resident (its semi-spaces and its large objects), in MB.
 */
export async function sampleMainProcessMemory(app: ElectronApplication): Promise<MainMemorySample> {
  return app.evaluate(() => {
    let gc = false
    try {
      // evaluate() has no require; the builtin loader is on process.
      process.getBuiltinModule('node:v8').setFlagsFromString('--expose_gc')
      const collect = process.getBuiltinModule('node:vm').runInNewContext('gc') as () => void
      collect(); collect(); gc = true
    } catch { /* the heap is then read as is */ }
    const usage = process.memoryUsage()
    let anon: number | null = null
    let file: number | null = null
    try {
      const status = process.getBuiltinModule('node:fs').readFileSync('/proc/self/status', 'utf8')
      // Lines read "RssAnon:     123456 kB".
      const kb = (name: string): number | null => {
        const line = status.split('\n').find(value => value.startsWith(`${name}:`))
        return line ? Number.parseInt(line.slice(name.length + 1), 10) / 1024 : null
      }
      anon = kb('RssAnon')
      file = kb('RssFile')
    } catch { /* no /proc: Windows, macOS */ }
    const mb = (bytes: number): string => (bytes / 1024 / 1024).toFixed(1)
    const v8 = process.getBuiltinModule('node:v8')
    const heap = v8.getHeapStatistics()
    const all = v8.getHeapSpaceStatistics()
    const spaces = all.filter(space => space.physical_space_size > 512 * 1024)
      .map(space => `${space.space_name.replace(/_space$/, '')}=${mb(space.physical_space_size)}`).join(' ')
    const young = all.filter(space => space.space_name === 'new_space' || space.space_name === 'new_large_object_space')
      .reduce((sum, space) => sum + space.physical_space_size, 0) / 1024 / 1024
    const detail = `v8 resident=${mb(heap.total_physical_size)} (${spaces}) malloced=${mb(heap.malloced_memory)} external=${mb(usage.external)} buffers=${mb(usage.arrayBuffers)}`
    return { rss: usage.rss / 1024 / 1024, heap: usage.heapUsed / 1024 / 1024, gc, anon, file, detail, young }
  })
}

/**
 * The app's deferred start (index.ts "deferred-init": the internal MCP server, config sync, policy) is still
 * allocating when the window shows. A fixed wait left part of it inside the measured growth, which is meant to be
 * what opening the Threads costs. A sample is taken once the resident set stopped moving.
 */
export async function waitForSettledMainMemory(
  app: ElectronApplication,
  page: Page
): Promise<SettledMainMemorySample> {
  let last = await sampleMainProcessMemory(app)
  for (let waits = 1; waits <= 16; waits++) {
    await page.waitForTimeout(750)
    const next = await sampleMainProcessMemory(app)
    if (Math.abs(next.rss - last.rss) < 0.25) return { ...next, waits }
    last = next
  }
  return { ...last, waits: 17 }
}

export function formatLinuxRssSplit(value: MainMemorySample): string {
  return value.anon === null || value.file === null
    ? ''
    : ` anon=${value.anon.toFixed(1)}MB file=${value.file.toFixed(1)}MB`
}
