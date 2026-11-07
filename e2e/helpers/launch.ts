import { _electron as electron, expect, type ElectronApplication, type Page } from '@playwright/test'
import { mkdirSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { withoutLiveApp } from './live-app-env'

export interface LaunchedApp {
  app: ElectronApplication
  page: Page
  /** Throwaway directory holding the SQLite file and the demo workspace. */
  root: string
  workspaceRoot: string
  consoleErrors: string[]
}

export type Appearance = 'light' | 'dark' | 'system'

/** The instant every visual test pretends it is, so relative times render identically. */
export const FIXED_NOW = Date.UTC(2026, 9, 14, 12, 0, 0)

/** The user-timing methods Playwright's fake clock stubs out; they are put back so the timeline stays real (F28). */
const USER_TIMING = ['mark', 'measure', 'getEntries', 'getEntriesByName', 'getEntriesByType', 'clearMarks', 'clearMeasures'] as const

/** Keeps the page's real user-timing methods, before the fake clock replaces `performance`. */
function captureUserTiming(names: readonly string[]): void {
  const holder = window as unknown as { __oxeUserTiming?: Record<string, unknown> }
  if (holder.__oxeUserTiming) return
  const real = performance as unknown as Record<string, (...args: unknown[]) => unknown>
  holder.__oxeUserTiming = Object.fromEntries(names.filter(name => typeof real[name] === 'function').map(name => [name, real[name].bind(performance)]))
}

/** Puts the real user-timing methods back on the fake `performance`: Date, now() and timers stay frozen. */
function restoreUserTiming(): void {
  const real = (window as unknown as { __oxeUserTiming?: Record<string, unknown> }).__oxeUserTiming
  if (!real) return
  for (const [name, method] of Object.entries(real)) {
    try { Object.defineProperty(performance, name, { configurable: true, writable: true, value: method }) } catch { /* left as the clock made it */ }
  }
}

/**
 * Freezes Date in the renderer (and performance.now and timers, the way Playwright's clock does). Its fake
 * `performance` also stubs the user timing: marks and measures are dropped and getEntriesByName returns [], so Monaco's
 * input-latency probe threw "reading 'duration'" page errors on every few keystrokes (F28). The real user-timing
 * methods are kept before the clock installs and put back after, on this page and on every reload.
 */
export async function freezeClock(page: Page): Promise<void> {
  await page.addInitScript(captureUserTiming, USER_TIMING)
  await page.evaluate(captureUserTiming, USER_TIMING)
  await page.clock.setFixedTime(new Date(FIXED_NOW))
  await page.evaluate(restoreUserTiming)
  await page.addInitScript(restoreUserTiming)
}

/** Launches the built app against a temporary database (requires `npm run build` first). */
/** `env` adds variables for one spec (e.g. OXESPACE_E2E_AGENT_STATE=1), on top of the defaults below. */
/** `realClock` skips freezeClock, for a spec that needs time to move. */
export async function launchApp(options: { appearance?: Appearance; locale?: string; density?: Density; env?: Record<string, string>; realClock?: boolean } = {}): Promise<LaunchedApp> {
  const root = mkdtempSync(join(tmpdir(), 'oxespace-visual-'))
  const workspaceRoot = join(root, 'demo-repo')
  mkdirSync(workspaceRoot, { recursive: true })

  const app = await electron.launch({
    args: [join(process.cwd(), 'e2e', 'electron-main.cjs')],
    env: {
      // Never the running app's MCP, execution or hook variables: the app under test is the only one a spec reaches.
      ...withoutLiveApp(process.env),
      // Clock formatting ('checked 09:00 local time') must not depend on the machine's zone.
      TZ: 'UTC',
      OXESPACE_DISABLE_SINGLE_INSTANCE: '1',
      OXESPACE_E2E_MOCK_NATIVE: '1',
      OXESPACE_DB_PATH: join(root, 'oxespace.sqlite3'),
      // The system language the app sees; e2e/electron-main.cjs pins English when unset.
      ...(options.locale ? { OXESPACE_LOCALE: options.locale } : {}),
      ...options.env
    }
  })
  // The RTK sidecar check hits the network and, when it finds an update, adds an icon to
  // the title bar. Pin it to "up to date" so layout never depends on connectivity.
  await app.evaluate(({ ipcMain }) => {
    const upToDate = { installed: true, version: '0.0.0', latestVersion: '0.0.0', updateAvailable: false, binDir: null, error: null, checking: false, updating: false, lastCheckedAt: 1_791_979_200_000 }
    for (const channel of ['rtk:get-status', 'rtk:check-for-update']) {
      ipcMain.removeHandler(channel)
      ipcMain.handle(channel, () => upToDate)
    }
  })
  const page = await app.firstWindow()
  const consoleErrors: string[] = []
  page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 300)) })
  // The stack's first frames are what tells a fixture gap from a real renderer bug.
  page.on('pageerror', e => consoleErrors.push(`pageerror: ${e.message.slice(0, 300)}\n${(e.stack ?? '').split('\n').slice(1, 4).join('\n')}`))
  await page.waitForLoadState('load')
  if (!options.realClock) await freezeClock(page)

  if (options.appearance || options.density) await setAppearance(page, options.appearance ?? 'light', options.density)
  return { app, page, root, workspaceRoot, consoleErrors }
}

export type Density = 'compact' | 'comfortable'

/** Persists the appearance (and, when given, the density) and reloads so the whole app renders with it. */
export async function setAppearance(page: Page, appearance: Appearance, density?: Density): Promise<void> {
  await page.evaluate(
    ([mode, spacing]) => localStorage.setItem('oxe-settings', JSON.stringify({
      state: { appearance: mode, notificationsEnabled: true, visitedWorkspacesCap: 5, ...(spacing ? { density: spacing } : {}) },
      version: 3
    })),
    [appearance, density] as const
  )
  await page.reload()
  await page.waitForLoadState('load')
  await freezeClock(page)
}

