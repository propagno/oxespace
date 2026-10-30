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
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { mkdirSync, symlinkSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { performance } from 'node:perf_hooks'
import { findPaletteCommand, openConnections } from './helpers/panels'
import { installThreadFixtures, openThreadWithState, registerThreadProject } from './helpers/thread-fixtures'

const REPEATS = 6
const ENFORCE_BUDGETS = process.env.OXESPACE_PERF_GATE === '1'

const PERF_BUDGETS_MS: Record<string, number> = {
  'boot: launch→firstWindow': 5_000,
  'boot: firstWindow→interactive': 2_000,
  'workspace: create→grid (w/ input)': 3_000,
  'shell: create split pane': 1_500,
  'terminal: split→PTY running': 2_000,
  // Modal surfaces perform a full settings-tree mount. Their CI p95 baseline
  // is ~570 ms on Linux runners; keep this explicit instead of weakening the
  // 500 ms budget for all other interactions.
  'modal open:  Semantic Activity': 750,
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
const DEFAULT_INTERACTION_BUDGET_MS = 500
const MAX_WORKING_SET_MB = 750
const MAX_RENDERER_HEAP_MB = 100

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
  const warm = xs.length > 1 ? stats(xs.slice(1)) : null
  const flag = s.mean > 100 ? '🔴' : s.mean > 16.7 ? '🟡' : '🟢'
  console.log(
    `[RESULT] ${op.padEnd(40)} n=${xs.length} min=${f(s.min)} mean=${f(s.mean)} p95=${f(s.p95)} max=${f(s.max)} ms` +
    `${warm ? ` · warm mean=${f(warm.mean)} p95=${f(warm.p95)}` : ''} ${flag}`
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

async function launchApp(options: { mockNative?: boolean } = {}): Promise<{ app: ElectronApplication; page: Page; pid?: number }> {
  ensureOutJunction()
  const root = join(tmpdir(), `oxe-perf-${Date.now()}-${Math.random().toString(36).slice(2)}`)
  const mockNative = options.mockNative ?? true
  const app = await electron.launch({
    args: [join(process.cwd(), 'e2e', 'electron-main.cjs')],
    env: {
      ...process.env,
      OXESPACE_DISABLE_SINGLE_INSTANCE: '1',
      OXESPACE_E2E_MOCK_NATIVE: mockNative ? '1' : '0',
      OXESPACE_DB_PATH: join(root, 'db.sqlite3')
    }
  })
  const pid = app.process().pid
  const page = await app.firstWindow()
  return { app, page, pid }
}
async function killApp(app: ElectronApplication, pid?: number): Promise<void> {
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
async function createWorkspace(page: Page, requestedRoot?: string): Promise<void> {
  const root = requestedRoot ?? join(tmpdir(), `oxe-ws-${Date.now()}`, 'repo')
  mkdirSync(root, { recursive: true })
  await page.getByTestId('btn-new-workspace').click()
  await page.getByTestId('wizard-dir-input').fill(root)
  await page.getByTestId('wizard-layout-card-1').click()
  await page.getByTestId('wizard-launch-btn').click()
  await page.waitForSelector('[data-testid="workspace-grid"], [data-testid="workspace-split-grid"]', {
    state: 'visible'
  })
  // The terminal starts and takes focus a moment later; measurements begin after that settles.
  await page.locator('[data-testid="terminal-pane"]').first().waitFor({ state: 'visible' })
}
async function timePanelToggle(
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
  let t0: number
  for (let attempt = 0; ; attempt++) {
    if (!await menu.isVisible().catch(() => false)) {
      await page.locator('[data-testid="btn-open-tools"]:visible').click()
      await menu.waitFor({ state: 'visible' })
    }
    await item.waitFor({ state: 'visible' })
    t0 = await page.evaluate(() => performance.now())
    try { await item.click({ timeout: 5_000 }); break } catch (error) { if (attempt === 1) throw error }
  }
  await page.waitForFunction(
    ({ panelTestId, wantVisible }) => {
      const panel = document.querySelector(`[data-testid="${panelTestId}"]`) as HTMLElement | null
      // Resizable panels may be rendered beneath layout wrappers without an
      // offset parent. Their DOM lifecycle is the reliable completion signal.
      return wantVisible ? panel !== null : panel === null
    },
    { panelTestId, wantVisible }
  )
  return await page.evaluate((start) => performance.now() - start, t0)
}

async function timeDomToggle(
  page: Page,
  action: () => Promise<void>,
  selector: string,
  wantPresent: boolean
): Promise<number> {
  const t0 = await page.evaluate(() => performance.now())
  await action()
  await page.waitForFunction(
    ({ selector, wantPresent }) => (document.querySelector(selector) !== null) === wantPresent,
    { selector, wantPresent }
  )
  return await page.evaluate((start) => performance.now() - start, t0)
}

async function pressShellShortcut(page: Page, shortcut: string): Promise<void> {
  await page.locator('[data-testid="btn-open-tools"]:visible').focus()
  await page.keyboard.press(shortcut)
}

test('boot + workspace create', async () => {
  test.setTimeout(60_000)
  const tLaunch = performance.now()
  const { app, page, pid } = await launchApp()
  try {
    const tFirst = performance.now()
    await page.getByTestId('btn-new-workspace').waitFor({ state: 'visible' })
    const tInteractive = performance.now()
    report('boot: launch→firstWindow', [tFirst - tLaunch])
    report('boot: firstWindow→interactive', [tInteractive - tFirst])
    const tC = performance.now()
    await createWorkspace(page)
    report('workspace: create→grid (w/ input)', [performance.now() - tC])
    const processMetrics = await app.evaluate(({ app }) => app.getAppMetrics())
    const workingSetMb = processMetrics.reduce((total, metric) => total + metric.memory.workingSetSize, 0) / 1024
    const peakWorkingSetMb = processMetrics.reduce((total, metric) => total + metric.memory.peakWorkingSetSize, 0) / 1024
    const rendererHeapMb = await page.evaluate(() => {
      const memory = (performance as Performance & { memory?: { usedJSHeapSize?: number } }).memory
      return (memory?.usedJSHeapSize ?? 0) / 1024 / 1024
    })
    console.log(
      `[RESULT] memory after workspace                    processes=${processMetrics.length} ` +
      `workingSet=${workingSetMb.toFixed(1)}MB peak=${peakWorkingSetMb.toFixed(1)}MB rendererHeap=${rendererHeapMb.toFixed(1)}MB`
    )
    if (ENFORCE_BUDGETS) {
      expect(workingSetMb, 'Electron working set after workspace').toBeLessThanOrEqual(MAX_WORKING_SET_MB)
      expect(rendererHeapMb, 'renderer JS heap after workspace').toBeLessThanOrEqual(MAX_RENDERER_HEAP_MB)
    }
  } finally {
    await killApp(app, pid)
  }
})

test('shell: sidebar, command menu, tools and split renderer', async () => {
  test.setTimeout(90_000)
  const { app, page, pid } = await launchApp({ mockNative: false })
  try {
    await createWorkspace(page)
    await page.locator('.sidebar-section-header').last().click()
    if (await page.locator('.sidebar.sidebar-collapsed').count()) {
      await pressShellShortcut(page, 'Control+b')
      await page.locator('.sidebar.sidebar-collapsed').waitFor({ state: 'detached' })
    }
    if (await page.getByTestId('workspace-grid').count()) {
      await pressShellShortcut(page, 'F2')
      await page.getByTestId('workspace-split-grid').waitFor({ state: 'attached' })
    }

    const collapse: number[] = []
    const expand: number[] = []
    const commandOpen: number[] = []
    const commandClose: number[] = []
    const toolsOpen: number[] = []
    const toolsClose: number[] = []
    const legacyGrid: number[] = []
    const splitTree: number[] = []

    for (let i = 0; i < REPEATS; i++) {
      collapse.push(await timeDomToggle(page, () => pressShellShortcut(page, 'Control+b'), '.sidebar.sidebar-collapsed', true))
      expand.push(await timeDomToggle(page, () => pressShellShortcut(page, 'Control+b'), '.sidebar.sidebar-collapsed', false))

      commandOpen.push(await timeDomToggle(page, () => pressShellShortcut(page, 'Control+k'), 'input[placeholder="Search files and commands…"]', true))
      commandClose.push(await timeDomToggle(page, () => page.keyboard.press('Escape'), 'input[placeholder="Search files and commands…"]', false))

      toolsOpen.push(await timeDomToggle(page, () => page.getByTestId('btn-open-tools').click(), '[role="menu"]', true))
      toolsClose.push(await timeDomToggle(page, () => page.keyboard.press('Escape'), '[role="menu"]', false))

      legacyGrid.push(await timeDomToggle(page, () => pressShellShortcut(page, 'F2'), '[data-testid="workspace-grid"]', true))
      splitTree.push(await timeDomToggle(page, () => pressShellShortcut(page, 'F2'), '[data-testid="workspace-split-grid"]', true))
    }

    report('shell: sidebar collapse', collapse)
    report('shell: sidebar expand', expand)
    report('shell: command menu open', commandOpen)
    report('shell: command menu close', commandClose)
    report('shell: tools open', toolsOpen)
    report('shell: tools close', toolsClose)
    report('shell: split-tree→legacy grid', legacyGrid)
    report('shell: legacy grid→split-tree', splitTree)

    const paneCount = await page.getByTestId('pane-container').count()
    const runningCount = await page.getByTestId('terminal-status-label').filter({ hasText: 'running' }).count()
    await page.getByTestId('pane-container').first().click()
    await pressShellShortcut(page, 'Control+k')
    const commandInput = page.locator('input[placeholder="Search files and commands…"]')
    await commandInput.fill('Split pane right')
    const splitCommand = page.getByText('Split pane right', { exact: true })
    await splitCommand.waitFor({ state: 'visible' })
    const splitStarted = await page.evaluate(() => performance.now())
    await splitCommand.click()
    const splitCreated = await page.waitForFunction(
      (count) => document.querySelectorAll('[data-testid="pane-container"]').length > count,
      paneCount,
      { timeout: 5_000 }
    ).then(() => true).catch(() => false)
    if (!splitCreated) {
      const notices = await page.locator('.error-banner').allTextContents()
      throw new Error(`Split pane did not complete: ${notices.join(' | ') || 'no application error reported'}`)
    }
    const splitCreate = await page.evaluate((start) => performance.now() - start, splitStarted)
    report('shell: create split pane', [splitCreate])
    await page.waitForFunction(
      (count) => [...document.querySelectorAll('[data-testid="terminal-status-label"]')]
        .filter((node) => node.textContent?.trim() === 'running').length > count,
      runningCount
    )
    const splitRunning = await page.evaluate((start) => performance.now() - start, splitStarted)
    report('terminal: split→PTY running', [splitRunning])
  } finally {
    await killApp(app, pid)
  }
})

test('workspace transition: mounted native terminals', async () => {
  test.setTimeout(120_000)
  const { app, page, pid } = await launchApp({ mockNative: false })
  try {
    const fixtureRoot = join(tmpdir(), `oxe-switch-${Date.now()}`)
    const alphaRoot = join(fixtureRoot, 'alpha-repo')
    const betaRoot = join(fixtureRoot, 'beta-repo')
    await createWorkspace(page, alphaRoot)
    await page.locator('.workspace-host:not(.workspace-host-hidden)').getByTestId('terminal-status-label').filter({ hasText: 'running' }).first().waitFor()
    await createWorkspace(page, betaRoot)
    await page.locator('.workspace-host:not(.workspace-host-hidden)').getByTestId('terminal-status-label').filter({ hasText: 'running' }).first().waitFor()

    const switchTimes: number[] = []
    for (let i = 0; i < REPEATS; i++) {
      const label = i % 2 === 0 ? 'alpha-repo' : 'beta-repo'
      const target = page.getByTestId('sidebar-workspace-item').filter({ hasText: label })
      const started = await page.evaluate(() => performance.now())
      await target.getByTestId('sidebar-workspace-select').click()
      await page.waitForFunction(
        (name) => document.querySelector('.ws-group.active')?.textContent?.includes(name),
        label
      )
      await page.evaluate(() => new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
      }))
      switchTimes.push(await page.evaluate((start) => performance.now() - start, started))
    }
    report('workspace: native A↔B transition', switchTimes)
  } finally {
    await killApp(app, pid)
  }
})

/**
 * The case that was multi-second: returning to a workspace that fell out of the
 * mounted MRU. Eviction used to kill the workspace's PTYs, so coming back meant
 * spawning PowerShell and loading the user's $PROFILE again. Shells now outlive
 * their view, so this should cost a replay, not a respawn.
 *
 * Shell startup time is platform-dependent (Bash can respawn much faster than
 * PowerShell), so identity is verified from retained PTY output instead of
 * inferred from latency alone.
 */
test('workspace transition: returning to an evicted workspace', async () => {
  test.setTimeout(180_000)
  const { app, page, pid } = await launchApp({ mockNative: false })
  try {
    // Force eviction: a cap of 2 with four workspaces guarantees the first is
    // unmounted by the time we come back to it.
    await page.getByTestId('btn-new-workspace').waitFor({ state: 'visible' })
    await page.evaluate(() => {
      const raw = localStorage.getItem('oxe-settings')
      const parsed = raw ? JSON.parse(raw) : { state: {}, version: 0 }
      parsed.state = { ...parsed.state, visitedWorkspacesCap: 2 }
      localStorage.setItem('oxe-settings', JSON.stringify(parsed))
    })
    await page.reload()
    await page.getByTestId('btn-new-workspace').waitFor({ state: 'visible' })

    const fixtureRoot = join(tmpdir(), `oxe-evict-${Date.now()}`)
    const names = ['alpha-repo', 'beta-repo', 'gamma-repo', 'delta-repo']
    const identityMarker = `OXE_PTY_IDENTITY_${Date.now()}`
    let alphaPaneId = ''
    for (const name of names) {
      await createWorkspace(page, join(fixtureRoot, name))
      await page.locator('.workspace-host:not(.workspace-host-hidden)')
        .getByTestId('terminal-status-label').filter({ hasText: 'running' }).first().waitFor()
      if (name === 'alpha-repo') {
        alphaPaneId = await page.locator('.workspace-host:not(.workspace-host-hidden)')
          .getByTestId('terminal-pane').first().getAttribute('data-pane-id') ?? ''
        expect(alphaPaneId, 'active terminal exposes its pane identity').toBeTruthy()
        await page.evaluate(
          ({ paneId, marker }) => window.oxe.terminal.write({ paneId, data: `echo ${marker}\r` }),
          { paneId: alphaPaneId, marker: identityMarker }
        )
        await expect.poll(
          async () => {
            const found = await page.evaluate(
              ({ paneId, marker }) => window.oxe.terminal.attach({ paneId }).then((result) => result.replay.includes(marker)),
              { paneId: alphaPaneId, marker: identityMarker }
            )
            // A PTY process can be alive a fraction before its shell is ready
            // to consume input (notably PowerShell on a busy Windows runner).
            // Retry the idempotent marker instead of turning startup variance
            // into a false terminal-persistence regression.
            if (!found) await page.evaluate(
              ({ paneId, marker }) => window.oxe.terminal.write({ paneId, data: `echo ${marker}\r` }),
              { paneId: alphaPaneId, marker: identityMarker }
            )
            return found
          },
          { message: 'identity marker reaches the original PTY buffer', timeout: 15_000, intervals: [250, 500, 1_000] }
        ).toBe(true)
      }
    }

    const returnTimes: number[] = []
    for (let i = 0; i < REPEATS; i++) {
      // Bounce to the far end of the MRU, then back — 'alpha-repo' is evicted.
      const label = i % 2 === 0 ? 'alpha-repo' : 'delta-repo'
      const target = page.getByTestId('sidebar-workspace-item').filter({ hasText: label })
      const started = await page.evaluate(() => performance.now())
      await target.getByTestId('sidebar-workspace-select').click()
      await page.waitForFunction(
        (name) => document.querySelector('.ws-group.active')?.textContent?.includes(name),
        label
      )
      // Wait for a live terminal, not merely a painted shell — a blank-but-fast
      // terminal would be a failed fix.
      await page.locator('.workspace-host:not(.workspace-host-hidden)')
        .getByTestId('terminal-status-label').filter({ hasText: 'running' }).first().waitFor()
      await page.evaluate(() => new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
      }))
      returnTimes.push(await page.evaluate((start) => performance.now() - start, started))
    }
    report('workspace: evicted A↔D transition', returnTimes)
    await expect.poll(
      () => page.evaluate(
        ({ paneId, marker }) => window.oxe.terminal.attach({ paneId }).then((result) => result.replay.includes(marker)),
        { paneId: alphaPaneId, marker: identityMarker }
      ),
      { message: 'returning to an evicted workspace preserves the original PTY buffer' }
    ).toBe(true)
  } finally {
    await killApp(app, pid)
  }
})

