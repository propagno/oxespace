import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
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
/** The window as drawn. Playwright's page screenshot crops a zoomed page to its CSS size, so it cannot show 90% or 125%. */
async function capture(app: ElectronApplication, name: string): Promise<void> {
  const png = await app.evaluate(async ({ BrowserWindow }) => (await BrowserWindow.getAllWindows()[0].webContents.capturePage()).toPNG().toString('base64'))
  writeFileSync(test.info().outputPath(name), Buffer.from(png, 'base64'))
}

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

test('interface scale, density and motion apply app-wide and survive a restart', async () => {
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
    // Motion: Reduced makes transitions instant and slows the one spin; Full plays them even if the OS asks for less.
    const motion = settings.getByRole('radiogroup', { name: 'Motion' })
    // Milliseconds of a duration token (the build's minifier may write 200ms as .2s).
    const token = (name: string) => page.evaluate(n => {
      const value = getComputedStyle(document.documentElement).getPropertyValue(n).trim()
      return value.endsWith('ms') ? parseFloat(value) : parseFloat(value) * 1000
    }, name)
    await motion.getByRole('radio', { name: 'Reduced' }).click()
    await expect.poll(() => page.evaluate(() => document.documentElement.dataset.motion)).toBe('reduce')
    expect([await token('--duration-base'), await token('--duration-spin')]).toEqual([0, 2400])
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await motion.getByRole('radio', { name: 'Full' }).click()
    await expect.poll(() => page.evaluate(() => document.documentElement.dataset.motion)).toBe('full')
    expect([await token('--duration-base'), await token('--duration-spin')]).toEqual([200, 800])
    await motion.getByRole('radio', { name: 'System' }).click()
    await expect.poll(() => page.evaluate(() => document.documentElement.dataset.motion)).toBe('reduce')
    await page.emulateMedia({ reducedMotion: 'no-preference' })
    await expect.poll(() => page.evaluate(() => document.documentElement.dataset.motion)).toBe('full')
    await motion.evaluate(el => el.scrollIntoView({ block: 'center' }))
    await capture(app, 'appearance-125.png')

    // A workspace can keep its own density: it overrides the app until the person sends it back.
    const scope = settings.getByRole('group', { name: 'Settings scope' })
    await scope.getByRole('button', { name: /Current workspace/ }).click()
    const workspaceDensity = settings.getByRole('radiogroup', { name: 'Density' })
    await expect(workspaceDensity.getByRole('radio', { name: 'App default' })).toHaveAttribute('aria-checked', 'true')
    await workspaceDensity.getByRole('radio', { name: 'Compact' }).click()
    await workspaceDensity.evaluate(el => el.scrollIntoView({ block: 'center' }))
    await capture(app, 'workspace-density.png')
    await settings.getByRole('button', { name: 'Save workspace settings' }).click()
    await expect.poll(() => page.evaluate(() => document.documentElement.dataset.density)).toBe('compact')
    await scope.getByRole('button', { name: 'Application', exact: true }).click()
    await expect(settings.getByTestId('workspace-density-override')).toHaveText(/1 workspace uses its own density\./)
    await settings.getByTestId('workspace-density-override').evaluate(el => el.scrollIntoView({ block: 'center' }))
    await capture(app, 'appearance-workspace-override.png')
    await settings.getByRole('button', { name: 'Use app density in all workspaces' }).click()
    await expect.poll(() => page.evaluate(() => document.documentElement.dataset.density)).toBe('comfortable')
    await expect(settings.getByTestId('workspace-density-override')).toHaveCount(0)
    await settings.getByRole('button', { name: 'Back to work' }).click()
    await expect(settings).toHaveCount(0)
    await capture(app, 'code-125-comfortable.png')

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
