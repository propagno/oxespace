import { test, type Page } from '@playwright/test'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { launchApp, openDemoWorkspace, resizeWindow } from '../helpers/launch'

/**
 * Pre-homologation of #178 (useConnectivity, OfflineState and the real About): About in pt-BR/dark and en/light,
 * what "Copy details" puts on the clipboard, the offline indicator and coming back online, and OxePost telling a
 * network failure apart from a server that does not exist. Not part of CI.
 */
const OUT = join(process.cwd(), 'e2e', 'screenshots', 'homologation', 'pre-178')
mkdirSync(OUT, { recursive: true })
const notes: Record<string, unknown> = {}
test.afterAll(() => writeFileSync(join(OUT, 'notes.json'), JSON.stringify(notes, null, 2)))
const shot = (page: Page, name: string) => page.screenshot({ path: join(OUT, `${name}.png`) })

let server: Server
let base = ''
test.beforeAll(async () => {
  server = createServer((_req, res) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"ok":true}') })
  await new Promise<void>(done => server.listen(0, '127.0.0.1', done))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})
test.afterAll(() => { server?.closeAllConnections(); server?.close() })

for (const [locale, appearance] of [['pt-BR', 'dark'], ['en-US', 'light']] as const) {
  test(`About, from the palette: ${locale}`, async () => {
    test.setTimeout(90_000)
    const { app, page, consoleErrors } = await launchApp({ locale, appearance })
    try {
      await resizeWindow(app, 1280, 860)
      await page.keyboard.press('Control+k')
      await page.keyboard.insertText(locale === 'pt-BR' ? 'Sobre' : 'About')
      notes[`${locale}-paletteEntries`] = await page.locator('[cmdk-item]').allInnerTexts()
      await page.locator('[cmdk-item]').first().click()
      const about = page.getByRole('dialog').last()
      await about.waitFor()
      notes[`${locale}-about`] = { name: await about.getAttribute('aria-label'), text: (await about.innerText()).slice(0, 900), links: await about.getByRole('link').evaluateAll(as => as.map(a => `${a.textContent?.trim()} -> ${a.getAttribute('href')}`)), buttons: await about.getByRole('button').allInnerTexts() }
      await shot(page, `${locale}-about`)
      await about.getByRole('button', { name: /^(Copy details|Copiar detalhes)$/ }).click()
      await page.waitForTimeout(400)
      notes[`${locale}-copied`] = await app.evaluate(({ clipboard }) => clipboard.readText())
      notes[`${locale}-errors`] = consoleErrors
    } finally { await app.close() }
  })
}

test('offline indicator and OxePost: network failure vs a host that does not exist (pt-BR)', async () => {
  test.setTimeout(150_000)
  process.env.OXESPACE_E2E_OFFLINE = '1'
  const { app, page, workspaceRoot, consoleErrors } = await launchApp({ locale: 'pt-BR', appearance: 'light' })
  delete process.env.OXESPACE_E2E_OFFLINE
  try {
    await resizeWindow(app, 1280, 860)
    await openDemoWorkspace(page, workspaceRoot)
    await page.waitForTimeout(800)
    notes.offlineStatusBar = await page.getByText(/sem conexão/i).allInnerTexts()
    await shot(page, 'offline-code')
    await page.keyboard.press('Control+2')
    await page.waitForTimeout(800)
    notes.offlineInChat = await page.getByText(/sem conexão/i).count()
    await shot(page, 'offline-chat')
    // OxePost while the app believes it is offline: a request to a local server that answers.
    await page.keyboard.press('Control+5')
    await page.waitForTimeout(1_200)
    const url = page.getByRole('textbox', { name: /url/i }).first()
    await url.fill(`${base}/ping`)
    await page.keyboard.press('Control+Enter')
    await page.waitForTimeout(1_500)
    notes.postLocalWhileOffline = (await page.getByRole('region', { name: /Resposta|Response/ }).innerText().catch(() => 'no region')).slice(0, 200)
    await shot(page, 'post-local-while-offline')
    // A host that does not exist.
    await url.fill('http://nao-existe.invalid/ping')
    await page.keyboard.press('Control+Enter')
    await page.waitForTimeout(3_000)
    notes.postInvalidHostWhileOffline = (await page.getByRole('region', { name: /Resposta|Response/ }).innerText().catch(() => 'no region')).slice(0, 300)
    await shot(page, 'post-invalid-host-while-offline')
    // Back online.
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.send('app:connectivity-changed', { state: 'online', checkedAt: Date.now() }))
    await page.waitForTimeout(800)
    await page.keyboard.press('Control+Enter')
    await page.waitForTimeout(3_000)
    notes.postInvalidHostOnline = (await page.getByRole('region', { name: /Resposta|Response/ }).innerText().catch(() => 'no region')).slice(0, 300)
    await shot(page, 'post-invalid-host-online')
    await page.keyboard.press('Control+1')
    await page.waitForTimeout(500)
    notes.offlineAfterOnline = await page.getByText(/sem conexão/i).count()
    notes.offlineErrors = consoleErrors
  } finally { await app.close() }
})
