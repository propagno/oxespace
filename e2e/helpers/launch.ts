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

/** Launches the built app against a temporary database (requires `npm run build` first). */
export async function launchApp(options: { appearance?: Appearance } = {}): Promise<LaunchedApp> {
  const root = mkdtempSync(join(tmpdir(), 'oxespace-visual-'))
  const workspaceRoot = join(root, 'demo-repo')
  mkdirSync(workspaceRoot, { recursive: true })

  const app = await electron.launch({
    args: [join(process.cwd(), 'e2e', 'electron-main.cjs')],
    env: {
      ...process.env,
      OXESPACE_DISABLE_SINGLE_INSTANCE: '1',
      OXESPACE_E2E_MOCK_NATIVE: '1',
      OXESPACE_DB_PATH: join(root, 'oxespace.sqlite3')
    }
  })
  const page = await app.firstWindow()
  const consoleErrors: string[] = []
  page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 300)) })
  page.on('pageerror', e => consoleErrors.push(`pageerror: ${e.message.slice(0, 300)}`))
  await page.waitForLoadState('load')

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