export async function resizeWindow(app: ElectronApplication, width: number, height: number): Promise<void> {
  await app.evaluate(({ BrowserWindow }, [w, h]) => {
    const win = BrowserWindow.getAllWindows()[0]
    win.setSize(w, h)
    win.center()
  }, [width, height])
}

/**
 * Lays the window out `width` CSS px wide whatever the screen: CI screens can be narrower than asked (the window is
 * clamped), so the page is zoomed out to fit. The app applies its own interface scale once React mounts
 * (ThemeProvider → setUiScale), which would put a zoom set any earlier back to 100%: this waits for the shell to be
 * drawn, zooms, and returns only once the shell really lays out at that width.
 */
export async function layoutAtWidth(app: ElectronApplication, page: Page, width: number, height: number): Promise<void> {
  await resizeWindow(app, width, height)
  await page.locator('.app-shell').waitFor({ state: 'visible' })
  const shellWidth = (): Promise<number> => page.locator('.app-shell').evaluate(node => Math.round(node.getBoundingClientRect().width))
  await expect.poll(async () => {
    await app.evaluate(({ BrowserWindow }, wanted) => {
      const win = BrowserWindow.getAllWindows()[0]
      const factor = Math.min(1, win.getContentBounds().width / wanted)
      if (Math.abs(win.webContents.getZoomFactor() - factor) > 0.001) win.webContents.setZoomFactor(factor)
    }, width)
    return Math.abs(await shellWidth() - width) <= 2
  }, { message: `the shell lays out ${width} CSS px wide`, timeout: 10_000 }).toBe(true)
}

/** Diagnostics for a layout-dependent failure: zoom, window, shell, split grid and pane widths, and visible toasts. */
export async function layoutDiag(app: ElectronApplication, page: Page): Promise<string> {
  const win = await app.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows()[0]
    return { zoom: window.webContents.getZoomFactor(), content: window.getContentBounds(), maximized: window.isMaximized(), fullScreen: window.isFullScreen() }
  })
  const dom = await page.evaluate(() => {
    const width = (selector: string): number[] => [...document.querySelectorAll(selector)].map(node => Math.round(node.getBoundingClientRect().width))
    return {
      inner: `${window.innerWidth}x${window.innerHeight}`, dpr: window.devicePixelRatio, shell: width('.app-shell'), sidebar: width('aside.sidebar'),
      grids: width('.workspace-host:not(.workspace-host-hidden) .workspace-split-grid'), panes: width('[data-testid="pane-container"]'),
      surface: width('section.workspace-surface'),
      sidePanels: [...document.querySelectorAll('.workspace-host:not(.workspace-host-hidden) [data-testid$="-panel"]')].map(node => `${node.getAttribute('data-testid')}=${Math.round(node.getBoundingClientRect().width)}`),
      panelTabs: [...document.querySelectorAll('.workspace-host:not(.workspace-host-hidden) .workspace-panel-stack-tablist [role="tab"]')].map(node => node.textContent ?? ''),
      toasts: [...document.querySelectorAll('[role=status],[role=alert]')].map(node => (node.textContent ?? '').slice(0, 120)).filter(Boolean)
    }
  })
  return JSON.stringify({ ...win, ...dom })
}

/** Creates the demo workspace through the wizard, the same path a user takes. */
export async function openDemoWorkspace(page: Page, workspaceRoot: string): Promise<void> {
  await page.getByTestId('btn-new-workspace').click()
  await page.getByTestId('wizard-dir-input').fill(workspaceRoot)
  await page.getByTestId('wizard-launch-btn').click()
  await page.waitForSelector('[data-testid="workspace-grid"], [data-testid="workspace-split-grid"]', { timeout: 10_000 })
}

/**
 * FL-19: a workspace's color, until a person picks one, comes from a hash of its id (A8), and every launch makes a new
 * random id, so the visual specs drew a different color in generate and in verify. This picks the `color`-th swatch
 * (1–8) for the `index`-th workspace card through the workspace menu, the same path a person takes, so the shots are
 * stable. The hash itself is right for people and stays as it is. Focus goes back to the page, so no focus ring is shot.
 *
 * Right after a workspace is created, a snapshot of it from main's create flow can still be on its way. Arriving after
 * the color change, it puts the old color back (seen in run 42398614689: the card kept its hashed color while one test
 * in the same run kept the pin). So the color must hold for a moment before this returns, and the pick is tried again
 * if it was undone.
 */
export async function pinWorkspaceColor(page: Page, color = 1, index = 0): Promise<void> {
  const card = page.getByTestId('sidebar-workspace-item').nth(index)
  const held = async (): Promise<boolean> => {
    try {
      await expect(card).toHaveAttribute('data-ws', String(color), { timeout: 5_000 })
      await page.waitForTimeout(1_000)
      return await card.getAttribute('data-ws') === String(color)
    } catch { return false }
  }
  for (let attempt = 1; ; attempt++) {
    await card.getByTestId('ws-group-settings-btn').click()
    await page.getByRole('menuitem', { name: /^(Workspace color|Cor do workspace)…$/ }).click()
    const dialog = page.getByTestId('workspace-color-dialog')
    // The first radio is Automatic (the hash); the swatches follow in order.
    const swatch = dialog.getByRole('radio').nth(color)
    await swatch.click()
    await expect(dialog).toBeHidden()
    if (await held()) break
    if (attempt === 3) await expect(card, `the workspace color stays ${color} after 3 picks`).toHaveAttribute('data-ws', String(color))
  }
  await page.evaluate(() => { (document.activeElement as HTMLElement | null)?.blur() })
}
