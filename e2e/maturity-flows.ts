import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

/**
 * Flows that carry the 1.0 maturity claim of the items added for the release, written once and
 * run twice: against the unpackaged app in the normal E2E job, and against the shipped binary in
 * the packaged smoke (see packaged-win.spec.ts and packaged-linux.spec.ts).
 *
 * The app runs in its real mode, not the E2E mock mode: the point is the real database, the real
 * window settings and the real agent detection.
 *
 * Covered: window hardening as Chromium reports it, database version stable across launches,
 * the first-run card, and keyboard navigation of the file tree.
 */
export interface MaturityFlowsOptions {
  /** Title prefix, e.g. "Windows packaged". */
  label: string
  /** Opens the app with these extra environment variables. */
  launch: (env: Record<string, string>) => Promise<ElectronApplication>
  /** True when launching the shipped binary: also asserts `app.isPackaged`. */
  packaged: boolean
  /** Host this registration is meaningful on; skipped elsewhere. */
  platform?: NodeJS.Platform
}

const ENV = { OXESPACE_DISABLE_SINGLE_INSTANCE: '1' }

/** Launcher for the shipped binary named by OXESPACE_PACKAGED_EXECUTABLE, as the packaged smoke uses. */
export function packagedLauncher(): MaturityFlowsOptions['launch'] {
  return env => {
    const executablePath = process.env.OXESPACE_PACKAGED_EXECUTABLE
    expect(executablePath, 'OXESPACE_PACKAGED_EXECUTABLE').toBeTruthy()
    expect(existsSync(executablePath!), `packaged executable ${executablePath}`).toBe(true)
    return electron.launch({ executablePath, env: { ...process.env, ...env } })
  }
}

async function boot(options: MaturityFlowsOptions, databasePath: string): Promise<{ app: ElectronApplication; page: Page }> {
  const app = await options.launch({ ...ENV, OXESPACE_DB_PATH: databasePath })
  const page = await app.firstWindow()
  await page.getByTestId('btn-new-workspace').waitFor({ state: 'visible', timeout: 30_000 })
  if (options.packaged) expect(await app.evaluate(({ app: electronApp }) => electronApp.isPackaged)).toBe(true)
  return { app, page }
}

function scratch(name: string): { root: string; database: string; workspace: string } {
  const root = mkdtempSync(join(tmpdir(), `oxe-maturity-${name}-`))
  const workspace = join(root, 'workspace')
  mkdirSync(workspace, { recursive: true })
  return { root, database: join(root, 'oxespace.sqlite3'), workspace }
}

function seed(workspace: string): void {
  for (const [path, text] of [['README.md', '# Fixture\n'], ['src/app.ts', 'export const app = 1\n'], ['src/lib/util.ts', 'export const util = 2\n']] as const) {
    mkdirSync(dirname(join(workspace, path)), { recursive: true })
    writeFileSync(join(workspace, path), text)
  }
}

async function userVersion(databasePath: string): Promise<number> {
  const { default: Database } = await import('better-sqlite3')
  const db = new Database(databasePath, { readonly: true, fileMustExist: true })
  try {
    return db.pragma('user_version', { simple: true }) as number
  } finally {
    db.close()
  }
}

