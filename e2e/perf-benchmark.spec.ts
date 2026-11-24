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
import { modeButton } from './helpers/modes'
import { expect, test, type Locator } from '@playwright/test'
import { mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { performance } from 'node:perf_hooks'
import { findPaletteCommand, openConnections } from './helpers/panels'
import { installThreadFixtures, openThreadWithState, registerThreadProject } from './helpers/thread-fixtures'
import { armInputTimer, armInputTimerUntil, readInputTimer, sinceInput } from './helpers/input-timer'
import {
  CONFIRM_ON_CI,
  createWorkspace,
  ENFORCE_BUDGETS,
  formatLinuxRssSplit,
  installLongThreadReadPath,
  instrumentKeystrokeLatency,
  killApp,
  launchApp,
  longThread,
  MAIN_MEMORY_BUDGETS_MB,
  MAX_RENDERER_HEAP_MB,
  MAX_WORKING_SET_MB,
  measureThreadScrollFrames,
  PERF_BUDGETS_MS,
  pressShellShortcut,
  readKeystrokeDiagnostics,
  REPEATS,
  report,
  THREAD_COUNT,
  timeDomToggle,
  timeModeSwitch,
  timePanelToggle,
  waitForSettledMainMemory
} from './helpers/perf-harness'

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
    const { totalMs, inWindowMs } = await createWorkspace(page)
    report('workspace: create→grid (w/ input)', [totalMs])
    report('workspace: launch→grid (in-window)', [inWindowMs])
    expect(inWindowMs, 'in-window workspace launch→grid is positive').toBeGreaterThan(0)
    expect(inWindowMs, 'in-window workspace launch→grid excludes wizard input overhead').toBeLessThan(totalMs)
    const processMetrics = await app.evaluate(({ app }) => app.getAppMetrics())
    const workingSetMb = processMetrics.reduce((total, metric) => total + metric.memory.workingSetSize, 0) / 1024
    const peakWorkingSetMb = processMetrics.reduce((total, metric) => total + metric.memory.peakWorkingSetSize, 0) / 1024
    const rendererHeapMb = await page.evaluate(() => {
      const memory = (window.performance as Performance & { memory?: { usedJSHeapSize?: number } }).memory
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
    await page.locator('[data-ui="sidebar-header"] strong').last().click()
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

      commandOpen.push(await timeDomToggle(page, () => pressShellShortcut(page, 'Control+Shift+P'), 'input[placeholder="Search files and commands…"]', true))
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
    await pressShellShortcut(page, 'Control+Shift+P')
    const commandInput = page.locator('input[placeholder="Search files and commands…"]')
    // By command id, not its words: the palette's labels are "Category: Action" (F17) and may be reworded.
    await commandInput.fill('split')
    const splitCommand = page.locator('[cmdk-item][data-value="cmd-split-vertical"]')
    await splitCommand.waitFor({ state: 'visible' })
    await armInputTimerUntil(page, [{ selector: '[data-testid="pane-container"]', countAbove: paneCount }])
    await splitCommand.click()
    const splitCreate = await readInputTimer(page, 5_000).catch(() => null)
    if (splitCreate === null) {
      const notices = await page.locator('.error-banner').allTextContents()
      throw new Error(`Split pane did not complete: ${notices.join(' | ') || 'no application error reported'}`)
    }
    report('shell: create split pane', [splitCreate])
    await page.waitForFunction(
      (count) => [...document.querySelectorAll('[data-testid="terminal-status-label"]')]
        .filter((node) => node.textContent?.trim() === 'running').length > count,
      runningCount
    )
    const splitRunning = await sinceInput(page)
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
      await armInputTimerUntil(page, [{ selector: '[data-testid="sidebar-workspace-item"][data-active]', text: label }])
      await target.getByTestId('sidebar-workspace-select').click()
      switchTimes.push(await readInputTimer(page))
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
      // Ends on a live terminal in the shown workspace, not merely a painted shell: a blank-but-fast terminal would be
      // a failed fix.
      await armInputTimerUntil(page, [
        { selector: '[data-testid="sidebar-workspace-item"][data-active]', text: label },
        { selector: '.workspace-host:not(.workspace-host-hidden) [data-testid="terminal-status-label"]', text: 'running' }
      ])
      await target.getByTestId('sidebar-workspace-select').click()
      returnTimes.push(await readInputTimer(page))
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
      toFiles.push(await timePanelToggle(page, 'Files', 'workspace-editor-panel', true))
    }

    report('repository: Files→Source Control', toSourceControl)
    report('repository: Source Control→Files', toFiles)
  } finally {
    await killApp(app, pid)
  }
})

