import { _electron as electron, expect, test } from '@playwright/test'
import { createHash } from 'node:crypto'
import { createServer, type Server } from 'node:http'
import { mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { togglePanel } from './helpers/panels'

const PAGE = '<!doctype html><html><head><title>Guest page</title></head><body><h1 id="guest">A previewed page</h1><iframe id="inner" src="/frame" width="300" height="100"></iframe></body></html>'
const FRAME = '<!doctype html><html><head><title>Guest frame</title></head><body><p id="frame">An iframe inside the previewed page</p></body></html>'

function startServer(): Promise<{ server: Server; port: number; requests: string[] }> {
  const requests: string[] = []
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      requests.push(req.url ?? '')
      res.writeHead(200, { 'Content-Type': 'text/html' })
      res.end(req.url === '/frame' ? FRAME : PAGE)
    })
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      resolve({ server, port: typeof address === 'object' && address ? address.port : 0, requests })
    })
  })
}

/** The journal keeps 8 hex characters of the channel's SHA-256 as the subject (incident-sink.ts). */
const subjectOf = (channel: string): string => createHash('sha256').update(channel).digest('hex').slice(0, 8)

type ProbeOutcome = { ok: true; value: unknown } | { ok: false; message: string }
type Incident = { code: string; subject?: string; count: number }

const GRAB_PAYLOAD = {
  selector: '#guest-probe', tagName: 'h1', id: 'guest-probe', classNames: [], text: 'A previewed page', html: '<h1 id="guest-probe">',
  rect: { x: 8, y: 8, width: 200, height: 40 }, styles: [{ property: 'display', value: 'block' }], pageUrl: '', pageTitle: 'Guest page', devicePixelRatio: 1
}

/**
 * B12 · The sender guard against a REAL preview guest. The preview's `WebContentsView` loads a page served by the
 * test; under OXESPACE_E2E_GUEST_PROBE the design-guest preload exposes `window.__oxeGuestProbe` (a raw
 * `ipcRenderer.invoke` / `send`), which is what a compromised guest renderer has. From the guest's main frame the
 * privileged channels are refused with `ipc.sender.refused` and journaled; an iframe inside the guest has no route
 * at all; the Design Mode grab is accepted; the main window still reaches the handler; a `<webview>` cannot be
 * created at all.
 */