export function registerMaturityFlows(options: MaturityFlowsOptions): void {
  const { label, platform } = options
  const guard = (): void => { if (platform) test.skip(process.platform !== platform, `${label} maturity flows`) }

  test(`${label}: every window and guest is isolated, sandboxed and has no Node`, async () => {
    test.setTimeout(90_000)
    guard()
    const dirs = scratch('hardening')
    const { app, page } = await boot(options, dirs.database)
    try {
      // Open a Web Preview so a guest exists, not only the main window.
      await page.getByTestId('btn-new-workspace').click()
      await page.getByTestId('wizard-dir-input').fill(dirs.workspace)
      await page.getByTestId('wizard-layout-card-1').click()
      await page.getByTestId('wizard-launch-btn').click()
      await page.waitForSelector('[data-testid="workspace-grid"], [data-testid="workspace-split-grid"]', { timeout: 30_000 })

      const contents = await app.evaluate(({ webContents }) => webContents.getAllWebContents()
        .filter(item => !item.isDestroyed() && ['window', 'webview', 'browserView'].includes(item.getType()))
        .map(item => {
          const preferences = item.getLastWebPreferences() ?? {}
          return { type: item.getType(), contextIsolation: preferences.contextIsolation, nodeIntegration: preferences.nodeIntegration, sandbox: preferences.sandbox }
        }))
      expect(contents.length, 'at least the main window').toBeGreaterThan(0)
      for (const item of contents) {
        expect(item.contextIsolation, `${item.type} contextIsolation`).toBe(true)
        expect(item.nodeIntegration, `${item.type} nodeIntegration`).toBeFalsy()
        expect(item.sandbox, `${item.type} sandbox`).toBe(true)
      }
      // What the page itself can see: nothing from Node.
      expect(await page.evaluate(() => [typeof require, typeof process, typeof module, typeof Buffer])).toEqual(['undefined', 'undefined', 'undefined', 'undefined'])
    } finally {
      await app.close()
    }
  })

  test(`${label}: the database keeps one version across launches and takes no extra backup`, async () => {
    test.setTimeout(150_000)
    guard()
    const dirs = scratch('reopen')
    const versions: number[] = []
    for (let launch = 1; launch <= 3; launch++) {
      const { app } = await boot(options, dirs.database)
      await app.close()
      versions.push(await userVersion(dirs.database))
    }
    expect(versions[0], 'a real, migrated version').toBeGreaterThan(0)
    expect(new Set(versions).size, `versions per launch: ${versions.join(', ')}`).toBe(1)
    expect(existsSync(join(dirs.root, 'db-backups')), 'a database already at the latest version is not backed up again').toBe(false)
  })

  test(`${label}: the empty screen says whether an agent CLI is available`, async () => {
    test.setTimeout(90_000)
    guard()
    const dirs = scratch('first-run')
    const { app, page } = await boot(options, dirs.database)
    try {
      const card = page.getByRole('region', { name: 'Before you start' })
      await expect(card).toBeVisible()
      // The first launch checks the machine once; wait for that check to finish.
      await expect(card).not.toContainText('Checking for agent CLIs', { timeout: 60_000 })
      await expect(card).toContainText(/(is|are) ready|No agent CLI found|found but not ready|not checked yet/)
      await expect(card).toContainText('gh auth login')
      if (/No agent CLI found/.test(await card.innerText())) {
        await expect(card.getByRole('button', { name: 'Install Claude Code' })).toBeVisible()
        await expect(card.getByRole('button', { name: 'Check again' })).toBeVisible()
      }
      await card.getByRole('button', { name: 'Agent settings' }).click()
      // The providers page of the settings center, not just any settings screen.
      await expect(page.getByTestId('providers-summary')).toBeVisible()
    } finally {
      await app.close()
    }
  })

  test(`${label}: the file tree is a keyboard-navigable ARIA tree`, async () => {
    test.setTimeout(120_000)
    guard()
    const dirs = scratch('tree')
    seed(dirs.workspace)
    const { app, page } = await boot(options, dirs.database)
    try {
      await page.getByTestId('btn-new-workspace').click()
      await page.getByTestId('wizard-dir-input').fill(dirs.workspace)
      await page.getByTestId('wizard-layout-card-1').click()
      await page.getByTestId('wizard-launch-btn').click()
      await page.waitForSelector('[data-testid="workspace-grid"], [data-testid="workspace-split-grid"]', { timeout: 30_000 })
      await page.getByTestId('btn-open-tools').click()
      await page.getByTestId('tools-modal').getByRole('menuitem', { name: /^Editor/ }).click()
      const panel = page.getByTestId('workspace-editor-panel')
      await expect(panel).toBeVisible()

      const tree = panel.getByRole('tree', { name: 'Files' })
      await expect(tree).toBeVisible()
      const src = tree.getByRole('treeitem', { name: 'src', exact: true })
      await expect(src).toHaveAttribute('aria-expanded', 'false')
      await expect(src).toHaveAttribute('aria-level', '1')
      // One tab stop for the whole tree, not one per file.
      await expect.poll(async () => tree.getByRole('treeitem').evaluateAll(rows => rows.filter(row => (row as HTMLElement).tabIndex === 0).length)).toBe(1)

      await src.focus()
      await page.keyboard.press('ArrowRight')
      await expect(src).toHaveAttribute('aria-expanded', 'true')
      await expect(tree.getByRole('treeitem', { name: 'app.ts' })).toBeVisible()
      await page.keyboard.press('ArrowRight')
      await expect.poll(() => page.evaluate(() => document.activeElement?.getAttribute('aria-level'))).toBe('2')
      await page.keyboard.press('ArrowLeft')
      await expect(src).toBeFocused()
      await page.keyboard.press('ArrowLeft')
      await expect(src).toHaveAttribute('aria-expanded', 'false')

      const readme = tree.getByRole('treeitem', { name: 'README.md' })
      await readme.focus()
      await page.keyboard.press('Enter')
      await expect(panel.getByRole('tab', { name: /README\.md/ })).toBeVisible({ timeout: 15_000 })
    } finally {
      await app.close()
    }
  })
}