test('repository: Files ↔ Source Control', async () => {
  test.setTimeout(90_000)
  const { app, page, pid } = await launchApp()
  try {
    await createWorkspace(page)
    await timePanelToggle(page, 'Files', 'workspace-editor-panel', true)
    const toSourceControl: number[] = []
    const toFiles: number[] = []

    for (let i = 0; i < REPEATS; i++) {
      toSourceControl.push(await timeDomToggle(
        page,
        () => page.getByTestId('workspace-editor-panel').getByRole('button', { name: 'Commit & pull request' }).click(),
        '[data-testid="workspace-github-panel"]',
        true
      ))
      toFiles.push(await timeDomToggle(
        page,
        () => page.getByTestId('workspace-github-panel').getByRole('button', { name: 'Files and editor' }).click(),
        '[data-testid="workspace-editor-panel"]',
        true
      ))
    }

    report('repository: Files→Source Control', toSourceControl)
    report('repository: Source Control→Files', toFiles)
  } finally {
    await killApp(app, pid)
  }
})

test('modal surfaces: agents, MCP, skills, semantic, workspace settings and usage', async () => {
  test.setTimeout(120_000)
  const { app, page, pid } = await launchApp()
  try {
    await createWorkspace(page)
    const modalRepeats = 3
    const surfaces: Array<{
      label: string
      selector: string
      trigger: () => Promise<void>
      /** Untimed setup before the trigger (opening and filtering the palette). */
      prepare?: () => Promise<void>
    }> = []
    let option: import('@playwright/test').Locator | null = null
    const fromPalette = (label: string, selector: string, title: string) => ({ label, selector, prepare: async () => { option = await findPaletteCommand(page, title) }, trigger: () => option!.click() })
    surfaces.push(
      {
        label: 'Agent Settings',
        selector: '.settings-center',
        trigger: () => page.getByRole('button', { name: 'Open settings' }).click()
      },
      {
        label: 'MCP servers',
        selector: '[role="dialog"][aria-label="MCP servers"]',
        trigger: () => openConnections(page)
      },
      fromPalette('Skills', '[role="dialog"][aria-label="Skills"]', 'Skills'),
      fromPalette('Semantic Activity', '[role="dialog"][aria-label="Semantic activity"]', 'Semantic index log'),
      fromPalette('Workspace Settings', '.workspace-settings-modal-v2', 'Workspace settings')
    )

    for (const surface of surfaces) {
      const opens: number[] = []
      const closes: number[] = []
      for (let i = 0; i < modalRepeats; i++) {
        await surface.prepare?.()
        opens.push(await timeDomToggle(page, surface.trigger, surface.selector, true))
        closes.push(await timeDomToggle(
          page,
          () => surface.label === 'Agent Settings' || surface.label === 'Workspace Settings'
            ? page.getByRole('button', { name: 'Back to work', exact: true }).click()
            : page.locator(surface.selector).getByRole('button', { name: /^Close/ }).first().click(),
          surface.selector,
          false
        ))
      }
      report(`modal open:  ${surface.label}`, opens)
      report(`modal close: ${surface.label}`, closes)
    }

    const usageOpen: number[] = []
    const usageClose: number[] = []
    for (let i = 0; i < modalRepeats; i++) {
      const started = await page.evaluate(() => performance.now())
      // Settings restores terminal focus; move to navigation before an app shortcut.
      await page.locator('.sidebar-section-header').last().click()
      await page.keyboard.press('Control+k')
      const input = page.locator('input[placeholder="Search files and commands…"]')
      await input.fill('Usage & limits')
      await page.getByText('Usage & limits', { exact: true }).click()
      await page.locator('[data-testid="usage-modal"]').waitFor({ state: 'visible' })
      usageOpen.push(await page.evaluate((start) => performance.now() - start, started))
      usageClose.push(await timeDomToggle(page, () => page.getByTestId('usage-modal').getByRole('button', { name: 'Close' }).click(), '[data-testid="usage-modal"]', false))
    }
    report('modal open:  Usage & limits', usageOpen)
    report('modal close: Usage & limits', usageClose)
  } finally {
    await killApp(app, pid)
  }
})

