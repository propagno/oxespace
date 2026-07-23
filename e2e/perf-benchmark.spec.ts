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
  const warm = xs.length > 1 ? stats(xs.slice(1)) : null
  const flag = s.mean > 100 ? '🔴' : s.mean > 16.7 ? '🟡' : '🟢'
  console.log(
    `[RESULT] ${op.padEnd(40)} n=${xs.length} min=${f(s.min)} mean=${f(s.mean)} p95=${f(s.p95)} max=${f(s.max)} ms` +
    `${warm ? ` · warm mean=${f(warm.mean)} p95=${f(warm.p95)}` : ''} ${flag}`
  )
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
  let closed = false
  await Promise.race([
    app.close().then(() => { closed = true }).catch(() => undefined),
    new Promise((r) => setTimeout(r, 3000))
  ])
  // Only force-stop a hung isolated test process. Killing unconditionally can
  // terminate a concurrently running Electron instance on Windows.
  if (closed) return
  if (pid) { try { process.kill(pid, 'SIGKILL') } catch { /* dead */ } }
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

  const modal = page.getByTestId('tools-modal')
  if (!await modal.isVisible().catch(() => false)) {
    await page.locator('[data-testid="btn-open-tools"]:visible').click()
    await modal.waitFor({ state: 'visible' })
  }
  const escapedLabel = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const item = modal.getByRole('menuitem', { name: new RegExp(`^${escapedLabel}(?: \\(|$)`) })
  await item.waitFor({ state: 'visible' })

  const t0 = await page.evaluate(() => performance.now())
  await item.click()
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
  await killApp(app, pid)
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

      toolsOpen.push(await timeDomToggle(page, () => page.getByTestId('btn-open-tools').click(), '[data-testid="tools-modal"]', true))
      toolsClose.push(await timeDomToggle(page, () => page.keyboard.press('Escape'), '[data-testid="tools-modal"]', false))

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
    await commandInput.fill('Split active pane (vertical)')
    const splitCommand = page.getByText('Split active pane (vertical)', { exact: true })
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
        (name) => document.querySelector('.workspace-host:not(.workspace-host-hidden) .workspace-topbar-name')?.textContent?.trim() === name,
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

test('repository: Files ↔ Source Control', async () => {
  test.setTimeout(90_000)
  const { app, page, pid } = await launchApp()
  try {
    await createWorkspace(page)
    await timePanelToggle(page, 'Editor', 'workspace-editor-panel', true)
    const toSourceControl: number[] = []
    const toFiles: number[] = []

    for (let i = 0; i < REPEATS; i++) {
      toSourceControl.push(await timeDomToggle(
        page,
        () => page.getByTestId('workspace-editor-panel').getByRole('button', { name: 'Source control' }).click(),
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
    }> = [
      {
        label: 'Agent Settings',
        selector: '[data-testid="settings-modal"]',
        trigger: () => page.getByTestId('tools-agent-settings').click()
      },
      {
        label: 'MCP Servers',
        selector: '[role="dialog"][aria-label="MCP servers"]',
        trigger: () => page.getByTestId('tools-modal').getByRole('menuitem', { name: 'MCP Servers', exact: true }).click()
      },
      {
        label: 'Skills',
        selector: '[role="dialog"][aria-label="Skills"]',
        trigger: () => page.getByTestId('tools-modal').getByRole('menuitem', { name: 'Skills', exact: true }).click()
      },
      {
        label: 'Semantic Activity',
        selector: '[role="dialog"][aria-label="Semantic activity"]',
        trigger: () => page.getByTestId('tools-modal').getByRole('menuitem', { name: 'Semantic Activity', exact: true }).click()
      },
      {
        label: 'Workspace Settings',
        selector: '.workspace-settings-modal-v2',
        trigger: () => page.getByTestId('tools-modal').getByRole('menuitem', { name: 'Workspace Settings', exact: true }).click()
      }
    ]

    for (const surface of surfaces) {
      const opens: number[] = []
      const closes: number[] = []
      for (let i = 0; i < modalRepeats; i++) {
        await page.getByTestId('btn-open-tools').click()
        await page.getByTestId('tools-modal').waitFor({ state: 'visible' })
        opens.push(await timeDomToggle(page, surface.trigger, surface.selector, true))
        closes.push(await timeDomToggle(
          page,
          () => page.locator(surface.selector).getByRole('button', { name: /^Close/ }).first().click(),
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
      await page.keyboard.press('Control+k')
      const input = page.locator('input[placeholder="Search files and commands…"]')
      await input.fill('Usage & Rate Limits')
      await page.getByText('Usage & Rate Limits', { exact: true }).click()
      await page.locator('[data-testid="usage-modal"]').waitFor({ state: 'visible' })
      usageOpen.push(await page.evaluate((start) => performance.now() - start, started))
      usageClose.push(await timeDomToggle(page, () => page.keyboard.press('Escape'), '[data-testid="usage-modal"]', false))
    }
    report('modal open:  Usage & Rate Limits', usageOpen)
    report('modal close: Usage & Rate Limits', usageClose)
  } finally {
    await killApp(app, pid)
  }
})

const PANELS: Array<{ label: string; testId: string; closeButtonName?: string }> = [
  { label: 'GitHub', testId: 'workspace-github-panel' },
  { label: 'Editor', testId: 'workspace-editor-panel' },
  { label: 'Review', testId: 'workspace-review-panel' },
  { label: 'Worktrees', testId: 'workspace-worktree-panel' },
  { label: 'Scripts', testId: 'workspace-scripts-panel' },
  { label: 'Find in Files', testId: 'workspace-search-panel' },
  { label: 'Web Preview', testId: 'workspace-web-preview-panel' },
  {
    label: 'Multi-repo coordination',
    testId: 'workspace-integration-panel',
    closeButtonName: 'Close multi-repo coordination panel'
  },
  { label: 'Background Jobs', testId: 'workspace-background-panel' }
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