test('ipc sender guard: a real preview guest is refused, Design Mode still works, the main window is not refused', async () => {
  test.setTimeout(120_000)
  const { port, server, requests } = await startServer()
  const origin = `http://127.0.0.1:${port}`
  const testRoot = join(tmpdir(), `oxespace-ipc-guard-${Date.now()}`)
  const workspaceRoot = join(testRoot, 'repo')
  mkdirSync(workspaceRoot, { recursive: true })

  const electronApp = await electron.launch({
    args: [join(process.cwd(), 'e2e', 'electron-main.cjs')],
    env: {
      ...process.env,
      OXESPACE_DISABLE_SINGLE_INSTANCE: '1',
      OXESPACE_E2E_MOCK_NATIVE: '1',
      OXESPACE_E2E_GUEST_PROBE: '1',
      OXESPACE_DB_PATH: join(testRoot, 'oxespace.sqlite3')
    }
  })

  try {
    const page = await electronApp.firstWindow()
    // Every terminal:write that reaches a handler is counted. The override replaces the mock's handler after the app
    // registered it, through the same guarded ipcMain.
    await electronApp.evaluate(({ ipcMain }) => {
      const state = globalThis as typeof globalThis & { terminalWrites: Array<{ paneId: string; data: string }> }
      state.terminalWrites = []
      ipcMain.removeHandler('terminal:write')
      ipcMain.handle('terminal:write', (_event, input: { paneId: string; data: string }) => { state.terminalWrites.push(input) })
    })
    const terminalWrites = () => electronApp.evaluate(() => (globalThis as typeof globalThis & { terminalWrites: unknown[] }).terminalWrites)

    await page.getByTestId('btn-new-workspace').click()
    await page.getByTestId('wizard-dir-input').fill(workspaceRoot)
    await page.getByTestId('wizard-layout-card-1').click()
    await page.getByTestId('wizard-launch-btn').click()
    await expect(page.locator('[data-testid="workspace-grid"], [data-testid="workspace-split-grid"]').first()).toBeVisible()

    await togglePanel(page, 'Browser')
    const address = page.locator('.web-preview-address-input')
    await expect(address).toBeVisible()
    await address.fill(origin)
    await address.press('Enter')
    await expect(page.getByTestId('browser-preview-native')).toBeVisible()

    // The guest, the probe in its main frame, and the iframe inside it. `frames` and the probe come up once the page
    // is parsed.
    const guestState = () => electronApp.evaluate(async ({ BrowserWindow, webContents }, url) => {
      const guest = webContents.getAllWebContents().find(contents => contents.getURL().startsWith(url))
      if (!guest) return null
      const frame = guest.mainFrame.frames[0]
      return {
        id: guest.id,
        windowIds: BrowserWindow.getAllWindows().map(window => window.webContents.id),
        probe: await guest.mainFrame.executeJavaScript('typeof window.__oxeGuestProbe') as string,
        frame: frame ? await frame.executeJavaScript('JSON.stringify({ probe: typeof window.__oxeGuestProbe, node: typeof require, marker: !!document.getElementById("frame") })') as string : 'no frame'
      }
    }, origin)
    await expect.poll(async () => { const state = await guestState(); return state ? `${state.probe}/${state.frame}` : 'no guest' }, { timeout: 30_000 })
      .toBe('object/{"probe":"undefined","node":"undefined","marker":true}')
    const guest = (await guestState())!
    // A WebContentsView guest reports getType() === 'window' too: identity, not type, says it is not the app window.
    expect(guest.windowIds).toHaveLength(1)
    expect(guest.windowIds).not.toContain(guest.id)
    // The iframe inside the guest (a real subframe, the test's own /frame page) got no preload, so it has no
    // ipcRenderer and no probe: there is no route from a subframe to ipcMain at all. The guard's own subframe check
    // is the second line, proven on tests/unit/ipc-sender-guard.test.ts.

    const probe = (kind: 'invoke' | 'send', channel: string, payload: unknown): Promise<ProbeOutcome> =>
      electronApp.evaluate(async ({ webContents }, request) => {
        const contents = webContents.getAllWebContents().find(item => item.getURL().startsWith(request.url))!
        const code = request.kind === 'invoke'
          ? `window.__oxeGuestProbe.invoke(${JSON.stringify(request.channel)}, ${JSON.stringify(request.payload)})`
          : `(window.__oxeGuestProbe.send(${JSON.stringify(request.channel)}, ${JSON.stringify(request.payload)}), { ok: true, value: null })`
        return await contents.mainFrame.executeJavaScript(code) as ProbeOutcome
      }, { url: origin, kind, channel, payload })

    // 1. Privileged channels from the guest's main frame: refused with the C3 code, before any handler runs.
    const refused: Array<[string, unknown]> = [
      ['terminal:write', { paneId: 'pane-1', data: 'echo pwned\r' }],
      ['fs:write-file', { workspaceId: 'ws', rootPath: workspaceRoot, relativePath: 'pwned.txt', content: 'x' }],
      ['mcp:create', { name: 'evil', transport: 'stdio', config: { command: 'calc.exe' } }],
      // The E2E mock registers approvals:respond on main today; #238's real handler registers on the same ipcMain.
      ['approvals:respond', { id: 'r-1', generation: 1, optionId: 'allow-once' }]
    ]
    for (const [channel, payload] of refused) {
      const outcome = await probe('invoke', channel, payload)
      expect(outcome.ok, channel).toBe(false)
      expect(outcome.ok ? '' : outcome.message, channel).toContain('ipc.sender.refused')
    }
    expect(await terminalWrites()).toEqual([])

    // 2. A flood on one channel: the journal groups it, one entry with a count, not one entry per call.
    for (let index = 0; index < 25; index++) await probe('invoke', 'terminal:write', { paneId: 'pane-1', data: 'x' })
    const incidents = await page.evaluate(() => (window as unknown as { oxe: { diagnostics: { incidents(input: object): Promise<Incident[]> } } }).oxe.diagnostics.incidents({}))
    const refusals = incidents.filter(incident => incident.code === 'incident.ipc.senderRefused')
    for (const [channel] of refused) expect(refusals.map(incident => incident.subject), channel).toContain(subjectOf(channel))
    const writes = refusals.filter(incident => incident.subject === subjectOf('terminal:write'))
    expect(writes).toHaveLength(1)
    expect(writes[0].count).toBeGreaterThanOrEqual(26) // the first call + the flood
    expect(refusals.map(incident => incident.subject)).not.toContain(subjectOf('oxe:design-grab'))

    // 3. The Design Mode exception: the guest's grab reaches the window and opens the sheet.
    await probe('send', 'oxe:design-grab', { ...GRAB_PAYLOAD, pageUrl: origin })
    const sheet = page.getByTestId('design-grab-sheet')
    await expect(sheet).toBeVisible({ timeout: 15_000 })
    await expect(sheet.getByText('#guest-probe')).toBeVisible()

    // 4. The main window's own call goes through, to the same handler the guest could not reach.
    await page.evaluate(() => (window as unknown as { oxe: { terminal: { write(input: { paneId: string; data: string }): Promise<void> } } })
      .oxe.terminal.write({ paneId: 'pane-1', data: 'ls\r' }))
    expect(await terminalWrites()).toEqual([{ paneId: 'pane-1', data: 'ls\r' }])

    // 5. webviewTag is off: a <webview> in the main window is an inert element. It has none of the webview API, its
    // src is never requested, and no guest webContents is created. (Chromium does not report it as
    // HTMLUnknownElement either way, so the element's class proves nothing; these three do.)
    const webviewProbe = await page.evaluate(async (src) => {
      const element = document.createElement('webview') as HTMLElement & { getWebContentsId?: unknown; loadURL?: unknown }
      element.setAttribute('src', src)
      document.body.appendChild(element)
      await new Promise(resolve => setTimeout(resolve, 1_500))
      return { getWebContentsId: typeof element.getWebContentsId, loadURL: typeof element.loadURL }
    }, `${origin}/webview-probe`)
    expect(webviewProbe).toEqual({ getWebContentsId: 'undefined', loadURL: 'undefined' })
    expect(requests).not.toContain('/webview-probe')
    expect(await electronApp.evaluate(({ webContents }) => webContents.getAllWebContents().filter(contents => contents.getURL().includes('/webview-probe')).length)).toBe(0)
  } finally {
    await electronApp.close()
    server.close()
  }
})