// The panels of the Panels menu (multi-repo coordination and background activity have their own buttons).
const PANELS: Array<{ label: string; testId: string; closeButtonName?: string }> = [
  { label: 'Commit & pull request', testId: 'workspace-github-panel' },
  { label: 'Files', testId: 'workspace-editor-panel' },
  { label: 'Changes', testId: 'workspace-review-panel' },
  { label: 'Worktrees', testId: 'workspace-worktree-panel' },
  { label: 'Scripts', testId: 'workspace-scripts-panel' },
  { label: 'Find in files', testId: 'workspace-search-panel' },
  { label: 'Browser', testId: 'workspace-web-preview-panel' }
]

for (const { label, testId, closeButtonName } of PANELS) {
  test(`panel: ${label}`, async () => {
    test.setTimeout(45_000)
    const { app, page, pid } = await launchApp()
    try {
      await createWorkspace(page)
      await page.waitForTimeout(250)
      const openS: number[] = []
      const closeS: number[] = []
      for (let i = 0; i < REPEATS; i++) {
        openS.push(await timePanelToggle(page, label, testId, true))
        await page.waitForTimeout(30)
        closeS.push(await timePanelToggle(page, label, testId, false, closeButtonName))
        await page.waitForTimeout(30)
      }
      if (openS.length) report(`panel open:  ${label}`, openS)
      if (closeS.length) report(`panel close: ${label}`, closeS)
    } finally {
      await killApp(app, pid)
    }
  })
}