test('modal surfaces: agents, MCP, workspace settings and usage', async () => {
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
    let option: Locator | null = null
    const fromPalette = (label: string, selector: string, title: string) => ({
      label,
      selector,
      prepare: async () => { option = await findPaletteCommand(page, title) },
      trigger: () => option!.click()
    })
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
      // Settings restores terminal focus; move to navigation before an app shortcut. Finding the command is setup;
      // the measured interaction is choosing it.
      await page.locator('[data-ui="sidebar-header"] strong').last().click()
      await page.keyboard.press('Control+Shift+P')
      const input = page.locator('input[placeholder="Search files and commands…"]')
      await input.fill('usage')
      const usageCommand = page.locator('[cmdk-item][data-value="cmd-open-usage"]')
      await usageCommand.waitFor({ state: 'visible' })
      await armInputTimer(page, '[data-testid="usage-modal"]', true)
      await usageCommand.click()
      usageOpen.push(await readInputTimer(page))
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
    const nav = page.getByRole('tablist', { name: 'Application view' })
    await modeButton(page, 'thread').click()
    await page.locator('.thread-host').waitFor({ state: 'visible' })
    await nav.getByRole('tab', { name: 'OxeQuery', exact: true }).click()
    await page.locator('.oq-host').waitFor({ state: 'visible' })
    await modeButton(page, 'code').click()
    await page.waitForTimeout(250)
    const toThread: number[] = []
    const toData: number[] = []
    const toCode: number[] = []
    for (let i = 0; i < REPEATS; i++) {
      toThread.push(await timeModeSwitch(page, 'thread'))
      toData.push(await timeModeSwitch(page, 'data'))
      toCode.push(await timeModeSwitch(page, 'code'))
    }
    report('mode switch: Code→Thread', toThread)
    report('mode switch: Thread→OxeQuery', toData)
    report('mode switch: OxeQuery→Code', toCode)
  } finally {
    await killApp(app, pid)
  }
})

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
    await installLongThreadReadPath(app, longThread(1_250), repo)
    const space = page.locator('.thread-virtual-space')
    await expect(space).toHaveAttribute('data-total-rows', /^\d{4,}$/)
    const totalRows = Number(await space.getAttribute('data-total-rows'))
    const mountedRows = Number(await space.getAttribute('data-mounted-rows'))
    console.log(`[RESULT] thread 5k: rows total=${totalRows} mounted=${mountedRows}`)
    expect(mountedRows, 'the timeline stays virtualized').toBeLessThanOrEqual(80)

    // Typing re-renders the conversation view on every key, so per-render work over the events shows here.
    const composer = page.locator('textarea[data-thread-composer="true"]')
    await composer.focus()
    await instrumentKeystrokeLatency(composer)
    await page.keyboard.type('Check the latest change for regressions', { delay: 40 })
    await page.waitForTimeout(100)
    const keySamples = await page.evaluate(() => (window as unknown as { __keySamples: number[] }).__keySamples)
    // FL-24: only when a key was slow, one line with the slow keys, the long tasks and the app's own marks (idle
    // preload, chunk loads) around the typing window, so a spike on CI names its cause.
    const keyBudget = PERF_BUDGETS_MS['thread 5k: keystroke→paint']
    if (keySamples.some(sample => sample > keyBudget)) {
      const diag = await readKeystrokeDiagnostics(page, keyBudget)
      console.log(`[FL-24-DIAG] ${diag}`)
    }
    report('thread 5k: keystroke→paint', keySamples)
    await composer.fill('')

    const over = (frames: number[]): number[] => frames.filter(frame => frame > PERF_BUDGETS_MS['thread 5k: scroll frame'])
    let frames = await measureThreadScrollFrames(page)
    report('thread 5k: scroll frame', frames)
    let longFrames = over(frames)
    console.log(`[RESULT] thread 5k: scroll frames over 50 ms = ${longFrames.length}/${frames.length} max=${Math.max(...frames).toFixed(1)} ms`)
    // On CI a pass with more than one long frame scrolls again and is judged on that second pass: a shared runner's
    // slow minute fails one pass, a real regression fails both (as perceived-perf's second round, #353).
    if (ENFORCE_BUDGETS && CONFIRM_ON_CI && longFrames.length > 1) {
      const first = longFrames.length
      frames = await measureThreadScrollFrames(page)
      longFrames = over(frames)
      console.log(`[CONFIRM] thread 5k: scroll frames over 50 ms, pass 1 ${first}, pass 2 ${longFrames.length}/${frames.length} → ${longFrames.length > 1 ? 'regression' : 'runner noise'}`)
    }
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

    // The same keystrokes while an agent streams (OXE-105): one event every 100 ms through the same thread:send path
    // as the append above. Reported only; a build where the composer refuses input meanwhile says so instead of
    // failing the test.
    try {
      await composer.focus()
      await page.evaluate(() => {
        const box = window as unknown as { __keySamples: number[]; __perfStream?: number }
        box.__keySamples.length = 0
        let tick = 0
        box.__perfStream = window.setInterval(() => { void window.oxe.thread!.send('e2e-thread', `Streamed chunk ${tick++}. `.repeat(8)) }, 100)
      })
      await page.keyboard.type('Check the latest change for regressions', { delay: 40 })
      await page.waitForTimeout(100)
      const streamingKeys = await page.evaluate(() => {
        const box = window as unknown as { __keySamples: number[]; __perfStream?: number }
        window.clearInterval(box.__perfStream)
        return [...box.__keySamples]
      })
      report('thread 5k: keystroke→paint while streaming', streamingKeys)
    } catch (error) {
      console.log(`[RESULT] thread 5k: keystroke→paint while streaming — not measured: ${error instanceof Error ? error.message.split('\n')[0] : String(error)}`)
    }
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
 *
 * The growth is counted outside V8's young generation. That space grows with how much was allocated during the
 * burst and stays resident after the collection with nothing live in it, so it measured how busy opening the Threads
 * was, not what they keep. Measured on CI (run 43145038852, 12/11/2026), first ten Threads then ten more:
 *   Linux    rss +12.3 then +9.4 MB · young generation +6.5 then +8.8 · outside it 5.8 then 0.6 · live heap 15.0 -> 16.1
 *   Windows  rss  +9.9 then +16.3 MB · young generation +4.7 then +14.5 · outside it 5.2 then 1.8 · live heap 15.3 -> 16.2
 * With the whole resident set under a 13 MB budget, Linux read 13.2, 13.6, 13.1, 13.5 and 12.3 MB on one code base.
 */
