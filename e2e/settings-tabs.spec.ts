import { _electron as electron, test, type Page } from '@playwright/test'
import { mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * Captures every Agent Settings tab for design review.
 *
 * These tabs had no visual coverage at all, which is how six undefined CSS
 * tokens survived in the Diagnostics panel: `var(--border-subtle)` and friends
 * do not error, the whole declaration is just dropped, so the cards silently
 * rendered with no border, background or status colour. A screenshot would
 * have shown it immediately. Run with `npm run shots:settings`.
 */
const SHOTS_DIR = join(process.cwd(), 'e2e', 'screenshots')

async function shot(page: Page, name: string): Promise<void> {
  await page.waitForTimeout(250)
  await page.screenshot({ path: join(SHOTS_DIR, `${name}.png`), fullPage: false })
}

test('captures every Agent Settings tab', async () => {
  mkdirSync(SHOTS_DIR, { recursive: true })
  const testRoot = join(tmpdir(), `oxespace-settings-${Date.now()}`)
  mkdirSync(testRoot, { recursive: true })

  const app = await electron.launch({
    args: [join(process.cwd(), 'e2e', 'electron-main.cjs')],
    env: {
      ...process.env,
      OXESPACE_DISABLE_SINGLE_INSTANCE: '1',
      OXESPACE_E2E_MOCK_NATIVE: '1',
      OXESPACE_DB_PATH: join(testRoot, 'oxespace.sqlite3')
    }
  })

  try {
    const page = await app.firstWindow()
    await page.waitForLoadState('domcontentloaded')
    await page.getByTestId('btn-open-tools').click()
    await page.getByTestId('tools-agent-settings').click()
    await page.getByTestId('settings-modal').waitFor()

    const tabs = ['AI Providers', 'Terminal', 'Voice', 'Notifications', 'Updates', 'Diagnostics']
    for (const [index, label] of tabs.entries()) {
      await page.getByRole('button', { name: label, exact: true }).click()
      await shot(page, `settings-${index + 1}-${label.toLowerCase().replace(/\s+/g, '-')}`)
    }
  } finally {
    await app.close()
  }
})