/**
 * Time to interactive as the app measures it: process start to the renderer reporting its first painted
 * screen (electron/main/startup-timing.ts, `oxe:interactive`). Unlike launch→firstWindow above, it leaves
 * out Playwright's own launch and attach overhead. The first launch of a job is cold (disk cache, V8 code
 * cache); report() gates on the warm launches only.
 */
test('boot: window interactive', async () => {
  test.setTimeout(90_000)
  const interactive: number[] = []
  const readyToShow: number[] = []
  for (let i = 0; i < 4; i++) {
    const { app, page, pid } = await launchApp()
    try {
      await page.getByTestId('btn-new-workspace').waitFor({ state: 'visible' })
      const readMeasures = (): Promise<Record<string, number>> => app.evaluate(() => Object.fromEntries(
        performance.getEntriesByType('measure').filter(entry => entry.name.startsWith('oxe:')).map(entry => [entry.name, entry.duration])
      ))
      await expect.poll(readMeasures, { message: 'the renderer reports its first painted screen' }).toHaveProperty('oxe:interactive')
      const measures = await readMeasures()
      interactive.push(measures['oxe:interactive'])
      readyToShow.push(measures['oxe:ready-to-show'])
    } finally {
      await killApp(app, pid)
    }
  }
  report('boot: process→ready-to-show', readyToShow)
  report('boot: process→interactive', interactive)
})