test('memory: main process with 10 Threads open', async () => {
  test.setTimeout(150_000)
  const { app, page, pid } = await launchApp({ mockNative: false })
  const repo = join(tmpdir(), `oxe-thread-mem-${Date.now()}`, 'repo')
  try {
    mkdirSync(repo, { recursive: true })
    await page.getByTestId('btn-new-workspace').waitFor({ state: 'visible' })

    const project = await page.evaluate(root => window.oxe.thread!.addProject(root), repo)
    await modeButton(page, 'thread').click()
    await page.locator('.thread-host').waitFor({ state: 'visible' })
    await page.waitForTimeout(1_500)
    const before = await waitForSettledMainMemory(app, page)

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
      await expect(page.locator('.thread-navigation-item[aria-current]')).toHaveCount(1)
    }
    await expect(page.locator('.thread-navigation-item')).toHaveCount(THREAD_COUNT)
    await page.waitForTimeout(1_500)
    const after = await waitForSettledMainMemory(app, page)
    const total = after.rss - before.rss
    const youngGrowth = after.young - before.young
    const growth = total - youngGrowth
    console.log(
      `[RESULT] memory main process, ${THREAD_COUNT} Threads open   rss=${after.rss.toFixed(1)}MB heap=${after.heap.toFixed(1)}MB${formatLinuxRssSplit(after)} ` +
      `(before: rss=${before.rss.toFixed(1)}MB heap=${before.heap.toFixed(1)}MB${formatLinuxRssSplit(before)}) rssGrowth=${total.toFixed(1)}MB (young generation ${youngGrowth.toFixed(1)}MB, outside it ${growth.toFixed(1)}MB) gc=${after.gc} ` +
      `settled after ${before.waits}/${after.waits} waits`
    )
    console.log(`[RESULT] memory main process, where: before ${before.detail}`)
    console.log(`[RESULT] memory main process, where: after  ${after.detail}`)
    // Reported, not budgeted: ten more Threads, every one opened. A cost per Thread shows again in full here; what
    // the first ten paid once (code compiled on first use, caches, a grown young generation) does not.
    try {
      await page.evaluate(async ({ projectId, count }) => {
        for (let index = 0; index < count; index++) await window.oxe.thread!.create({ projectId, provider: 'claude' })
      }, { projectId: project.projectId, count: THREAD_COUNT })
      for (let index = 0; index < THREAD_COUNT * 2; index++) {
        if (await page.locator('.thread-show-more').count()) await page.locator('.thread-show-more').click()
        await page.locator('.thread-navigation-item').nth(index).click()
        await page.locator('.thread-timeline').waitFor()
      }
      await page.waitForTimeout(1_500)
      const again = await waitForSettledMainMemory(app, page)
      console.log(`[RESULT] memory main process, ${THREAD_COUNT} more Threads   rss=${again.rss.toFixed(1)}MB heap=${again.heap.toFixed(1)}MB${formatLinuxRssSplit(again)} rssGrowth=${(again.rss - after.rss).toFixed(1)}MB (young generation ${(again.young - after.young).toFixed(1)}MB, outside it ${(again.rss - after.rss - (again.young - after.young)).toFixed(1)}MB)`)
      console.log(`[RESULT] memory main process, where: again  ${again.detail}`)
    } catch (error) {
      console.log(`[RESULT] memory main process, ${THREAD_COUNT} more Threads   not measured: ${error instanceof Error ? error.message.split('\n')[0] : String(error)}`)
    }
    const budget = MAIN_MEMORY_BUDGETS_MB[process.platform] ?? MAIN_MEMORY_BUDGETS_MB.default
    if (ENFORCE_BUDGETS) {
      expect(after.rss, `main process RSS after ${THREAD_COUNT} Threads (budget ${budget.rss} MB)`).toBeLessThanOrEqual(budget.rss)
      expect(after.heap, `main process heap after ${THREAD_COUNT} Threads (budget ${budget.heap} MB)`).toBeLessThanOrEqual(budget.heap)
      expect(growth, `main process RSS growth outside V8's young generation while opening ${THREAD_COUNT} Threads (budget ${budget.growth} MB)`).toBeLessThanOrEqual(budget.growth)
    }
  } finally {
    await killApp(app, pid)
  }
})
