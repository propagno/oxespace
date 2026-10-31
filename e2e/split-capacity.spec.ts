import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { mkdirSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { resizeWindow } from './helpers/launch'

/**
 * The user's report (31/10): splitting past a 2×2 layout left panes ~90 px wide and closing them failed. This runs main
 * for real on a database of its own: a 2×2 workspace, each pane split once (8 panes, each still usable), a further
 * split refused with the reason instead of squeezing, and then every pane closed, one by one, until none is left.
 */
const launchReal = (dbPath: string) => electron.launch({
  args: [join(process.cwd(), 'e2e', 'electron-main.cjs')],
  env: { ...process.env, OXESPACE_DISABLE_SINGLE_INSTANCE: '1', OXESPACE_E2E_MOCK_NATIVE: '0', OXESPACE_DB_PATH: dbPath }
})
const panes = (page: Page) => page.locator('[data-testid="pane-container"]')
const paneIds = (page: Page): Promise<string[]> => panes(page).evaluateAll(nodes => nodes.map(node => node.getAttribute('data-pane-id') ?? ''))
async function paneMenu(page: Page, paneId: string, item: string): Promise<void> {
  await page.locator(`[data-testid="pane-container"][data-pane-id="${paneId}"]`).getByRole('button', { name: 'More pane actions' }).click()
  await page.getByRole('menuitem', { name: item }).click()
}

test('splitting past a 2×2 layout keeps panes usable, refuses what does not fit, and every pane closes', async () => {
  test.setTimeout(180_000)
  const root = mkdtempSync(join(tmpdir(), 'oxe-split-'))
  const repo = join(root, 'repo')
  mkdirSync(repo, { recursive: true })
  let app: ElectronApplication | undefined
  try {
    app = await launchReal(join(root, 'db.sqlite3'))
    const page = await app.firstWindow()
    await resizeWindow(app, 1440, 900)
    await page.getByTestId('btn-new-workspace').click()
    await page.getByTestId('wizard-dir-input').fill(repo)
    await page.getByTestId('wizard-layout-card-4').click()
    await page.getByTestId('wizard-launch-btn').click()
    await expect(panes(page)).toHaveCount(4)

    // Each of the four split once beside itself: eight panes, none narrower than the minimum.
    for (const paneId of await paneIds(page)) {
      const before = await panes(page).count()
      await paneMenu(page, paneId, 'Split pane right')
      await expect(panes(page)).toHaveCount(before + 1)
    }
    const widths = await panes(page).evaluateAll(nodes => nodes.map(node => Math.round(node.getBoundingClientRect().width)))
    expect(widths).toHaveLength(8)
    for (const width of widths) expect(width).toBeGreaterThanOrEqual(240)

    // Splitting one of those again would leave halves under 240 px: refused, said, and nothing is added.
    await paneMenu(page, (await paneIds(page))[0], 'Split pane right')
    await expect(page.getByText('Each half would be narrower than 240 px.', { exact: false })).toBeVisible()
    await expect(panes(page)).toHaveCount(8)
    await page.waitForTimeout(300)
    await page.screenshot({ path: test.info().outputPath('eight-panes.png') })

    // Every pane closes, the last one included.
    for (let left = 8; left > 0; left--) {
      await paneMenu(page, (await paneIds(page))[0], 'Close pane')
      const confirm = page.getByRole('alertdialog')
      if (await confirm.isVisible().catch(() => false)) await confirm.getByRole('button', { name: /^Close/ }).click()
      await expect(panes(page)).toHaveCount(left - 1)
    }
  } finally {
    if (app) await Promise.race([app.close().catch(() => undefined), new Promise(resolve => setTimeout(resolve, 4000))])
  }
})
