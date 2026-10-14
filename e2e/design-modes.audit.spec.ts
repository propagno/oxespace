import { _electron as electron, test, type Page } from '@playwright/test'
import { mkdirSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * Redesign check — captures the main surfaces in light and dark mode so each
 * migration step can be compared by eye. Not part of CI.
 * Output: e2e/screenshots/design-modes/<mode>-<surface>.png
 * Run: npx playwright test --config playwright.tools.config.ts design-modes.audit.spec.ts
 */
const OUT = join(process.cwd(), 'e2e', 'screenshots', 'design-modes')

async function setMode(page: Page, mode: 'light' | 'dark'): Promise<void> {
  await page.evaluate(value => {
    document.documentElement.dataset.mode = value
  }, mode)
  await page.waitForTimeout(150)
}

test('captures the main surfaces in light and dark mode', async () => {
  test.setTimeout(180_000)
  mkdirSync(OUT, { recursive: true })
  const root = mkdtempSync(join(tmpdir(), 'oxespace-design-modes-'))
  const app = await electron.launch({ args: [join(process.cwd(), 'e2e/electron-main.cjs')], env: {
    ...process.env, OXESPACE_DISABLE_SINGLE_INSTANCE: '1', OXESPACE_E2E_MOCK_NATIVE: '1', OXESPACE_DB_PATH: join(root, 'app.sqlite3')
  } })
  try {
    const page = await app.firstWindow()
    await page.waitForLoadState('domcontentloaded')
    await app.evaluate(({ BrowserWindow }) => { const win = BrowserWindow.getAllWindows()[0]; win.setSize(1280, 820); win.center() })
    await page.waitForTimeout(1500)
    for (const mode of ['light', 'dark'] as const) {
      await setMode(page, mode)
      await page.screenshot({ path: join(OUT, `${mode}-home.png`) })
      await page.keyboard.press('Control+,')
      await page.waitForTimeout(400)
      const appearance = page.getByRole('button', { name: 'Appearance' })
      if (await appearance.count()) { await appearance.first().click(); await page.waitForTimeout(200) }
      await page.screenshot({ path: join(OUT, `${mode}-settings.png`) })
      await page.keyboard.press('Escape')
      await page.waitForTimeout(200)
    }
    // The design-system viewer renders both modes side by side.
    await setMode(page, 'light')
    await page.keyboard.press('Control+k')
    await page.keyboard.type('Design System')
    await page.keyboard.press('Enter')
    await page.waitForTimeout(500)
    for (const section of ['Components', 'Color', 'Brand']) {
      const button = page.getByRole('button', { name: section, exact: true })
      if (!(await button.count())) continue
      await button.click()
      await page.waitForTimeout(250)
      await page.screenshot({ path: join(OUT, `design-system-${section.toLowerCase()}.png`) })
    }
  } finally { await app.close() }
})
