import { _electron as electron, expect, test } from '@playwright/test'
import { createServer, type Server } from 'node:http'
import { mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { togglePanel } from './helpers/panels'

const PAGE = '<!doctype html><html><head><title>Guest page</title></head><body><h1 id="guest">A previewed page</h1></body></html>'

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
 * What a compromised guest has: `ipcRenderer` itself. The design-guest preload keeps it in its isolated world and
 * exposes nothing to the page, so the test gives the real guest the same power the way Electron allows it, with a
 * session preload in the preview's own partition. It runs inside the guest renderer (its own webContents, its main
 * frame) and hands the page a raw `invoke`. Nothing in the app is changed for the test.
 */
const ATTACKER_PRELOAD = `
const { contextBridge, ipcRenderer } = require('electron')
contextBridge.exposeInMainWorld('__attacker', {
  invoke: (channel, ...args) => ipcRenderer.invoke(channel, ...args).then(
    value => ({ ok: true, value: value === undefined ? null : value }),
    error => ({ ok: false, message: String(error && error.message) })
  )
})
`

type InvokeOutcome = { ok: true; value: unknown } | { ok: false; message: string }

/**
 * B12 · A real preview guest (a WebContentsView loading a local page) calling privileged channels straight through
 * `ipcRenderer.invoke` is refused with `ipc.sender.refused`, and the handler never runs; the main window keeps
 * calling the same channel.
 */
test('ipc sender guard: a real preview guest is refused, the main window is not', async () => {
  test.setTimeout(90_000)
  const { port, server } = await startServer()
  const testRoot = join(tmpdir(), `oxespace-ipc-guard-${Date.now()}`)
  const workspaceRoot = join(testRoot, 'repo')
  mkdirSync(workspaceRoot, { recursive: true })
  const attackerPreload = join(testRoot, 'attacker-preload.cjs')
  writeFileSync(attackerPreload, ATTACKER_PRELOAD)

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
    // Every terminal:write that reaches a handler is counted. This override registers through the same guarded
    // ipcMain as the app's own handlers.
    await electronApp.evaluate(({ ipcMain }) => {
      const state = globalThis as typeof globalThis & { terminalWrites: Array<{ paneId: string; data: string }> }
      state.terminalWrites = []
      ipcMain.removeHandler('terminal:write')
      ipcMain.handle('terminal:write', (_event, input: { paneId: string; data: string }) => { state.terminalWrites.push(input) })
    })

    const page = await electronApp.firstWindow()
    await page.getByTestId('btn-new-workspace').click()
    await page.getByTestId('wizard-dir-input').fill(workspaceRoot)
    await page.getByTestId('wizard-layout-card-1').click()
    await page.getByTestId('wizard-launch-btn').click()
    await expect(page.locator('[data-testid="workspace-grid"], [data-testid="workspace-split-grid"]').first()).toBeVisible()

    await togglePanel(page, 'Browser')
    const address = page.locator('.web-preview-address-input')
    await expect(address).toBeVisible()
    await address.fill(`http://127.0.0.1:${port}`)
    await address.press('Enter')
    await expect(page.getByTestId('browser-preview-native')).toBeVisible()
    const origin = `http://127.0.0.1:${port}`
    await expect.poll(() => electronApp.evaluate(({ webContents }, url) =>
      webContents.getAllWebContents().some(contents => contents.getURL().startsWith(url)), origin), { timeout: 20_000 }).toBe(true)

    // Arm the real guest: a session preload in its own partition, then a reload so it runs.
    const guestType = await electronApp.evaluate(({ webContents }, { url, preload }) => {
      const guest = webContents.getAllWebContents().find(contents => contents.getURL().startsWith(url))!
      guest.session.registerPreloadScript({ type: 'frame', filePath: preload, id: 'b12-attacker' })
      guest.reload()
      return guest.getType()
    }, { url: origin, preload: attackerPreload })
    expect(guestType).not.toBe('window') // a guest, not an app window
    await expect.poll(() => electronApp.evaluate(({ webContents }, url) => {
      const guest = webContents.getAllWebContents().find(contents => contents.getURL().startsWith(url))
      return guest ? guest.executeJavaScript('typeof window.__attacker') : 'missing'
    }, origin), { timeout: 20_000 }).toBe('object')

    const fromGuest = (channel: string, input: unknown): Promise<InvokeOutcome> => electronApp.evaluate(async ({ webContents }, request) => {
      const guest = webContents.getAllWebContents().find(contents => contents.getURL().startsWith(request.url))!
      return await guest.executeJavaScript(`window.__attacker.invoke(${JSON.stringify(request.channel)}, ${JSON.stringify(request.input)})`) as InvokeOutcome
    }, { url: origin, channel, input })

    const attempts: Array<[string, unknown]> = [
      ['terminal:write', { paneId: 'pane-1', data: 'echo pwned\r' }],
      ['fs:write-file', { workspaceId: 'ws', rootPath: workspaceRoot, relativePath: 'pwned.txt', content: 'x' }],
      ['mcp:create', { name: 'evil', transport: 'stdio', config: { command: 'calc.exe' } }],
      ['approvals:respond', { id: 'r-1', generation: 1, optionId: 'allow-once' }]
    ]
    for (const [channel, input] of attempts) {
      const outcome = await fromGuest(channel, input)
      expect(outcome.ok, channel).toBe(false)
      expect(outcome.ok ? '' : outcome.message, channel).toContain('ipc.sender.refused')
    }
    expect(await electronApp.evaluate(() => (globalThis as typeof globalThis & { terminalWrites: unknown[] }).terminalWrites)).toEqual([])

    // The main window's own call goes through, to the same handler.
    await page.evaluate(() => (window as unknown as { oxe: { terminal: { write(input: { paneId: string; data: string }): Promise<void> } } })
      .oxe.terminal.write({ paneId: 'pane-1', data: 'ls\r' }))
    expect(await electronApp.evaluate(() => (globalThis as typeof globalThis & { terminalWrites: unknown[] }).terminalWrites))
      .toEqual([{ paneId: 'pane-1', data: 'ls\r' }])
  } finally {
    await electronApp.close()
    server.close()
  }
})