/** Click→painted inside the renderer: a synchronous click, then two frames so layout and paint are included. */
async function timeModeSwitch(page: Page, label: 'Code' | 'Thread' | 'OxeQuery'): Promise<number> {
  return page.evaluate(async (name) => {
    const button = document.querySelector<HTMLButtonElement>(`nav[aria-label="Application view"] button[aria-label="${name}"]`)!
    const started = performance.now()
    button.click()
    await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
    if (button.getAttribute('aria-pressed') !== 'true') throw new Error(`${name} did not become the active view`)
    return performance.now() - started
  }, label)
}

/**
 * Code, Thread and OxeQuery stay mounted once visited (App.tsx hides the inactive ones), so after the first
 * visit a switch only restyles the surface and swaps the sidebar. The first visit of each mode loads its
 * lazy chunks and is setup here, not part of the measurement.
 */
test('mode switch: Code ↔ Thread ↔ OxeQuery', async () => {
  test.setTimeout(90_000)
  const { app, page, pid } = await launchApp()
  try {
    await createWorkspace(page)
    const nav = page.getByRole('navigation', { name: 'Application view' })
    await nav.getByRole('button', { name: 'Thread', exact: true }).click()
    await page.locator('.thread-host').waitFor({ state: 'visible' })
    await nav.getByRole('button', { name: 'OxeQuery', exact: true }).click()
    await page.locator('.oq-host').waitFor({ state: 'visible' })
    await nav.getByRole('button', { name: 'Code', exact: true }).click()
    await page.waitForTimeout(250)
    const toThread: number[] = []
    const toData: number[] = []
    const toCode: number[] = []
    for (let i = 0; i < REPEATS; i++) {
      toThread.push(await timeModeSwitch(page, 'Thread'))
      toData.push(await timeModeSwitch(page, 'OxeQuery'))
      toCode.push(await timeModeSwitch(page, 'Code'))
    }
    report('mode switch: Code→Thread', toThread)
    report('mode switch: Thread→OxeQuery', toData)
    report('mode switch: OxeQuery→Code', toCode)
  } finally {
    await killApp(app, pid)
  }
})

/** Turns of user message, tool, answer and completion: the event shapes of e2e/thread-view.spec.ts. */
function longThread(turns: number): unknown[] {
  return Array.from({ length: turns }, (_, turn) => [
    { type: 'message', id: `u-${turn}`, role: 'user', text: `Review message ${turn}` },
    { type: 'tool', id: `t-${turn}`, name: 'commandExecution', state: 'completed', detail: 'npm test', output: 'ok', exitCode: 0 },
    { type: 'message', id: `a-${turn}`, role: 'assistant', text: 'A detailed response to verify the conversation history. '.repeat(5) },
    { type: 'completed', status: 'completed' }
  ]).flat()
}

