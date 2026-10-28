import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { resizeWindow } from './helpers/launch'

/**
 * Settings › Appearance: the interface scale zooms the whole window (the terminal
 * refits to the new cell size and stays inside its card), it is saved and comes
 * back at the next start, and the app-wide density reaches the root tokens.
 */
const launch = (dbPath: string) => electron.launch({
  args: [join(process.cwd(), 'e2e', 'electron-main.cjs')],
  env: { ...process.env, OXESPACE_DISABLE_SINGLE_INSTANCE: '1', OXESPACE_E2E_MOCK_NATIVE: '1', OXESPACE_DB_PATH: dbPath }
})
const close = (app: ElectronApplication) => Promise.race([app.close().catch(() => undefined), new Promise(resolve => setTimeout(resolve, 4000))])
const zoomFactor = (app: ElectronApplication) => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.getZoomFactor())

/** How the xterm screen sits in its card: it must not clip, and fit leaves less than a cell or two unused. */
function terminalFit(page: Page) {
  return page.evaluate(() => {
    const view = document.querySelector('.terminal-view') as HTMLElement
    const screen = view.querySelector('.xterm-screen') as HTMLElement
    const style = getComputedStyle(view)
    const box = view.getBoundingClientRect()
    const right = box.right - parseFloat(style.borderRightWidth) - parseFloat(style.paddingRight)
    const left = box.left + parseFloat(style.borderLeftWidth) + parseFloat(style.paddingLeft)
    const text = screen.getBoundingClientRect()
    return { overflow: Math.round(text.right - right), unused: Math.round(right - text.right), contentWidth: right - left, screenWidth: text.width }
  })
}

test('interface scale and density apply app-wide and survive a restart', async () => {
  test.setTimeout(120000)
  const root = join(tmpdir(), `oxe-scale-${Date.now()}`)
  const repo = join(root, 'repo')
  mkdirSync(repo, { recursive: true })
  const dbPath = join(root, 'db.sqlite3')

  let app = await launch(dbPath)
  try {
    const page = await app.firstWindow()
    await resizeWindow(app, 1600, 1100)
    await page.getByTestId('btn-new-workspace').click()
    await page.getByTestId('wizard-dir-input').fill(repo)
    await page.getByTestId('wizard-layout-card-1').click()
    await page.getByTestId('wizard-launch-btn').click()
    await page.getByTestId('terminal-view').first().waitFor({ state: 'visible' })
    await page.waitForTimeout(1200)
    const before = await terminalFit(page)
    expect(before.overflow).toBeLessThanOrEqual(1)
    expect(await page.evaluate(() => document.documentElement.dataset.density)).toBe('compact')

    await page.getByRole('button', { name: 'Open settings', exact: true }).click()
    const settings = page.getByRole('dialog', { name: 'Settings', exact: true })
    await settings.getByRole('group', { name: 'Settings scope' }).getByRole('button', { name: 'Application', exact: true }).click()
    await settings.getByRole('radio', { name: '125%', exact: true }).click()
    await expect.poll(() => zoomFactor(app)).toBe(1.25)
    await expect(settings.getByText('Currently 125%.', { exact: false })).toBeVisible()

    await settings.getByRole('radiogroup', { name: 'Density' }).getByRole('radio', { name: 'Comfortable' }).click()
    // The new workspace follows the app ('default'), so the root takes the comfortable control heights.
    await expect.poll(() => page.evaluate(() => document.documentElement.dataset.density)).toBe('comfortable')
    expect(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--control-md').trim())).toBe('32px')
    await settings.screenshot({ path: test.info().outputPath('appearance-125.png') })
    const groups = settings.locator('section[aria-labelledby="appearance-scale-title"]').locator('..')
    await groups.screenshot({ path: test.info().outputPath('appearance-125-groups.png') })

    // A workspace can keep its own density: it overrides the app until the person sends it back.
    const scope = settings.getByRole('group', { name: 'Settings scope' })
    await scope.getByRole('button', { name: /Current workspace/ }).click()
    const workspaceDensity = settings.getByRole('radiogroup', { name: 'Density' })
    await expect(workspaceDensity.getByRole('radio', { name: 'App default' })).toHaveAttribute('aria-checked', 'true')
    await workspaceDensity.getByRole('radio', { name: 'Compact' }).click()
    await workspaceDensity.locator('..').screenshot({ path: test.info().outputPath('workspace-density.png') })
    await settings.getByRole('button', { name: 'Save workspace settings' }).click()
    await expect.poll(() => page.evaluate(() => document.documentElement.dataset.density)).toBe('compact')
    await scope.getByRole('button', { name: 'Application', exact: true }).click()
    await expect(settings.getByTestId('workspace-density-override')).toHaveText(/1 workspace uses its own density\./)
    await groups.screenshot({ path: test.info().outputPath('appearance-workspace-override.png') })
    await settings.getByRole('button', { name: 'Use app density in all workspaces' }).click()
    await expect.poll(() => page.evaluate(() => document.documentElement.dataset.density)).toBe('comfortable')
    await expect(settings.getByTestId('workspace-density-override')).toHaveCount(0)
    await page.keyboard.press('Escape')
    await page.screenshot({ path: test.info().outputPath('code-125-comfortable.png') })

    // The terminal follows the zoom: same card, bigger cells, refit without clipping.
    await page.waitForTimeout(800)
    const after = await terminalFit(page)
    expect(after.overflow).toBeLessThanOrEqual(1)
    expect(after.contentWidth).toBeLessThan(before.contentWidth)
    expect(after.unused).toBeLessThan(40)
    expect(JSON.parse(readFileSync(join(root, 'user-data', 'ui-scale.json'), 'utf8'))).toEqual({ factor: 1.25 })
  } finally {
    await close(app)
  }

  // The next start opens at the saved scale and density, without a 100% first frame.
  expect(existsSync(join(root, 'user-data', 'ui-scale.json'))).toBe(true)
  app = await launch(dbPath)
  try {
    const page = await app.firstWindow()
    expect(await zoomFactor(app)).toBe(1.25)
    await expect.poll(() => page.evaluate(() => document.documentElement.dataset.density)).toBe('comfortable')
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('oxe-settings') ?? '{}').state)).toMatchObject({ uiScale: 1.25, density: 'comfortable' })
  } finally {
    await close(app)
  }
})
