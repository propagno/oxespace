import { _electron as electron, expect, test } from '@playwright/test'
import { createServer, type Server } from 'node:http'
import { mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const PAGE = `<!doctype html><html><head><title>Design target</title><style>
  body { margin: 0; font-family: system-ui; background: #101418; color: #e6edf3; }
  #hero { padding: 60px; background: #16803c; }
  #cta { display: inline-block; padding: 14px 28px; border-radius: 8px; background: #22d3a5; color: #06231c; font-weight: 700; }
</style></head><body>
  <section id="hero"><div id="cta">Buy now</div></section>
</body></html>`

function startServer(): Promise<{ server: Server; port: number }> {
  return new Promise((resolve) => {
    const server = createServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/html' })
      res.end(PAGE)
    })
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      resolve({ server, port: typeof address === 'object' && address ? address.port : 0 })
    })
  })
}

/**
 * #3 · Design Mode end to end: the preview loads a real page in a <webview>,
 * the picker highlights an element, and clicking it opens the confirmation
 * sheet with the grabbed selector.
 */
test('design mode: picking an element opens the grab sheet', async () => {
  test.setTimeout(90_000)
  const { port, server } = await startServer()
  const testRoot = join(tmpdir(), `oxespace-design-${Date.now()}`)
  const workspaceRoot = join(testRoot, 'repo')
  mkdirSync(workspaceRoot, { recursive: true })

  const electronApp = await electron.launch({
    args: [join(process.cwd(), 'e2e', 'electron-main.cjs')],
    env: {
      ...process.env,
      OXESPACE_DISABLE_SINGLE_INSTANCE: '1',
      OXESPACE_E2E_MOCK_NATIVE: '1',
      OXESPACE_DB_PATH: join(testRoot, 'oxespace.sqlite3')
    }
  })

  try {
    const page = await electronApp.firstWindow()
    await page.getByTestId('btn-new-workspace').click()
    await page.getByTestId('wizard-dir-input').fill(workspaceRoot)
    await page.getByTestId('wizard-layout-card-1').click()
    await page.getByTestId('wizard-launch-btn').click()
    await expect(
      page.locator('[data-testid="workspace-grid"], [data-testid="workspace-split-grid"]').first()
    ).toBeVisible()

    // Web Preview lives in the Tools hub, not the palette.
    await page.getByTestId('btn-open-tools').click()
    await page.getByText('Web Preview', { exact: true }).click()

    const address = page.locator('.web-preview-address-input')
    await expect(address).toBeVisible()
    await address.fill(`http://127.0.0.1:${port}`)
    await address.press('Enter')

    const webview = page.getByTestId('web-preview-webview')
    await expect(webview).toBeVisible()
    // Wait for the guest to actually paint before picking inside it.
    await expect
      .poll(
        async () =>
          electronApp.evaluate(({ webContents }) =>
            webContents.getAllWebContents().some((contents) => contents.getURL().startsWith('http://127.0.0.1'))
          ),
        { timeout: 20_000 }
      )
      .toBe(true)

    await page.getByTestId('design-mode-toggle').click()
    await expect(page.getByText('Design Mode — click an element', { exact: false })).toBeVisible()

    // Click the CTA inside the guest. Playwright's mouse targets the host
    // WebContents; a <webview> guest is a separate one, so drive real Chromium
    // input events at the guest instead of faking a DOM click.
    const clicked = await electronApp.evaluate(async ({ webContents }) => {
      const guest = webContents.getAllWebContents().find((c) => c.getURL().startsWith('http://127.0.0.1'))
      if (!guest) return false
      const raw = (await guest.executeJavaScript(
        'JSON.stringify((() => { const r = document.getElementById("cta").getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 } })())'
      )) as string
      const point = JSON.parse(raw) as { x: number; y: number }
      const x = Math.round(point.x)
      const y = Math.round(point.y)
      guest.sendInputEvent({ type: 'mouseMove', x, y })
      guest.sendInputEvent({ type: 'mouseDown', x, y, button: 'left', clickCount: 1 })
      guest.sendInputEvent({ type: 'mouseUp', x, y, button: 'left', clickCount: 1 })
      return true
    })
    expect(clicked).toBe(true)

    const sheet = page.getByTestId('design-grab-sheet')
    await expect(sheet).toBeVisible({ timeout: 15_000 })
    await expect(sheet.getByText('#cta')).toBeVisible()
  } finally {
    await electronApp.close()
    server.close()
  }
})