test('thread: 5,000 events, scroll and streaming append', async () => {
  test.setTimeout(150_000)
  const { app, page, pid } = await launchApp()
  const repo = join(tmpdir(), `oxe-thread-perf-${Date.now()}`, 'repo')
  try {
    mkdirSync(repo, { recursive: true })
    await installThreadFixtures(app, repo)
    await createWorkspace(page, repo)
    await registerThreadProject(app, page, repo)
    await openThreadWithState(app, page, repo, 'empty')
    // The production read path (thread-history.ts readWindow/readSince): the renderer holds the events with a
    // sync cursor and streamed events arrive as deltas, so earlier events keep their identity. `thread:send`
    // appends one event the way a streaming turn does.
    await app.evaluate(({ ipcMain, BrowserWindow }, { events, rootPath }) => {
      const g = globalThis as Record<string, unknown>
      const list = events as Array<Record<string, unknown>>
      const revisions = list.map(() => 1)
      let revision = 1
      const thread = { id: 'e2e-thread', workspaceId: g.e2eWorkspaceId, projectId: 'e2e-project', rootPath, provider: 'claude', nativeSessionId: null,
        title: 'Long history', pinned: false, status: 'idle', createdAt: Date.now(), updatedAt: Date.now() }
      const changed = (): void => { for (const window of BrowserWindow.getAllWindows()) window.webContents.send('thread:changed', { threadId: 'e2e-thread' }) }
      for (const channel of ['list', 'read', 'read-since', 'send']) ipcMain.removeHandler(`thread:${channel}`)
      ipcMain.handle('thread:list', () => [thread])
      const counts = { reads: 0, deltas: 0 }
      g.perfReadCounts = counts
      ipcMain.handle('thread:read', () => {
        counts.reads++
        return { thread, events: list, turns: [], pendingRequests: [], sync: { epoch: 'perf', revision }, page: { hasMore: false, total: list.length, live: list.length } }
      })
      ipcMain.handle('thread:read-since', (_event, _id, cursor: { revision: number }) => {
        counts.deltas++
        return { ok: true, epoch: 'perf', revision, live: list.length, thread, turns: [], deliveries: {}, pendingRequests: [],
          events: list.flatMap((event, seq) => revisions[seq] > cursor.revision ? [{ seq, event }] : []) }
      })
      ipcMain.handle('thread:send', (_event, _id, text: string) => {
        list.push({ type: 'message', id: `stream-${list.length}`, role: 'assistant', text })
        revisions.push(++revision)
        thread.status = 'running'
        changed()
      })
      changed()
    }, { events: longThread(1_250), rootPath: repo })
    const space = page.locator('.thread-virtual-space')
    await expect(space).toHaveAttribute('data-total-rows', /^\d{4,}$/)
    const totalRows = Number(await space.getAttribute('data-total-rows'))
    const mountedRows = Number(await space.getAttribute('data-mounted-rows'))
    console.log(`[RESULT] thread 5k: rows total=${totalRows} mounted=${mountedRows}`)
    expect(mountedRows, 'the timeline stays virtualized').toBeLessThanOrEqual(80)

    // Typing re-renders the conversation view on every key, so per-render work over the events shows here.
    const composer = page.locator('textarea[data-thread-composer="true"]')
    await composer.focus()
    await composer.evaluate((field) => {
      const samples: number[] = []
      ;(window as unknown as { __keySamples: number[] }).__keySamples = samples
      field.addEventListener('keydown', () => {
        const started = performance.now()
        requestAnimationFrame(() => requestAnimationFrame(() => samples.push(performance.now() - started)))
      })
    })
    await page.keyboard.type('Check the latest change for regressions', { delay: 40 })
    await page.waitForTimeout(100)
    report('thread 5k: keystroke→paint', await page.evaluate(() => (window as unknown as { __keySamples: number[] }).__keySamples))
    await composer.fill('')

    // From the end to the start, 600 px per frame, recording every frame interval. Each step mounts
    // new rows, the virtualizer's worst steady case.
    const frames = await page.evaluate(async () => {
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
    report('thread 5k: scroll frame', frames)
    const longFrames = frames.filter(frame => frame > PERF_BUDGETS_MS['thread 5k: scroll frame'])
    console.log(`[RESULT] thread 5k: scroll frames over 50 ms = ${longFrames.length}/${frames.length} max=${Math.max(...frames).toFixed(1)} ms`)
    // p95 alone would let 7 long frames through; the target is none. One is tolerated as a runner pause.
    if (ENFORCE_BUDGETS) expect(longFrames.length, 'scroll frames over 50 ms').toBeLessThanOrEqual(1)

    // Streaming: one event arrives; time until the timeline has committed and painted it.
    await page.locator('.thread-timeline').evaluate(el => { el.scrollTop = el.scrollHeight })
    const appends: number[] = []
    for (let i = 0; i < REPEATS; i++) {
      appends.push(await page.evaluate(async (text) => {
        // Consecutive answers can share a row, so completion is the text on screen, not the row count.
        const shown = (): boolean => document.querySelector('.thread-virtual-space')?.textContent?.includes(text.trim()) ?? false
        const started = performance.now()
        void window.oxe.thread!.send('e2e-thread', text)
        await new Promise<void>((resolve) => {
          const check = (): void => { if (shown()) resolve(); else requestAnimationFrame(check) }
          check()
        })
        await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
        return performance.now() - started
      }, `Streaming output ${i}. `.repeat(20)))
    }
    report('thread 5k: streaming append', appends)
    const reads = await app.evaluate(() => (globalThis as Record<string, unknown>).perfReadCounts as { reads: number; deltas: number })
    expect(reads.deltas, 'streamed events arrive as deltas, not full rereads').toBeGreaterThanOrEqual(REPEATS)
  } finally {
    await killApp(app, pid)
  }
})

/**
 * Main-process memory with ten Threads open. The app runs with its real main-process services (database,
 * Thread manager, MCP), ten real Threads are created through the Thread API and every one is opened in the UI,
 * the way a person works through a stack of conversations. No provider CLI is started: creating and opening a
 * Thread does not need one. The main process is sampled before and after (a forced GC first when the runtime
 * allows it, so the heap is live data), so the budget catches a per-Thread leak or an eager load of history.
 * Budgets are 25% above the baseline measured on the CI platforms (MAIN_MEMORY_BUDGETS_MB); the gate is
 * OXESPACE_PERF_GATE, like the timings above.
 */
const THREAD_COUNT = 10
/** Baseline x 1.25, rounded up, per platform. RSS and heap are totals; growth is RSS gained while opening the Threads. */
const MAIN_MEMORY_BUDGETS_MB: Record<string, { rss: number; heap: number; growth: number }> = {
  // Windows, 4 runs: rss 162-168 MB, heap 17.0-17.2 MB (after GC), growth 3.7-9.7 MB.
  win32: { rss: 211, heap: 22, growth: 13 },
  // Linux CI runner (ubuntu-24.04), first run: rss 214.8 MB, heap 16.4 MB, growth 5.7 MB.
  linux: { rss: 270, heap: 22, growth: 13 },
  default: { rss: 211, heap: 22, growth: 13 }
}

test('memory: main process with 10 Threads open', async () => {
  test.setTimeout(150_000)
  const { app, page, pid } = await launchApp({ mockNative: false })
  const repo = join(tmpdir(), `oxe-thread-mem-${Date.now()}`, 'repo')
  try {
    mkdirSync(repo, { recursive: true })
    await page.getByTestId('btn-new-workspace').waitFor({ state: 'visible' })

    // The main process after a forced GC (when available): resident set and live JS heap, in MB.
    const sample = (): Promise<{ rss: number; heap: number; gc: boolean }> => app.evaluate(() => {
      let gc = false
      try {
        // evaluate() has no require; the builtin loader is on process.
        process.getBuiltinModule('node:v8').setFlagsFromString('--expose_gc')
        const collect = process.getBuiltinModule('node:vm').runInNewContext('gc') as () => void
        collect(); collect(); gc = true
      } catch { /* the heap is then read as is */ }
      const usage = process.memoryUsage()
      return { rss: usage.rss / 1024 / 1024, heap: usage.heapUsed / 1024 / 1024, gc }
    })

    const project = await page.evaluate(root => window.oxe.thread!.addProject(root), repo)
    await page.getByRole('navigation', { name: 'Application view' }).getByRole('button', { name: 'Thread', exact: true }).click()
    await page.locator('.thread-host').waitFor({ state: 'visible' })
    await page.waitForTimeout(1_500)
    const before = await sample()

    const ids = await page.evaluate(async ({ projectId, count }) => {
      const created: string[] = []
      for (let index = 0; index < count; index++) created.push((await window.oxe.thread!.create({ projectId, provider: 'claude' })).thread.id)
      return created
    }, { projectId: project.projectId, count: THREAD_COUNT })
    expect(new Set(ids).size, 'ten distinct Threads were created').toBe(THREAD_COUNT)
    await expect(page.locator('.thread-navigation-item').first()).toBeVisible()
    for (let index = 0; index < THREAD_COUNT; index++) {
      // The sidebar lists eight per project until "Show more"; opening a Thread through the API-backed list is
      // what a click does, so select by position and wait for the conversation.
      if (await page.locator('.thread-show-more').count()) await page.locator('.thread-show-more').click()
      await page.locator('.thread-navigation-item').nth(index).click()
      await page.locator('.thread-timeline').waitFor()
      await expect(page.locator('.thread-navigation-item[aria-current="page"]')).toHaveCount(1)
    }
    await expect(page.locator('.thread-navigation-item')).toHaveCount(THREAD_COUNT)
    await page.waitForTimeout(1_500)
    const after = await sample()
    const growth = after.rss - before.rss
    console.log(
      `[RESULT] memory main process, ${THREAD_COUNT} Threads open   rss=${after.rss.toFixed(1)}MB heap=${after.heap.toFixed(1)}MB ` +
      `(before: rss=${before.rss.toFixed(1)}MB heap=${before.heap.toFixed(1)}MB) rssGrowth=${growth.toFixed(1)}MB gc=${after.gc}`
    )
    const budget = MAIN_MEMORY_BUDGETS_MB[process.platform] ?? MAIN_MEMORY_BUDGETS_MB.default
    if (ENFORCE_BUDGETS) {
      expect(after.rss, `main process RSS after ${THREAD_COUNT} Threads (budget ${budget.rss} MB)`).toBeLessThanOrEqual(budget.rss)
      expect(after.heap, `main process heap after ${THREAD_COUNT} Threads (budget ${budget.heap} MB)`).toBeLessThanOrEqual(budget.heap)
      expect(growth, `main process RSS growth while opening ${THREAD_COUNT} Threads (budget ${budget.growth} MB)`).toBeLessThanOrEqual(budget.growth)
    }
  } finally {
    await killApp(app, pid)
  }
})

/**
 * F16: six agents in full-screen TUIs, one focused. Each pane runs a stand-in TUI that repaints its whole
 * alternate screen every 16 ms (the worst an agent spinner and status line do). Before presence, the window
 * drew all six at 60 fps: renderer 21% + GPU 20% of one core. With presence the focused pane is drawn every
 * 16 ms and the others every 100 ms, and only the budgeted panes hold WebGL. CPU is the time each Electron
 * process spent over the window (app.getAppMetrics cumulativeCPUUsage), as a share of one core; the PTY
 * processes are not Electron's and are left out, and the result is the median of five 10 s windows (single
 * windows vary by tens of points).
 * Gate for 1.4, recorded scenario: main + renderer + GPU at least 25% below the base before presence (80.5% of one
 * core, median on the reference machine), and the focused pane keeps keystroke→paint p95 <= 50 ms. The
 * 25%-of-one-core goal belongs to R1 (terminal state in Rust).
 */
const TUI_PANES = 6
const TUI_CPU_WINDOW_MS = 10_000
const TUI_CPU_BASE_PCT = 80.5
const TUI_CPU_BUDGET_PCT = Math.round(TUI_CPU_BASE_PCT * 0.75 * 10) / 10
const TUI_CPU_WINDOWS = 5
// Same bar as typing in a 5,000-event Thread: 50 ms is three dropped frames at 60 Hz.
const FOCUSED_KEY_BUDGET_MS = 50
// Shell-neutral (PowerShell and bash): no $, no !, no double quotes inside; node turns the escapes into bytes.
const FAKE_TUI = String.raw`node -e "process.stdout.write('\x1b[?1049h');let n=0;setInterval(()=>{n++;let s='\x1b[H';for(let r=0;r<40;r++)s+=('row '+r+' frame '+n+' ').padEnd(110,'=')+'\r\n';process.stdout.write(s)},16)"`

async function benchTuis(scenario: string, command: (index: number) => string, budgetPct: number): Promise<void> {
  const { app, page, pid } = await launchApp({ mockNative: false })
  try {
    // OXESPACE_BENCH_WEBGL=<n> compares WebGL budgets (src/components/Terminal/webglBudget.ts) without a build.
    if (process.env.OXESPACE_BENCH_WEBGL) {
      await page.evaluate(n => localStorage.setItem('oxe.terminal.webglPanes', n), process.env.OXESPACE_BENCH_WEBGL)
      await page.reload()
      await page.getByTestId('btn-new-workspace').waitFor()
    }
    const root = join(tmpdir(), `oxe-tui-${Date.now()}`, 'repo')
    mkdirSync(root, { recursive: true })
    await page.getByTestId('btn-new-workspace').click()
    await page.getByTestId('wizard-dir-input').fill(root)
    await page.getByTestId(`wizard-layout-card-${TUI_PANES}`).click()
    await page.getByTestId('wizard-launch-btn').click()
    await expect(page.getByTestId('terminal-status-label').filter({ hasText: 'running' })).toHaveCount(TUI_PANES, { timeout: 60_000 })
    const panes = page.getByTestId('terminal-pane')
    for (let index = 0; index < TUI_PANES; index++) {
      await panes.nth(index).locator('.terminal-view').click()
      await page.keyboard.type(command(index))
      await page.keyboard.press('Enter')
    }
    // One focused pane, in a focused window (an unfocused window draws its focused pane at the visible pace).
    await panes.first().locator('.terminal-view').click()
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.focus())
    await page.waitForTimeout(5_000)

    const cpuSeconds = (): Promise<Array<{ pid: number; type: string; seconds: number }>> => app.evaluate(({ app: electronApp }) =>
      electronApp.getAppMetrics().map(metric => ({ pid: metric.pid, type: metric.type, seconds: metric.cpu.cumulativeCPUUsage ?? NaN })))
    const webglPanes = await page.evaluate(() => document.querySelectorAll('.xterm-screen canvas.xterm-webgl, .xterm-screen > canvas:not(.xterm-link-layer)').length)
    const totals: number[] = []
    for (let run = 1; run <= TUI_CPU_WINDOWS; run++) {
      const start = await cpuSeconds()
      const startedAt = performance.now()
      await page.waitForTimeout(TUI_CPU_WINDOW_MS)
      const end = await cpuSeconds()
      const elapsedSeconds = (performance.now() - startedAt) / 1000
      const byType: Record<string, number> = {}
      for (const metric of end) {
        const before = start.find(item => item.pid === metric.pid)
        if (!before || !Number.isFinite(metric.seconds) || !Number.isFinite(before.seconds)) continue
        byType[metric.type] = (byType[metric.type] ?? 0) + (metric.seconds - before.seconds) / elapsedSeconds * 100
      }
      expect(Object.keys(byType).length, 'Electron reports cumulative CPU time per process').toBeGreaterThan(0)
      const total = (byType.Browser ?? 0) + (byType.Tab ?? 0) + (byType.GPU ?? 0)
      totals.push(total)
      console.log(
        `[RESULT] terminals: ${scenario.padEnd(32)} ${run}/${TUI_CPU_WINDOWS} main=${(byType.Browser ?? 0).toFixed(1)}% renderer=${(byType.Tab ?? 0).toFixed(1)}% ` +
        `gpu=${(byType.GPU ?? 0).toFixed(1)}% total=${total.toFixed(1)}% of one core over ${elapsedSeconds.toFixed(1)}s · webglPanes=${webglPanes} · ${JSON.stringify(byType)}`
      )
    }
    const counted = [...totals].sort((a, b) => a - b)[Math.floor(totals.length / 2)]
    console.log(`[RESULT] terminals: ${scenario.padEnd(32)} median=${counted.toFixed(1)}% of one core (budget ${budgetPct}%)`)

    // The focused pane must stay fluid while the others draw: typing into it, from key to the second frame painted
    // after it (the frame that shows the echo at the 16 ms pace).
    const input = panes.first().locator('textarea.xterm-helper-textarea')
    await input.evaluate((field) => {
      const samples: number[] = []
      ;(window as unknown as { __keySamples: number[] }).__keySamples = samples
      // On the window, in the capture phase: xterm handles and stops most keys on its textarea.
      window.addEventListener('keydown', (event) => {
        if (event.target !== field) return
        const started = performance.now()
        requestAnimationFrame(() => requestAnimationFrame(() => samples.push(performance.now() - started)))
      }, true)
    })
    await input.focus()
    await page.keyboard.type('typing while five agents draw', { delay: 40 })
    await page.waitForTimeout(100)
    const keys = await page.evaluate(() => (window as unknown as { __keySamples: number[] }).__keySamples)
    report(`terminals: ${scenario}, focused keystroke→paint`, keys)

    if (ENFORCE_BUDGETS) {
      expect(counted, `main + renderer + GPU, ${scenario}: ${counted.toFixed(1)}% of one core exceeded ${budgetPct}%`).toBeLessThanOrEqual(budgetPct)
      expect(stats(keys).p95, `focused pane keystroke→paint p95, ${scenario}`).toBeLessThanOrEqual(FOCUSED_KEY_BUDGET_MS)
    }
  } finally {
    await killApp(app, pid)
  }
}

// The main scenario: what real agent CLIs draw (Claude Code answering, Codex starting up), recorded with
// scripts/capture-tui.cjs in a test project and played back at its own pace, three panes each.
const RECORDINGS = ['tui-claude.jsonl', 'tui-codex.jsonl'].map(name => join(process.cwd(), 'e2e', 'fixtures', name))
const REPLAY = (index: number): string => `node ${join(process.cwd(), 'scripts', 'replay-tui.cjs')} ${RECORDINGS[index % RECORDINGS.length]}`

test('terminals: 6 recorded agent TUIs, 1 focused, CPU', async () => {
  test.setTimeout(240_000)
  await benchTuis('6 recorded agent TUIs, 1 focused', REPLAY, TUI_CPU_BUDGET_PCT)
})

// The worst case: every pane redraws its whole screen every 16 ms. A regression gate, not a target: no worse than
// before pane presence (106.7% of one core on the reference machine; 103.7% with it). Its 64% target belongs to R1.
const SYNTHETIC_BUDGET_PCT = 106.7

test('terminals: 6 synthetic full-screen TUIs, 1 focused, CPU (worst case)', async () => {
  test.setTimeout(240_000)
  await benchTuis('6 synthetic TUIs, 1 focused', () => FAKE_TUI, SYNTHETIC_BUDGET_PCT)
})
