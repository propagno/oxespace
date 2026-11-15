// TEMPORARY debug copy of pm-02-10 (never committed): does Ctrl+Shift+U toast once the app shell is mounted?
import { test } from '@playwright/test'
import { launchApp, resizeWindow } from '../helpers/launch'

test('debug: the toasts after Ctrl+Shift+U, app ready first', async () => {
  test.setTimeout(180_000)
  const { app, page } = await launchApp({ appearance: 'light', locale: 'pt-BR', env: { OXESPACE_E2E_MOCK_NATIVE: '0' } })
  const avisos = async (): Promise<string> => page.evaluate(() => { const el = document.querySelector('section[aria-label="Avisos"]'); return el ? `children=${el.children.length} buttons=${[...el.querySelectorAll('button')].map(b => `"${b.getAttribute('aria-label') ?? b.textContent?.trim()}"`).join(',')}` : 'no region' })
  try {
    await resizeWindow(app, 1440, 900)
    const t0 = Date.now()
    await page.locator('button[data-app-mode]').first().waitFor({ timeout: 30_000 })
    console.log(`[DEBUG] shell ready after ${Date.now() - t0} ms`)
    await page.keyboard.press('Control+Shift+U')
    await page.waitForTimeout(500)
    console.log(`[DEBUG] after press (ready): ${await avisos()}`)
  } finally {
    await app.close()
  }
})
