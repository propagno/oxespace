import { _electron as electron, type ElectronApplication, type Page } from '@playwright/test'
import { mkdirSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

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

/** Freezes Date in the renderer. Call again after a reload. */
export async function freezeClock(page: Page): Promise<void> {
  await page.clock.setFixedTime(new Date(FIXED_NOW))
}

/** Launches the built app against a temporary database (requires `npm run build` first). */
export async function launchApp(options: { appearance?: Appearance } = {}): Promise<LaunchedApp> {
  const root = mkdtempSync(join(tmpdir(), 'oxespace-visual-'))
  const workspaceRoot = join(root, 'demo-repo')
  mkdirSync(workspaceRoot, { recursive: true })

  const app = await electron.launch({
    args: [join(process.cwd(), 'e2e', 'electron-main.cjs')],
    env: {
      ...process.env,
      // Clock formatting ('checked 09:00 local time') must not depend on the machine's zone.
      TZ: 'UTC',
      OXESPACE_DISABLE_SINGLE_INSTANCE: '1',
      OXESPACE_E2E_MOCK_NATIVE: '1',
      OXESPACE_DB_PATH: join(root, 'oxespace.sqlite3')
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
  await freezeClock(page)

  if (options.appearance) await setAppearance(page, options.appearance)
  return { app, page, root, workspaceRoot, consoleErrors }
}

/** Persists the appearance setting and reloads so the whole app renders with it. */
export async function setAppearance(page: Page, appearance: Appearance): Promise<void> {
  await page.evaluate(
    mode => localStorage.setItem('oxe-settings', JSON.stringify({
      state: { appearance: mode, notificationsEnabled: true, visitedWorkspacesCap: 5 },
      version: 3
    })),
    appearance
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

/** Creates the demo workspace through the wizard, the same path a user takes. */
export async function openDemoWorkspace(page: Page, workspaceRoot: string): Promise<void> {
  await page.getByTestId('btn-new-workspace').click()
  await page.getByTestId('wizard-dir-input').fill(workspaceRoot)
  await page.getByTestId('wizard-launch-btn').click()
  await page.waitForSelector('[data-testid="workspace-grid"], [data-testid="workspace-split-grid"]', { timeout: 10_000 })
}
