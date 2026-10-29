import { _electron as electron, expect, test } from '@playwright/test'
import { mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openConnections, runPaletteCommand } from './helpers/panels'

/**
 * Every overlay opens with focus inside it, keeps Tab inside, closes on Escape and
 * does not leave the app without a focused control.
 */
test('overlays take focus, trap Tab and close on Escape', async () => {
  test.setTimeout(180_000)
  const root = join(tmpdir(), `oxespace-overlay-${Date.now()}`)
  const workspace = join(root, 'demo-repo'); mkdirSync(workspace, { recursive: true })
  const app = await electron.launch({ args: [join(process.cwd(), 'e2e', 'electron-main.cjs')],
    env: { ...process.env, OXESPACE_DISABLE_SINGLE_INSTANCE: '1', OXESPACE_E2E_MOCK_NATIVE: '1', OXESPACE_DB_PATH: join(root, 'o.sqlite3') } })
  try {
    const page = await app.firstWindow()
    await page.waitForLoadState('domcontentloaded')
    await page.getByTestId('btn-new-workspace').click()
    await page.getByTestId('wizard-dir-input').fill(workspace)
    await page.getByTestId('wizard-launch-btn').click()
    await page.waitForSelector('[data-testid="workspace-grid"], [data-testid="workspace-split-grid"]', { timeout: 15000 })

    const insideOverlay = (): Promise<boolean> => page.evaluate(() => Boolean(document.activeElement?.closest('[role="dialog"], [aria-modal="true"]')))
    const exercise = async (name: string, open: () => Promise<void>, surface: string): Promise<void> => {
      await open()
      const overlay = page.locator(surface).first()
      await expect(overlay, `${name} opens`).toBeVisible()
      await expect.poll(insideOverlay, { message: `${name} moves focus inside` }).toBe(true)
      for (let index = 0; index < 8; index++) {
        await page.keyboard.press('Tab')
        expect(await insideOverlay(), `${name} keeps Tab inside (press ${index + 1})`).toBe(true)
      }
      await page.keyboard.press('Escape')
      await expect(overlay, `${name} closes on Escape`).toBeHidden()
    }
    await exercise('Command palette', () => page.keyboard.press('Control+k'), '[cmdk-root], [role="dialog"]:has([cmdk-input])')
    await exercise('MCP servers', () => openConnections(page), '[role="dialog"][aria-label*="MCP servers" i], [role="dialog"]:has-text("MCP servers")')
    await exercise('Skills', () => runPaletteCommand(page, 'Skills'), '[role="dialog"]:has-text("Skills")')
    await exercise('Semantic activity', () => runPaletteCommand(page, 'Semantic index log'), '[role="dialog"]:has-text("Semantic")')
    await exercise('Workspace settings', () => runPaletteCommand(page, 'Workspace settings'), '[role="dialog"]:has-text("Workspace")')
  } finally { await app.close() }
})
