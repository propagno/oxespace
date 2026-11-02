import { _electron as electron, expect, test } from '@playwright/test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * B12 (S1) · Every IPC channel checks who sends it (maturity BE-M-01).
 * Roadmap acceptance: a fake sender (a guest's webContents, a subframe) is refused on terminal.write, fs.writeFile and
 * mcp.create with a C3 code; the channels on the exception list keep working.
 *
 * Black box from main: each handler registered with ipcMain.handle is called with an event whose sender is a second,
 * hidden window that is not the app (as a compromised web preview or design guest would be), and with the app's own
 * window but a subframe. Nothing is written: the inputs are harmless, and a refused handler never reaches the service.
 */
const SENSITIVE = ['terminal:write', 'terminal:start', 'fs:write-file', 'fs:read-file', 'mcp:create', 'mcp:call-tool', 'approvals:respond', 'remote:answer-pairing', 'remote:set-enabled']

test('B12: sensitive channels refuse a sender that is not the app frame', async () => {
  const root = mkdtempSync(join(tmpdir(), 'oxe-acc-b12-'))
  const app = await electron.launch({ args: [join(process.cwd(), 'e2e', 'electron-main.cjs')], env: { ...process.env, OXESPACE_DISABLE_SINGLE_INSTANCE: '1', OXESPACE_DB_PATH: join(root, 'oxespace.sqlite3') } })
  try {
    const page = await app.firstWindow()
    await page.getByTestId('btn-new-workspace').first().waitFor({ timeout: 30_000 })
    const results = await app.evaluate(async ({ ipcMain, BrowserWindow, WebContentsView }, channels) => {
      const handlers = (ipcMain as unknown as { _invokeHandlers: Map<string, (event: unknown, ...args: unknown[]) => unknown> })._invokeHandlers
      // A guest with no window of its own, as the web preview is: what a compromised page would send from.
      const guest = new WebContentsView({ webPreferences: { sandbox: true } })
      await guest.webContents.loadURL('about:blank')
      const out: Record<string, { registered: boolean; guest: string; subframe: string }> = {}
      const call = async (channel: string, event: unknown) => {
        try { await handlers.get(channel)!(event, { id: 'x', path: 'x', data: '' }); return 'accepted' } catch (e) { return `refused: ${String((e as Error).message ?? e).slice(0, 120)}` }
      }
      const appWindow = BrowserWindow.getAllWindows()[0]
      const fakeSubframe = { ...appWindow.webContents.mainFrame, parent: appWindow.webContents.mainFrame, routingId: -1 }
      for (const channel of channels) {
        const registered = handlers.has(channel)
        out[channel] = {
          registered,
          guest: registered ? await call(channel, { sender: guest.webContents, senderFrame: guest.webContents.mainFrame }) : 'n/a',
          subframe: registered ? await call(channel, { sender: appWindow.webContents, senderFrame: fakeSubframe }) : 'n/a'
        }
      }
      guest.webContents.close()
      return out
    }, SENSITIVE)
    for (const [channel, r] of Object.entries(results)) {
      expect.soft(r.registered, `${channel} is registered`).toBe(true)
      expect.soft(r.guest, `${channel} refuses a guest (WebContentsView)`).toMatch(/^refused: .*(application main frame|ipc\.sender\.)/)
      expect.soft(r.subframe, `${channel} refuses a subframe of the app window`).toMatch(/^refused: .*(application main frame|ipc\.sender\.)/)
    }
  } finally { await app.evaluate(({ app }) => app.exit(0)).catch(() => undefined) }
})

test('B12: every registered handler is guarded (contract walk over IPC_CHANNELS)', async () => {
  const root = mkdtempSync(join(tmpdir(), 'oxe-acc-b12b-'))
  const app = await electron.launch({ args: [join(process.cwd(), 'e2e', 'electron-main.cjs')], env: { ...process.env, OXESPACE_DISABLE_SINGLE_INSTANCE: '1', OXESPACE_DB_PATH: join(root, 'oxespace.sqlite3') } })
  try {
    const page = await app.firstWindow()
    await page.getByTestId('btn-new-workspace').first().waitFor({ timeout: 30_000 })
    const accepted = await app.evaluate(async ({ ipcMain, WebContentsView }) => {
      const handlers = (ipcMain as unknown as { _invokeHandlers: Map<string, (event: unknown, ...args: unknown[]) => unknown> })._invokeHandlers
      const guest = new WebContentsView({ webPreferences: { sandbox: true } })
      await guest.webContents.loadURL('about:blank')
      const open: string[] = []
      for (const [channel, handler] of handlers) {
        try {
          // A malformed argument makes most handlers throw on input validation; only a handler that runs without
          // looking at the sender at all resolves here.
          await Promise.race([Promise.resolve(handler({ sender: guest.webContents, senderFrame: guest.webContents.mainFrame }, undefined)), new Promise((_r, j) => setTimeout(() => j(new Error('timeout')), 1500))])
          open.push(channel)
        } catch (e) {
          // Refused by the sender guard: its sentence today, a C3 code once B12 lands (e.g. ipc.sender.notAppFrame).
          if (!/application main frame|ipc\.sender\./i.test(String((e as Error).message))) open.push(`${channel} (no sender refusal: ${String((e as Error).message).slice(0, 60)})`)
        }
      }
      guest.webContents.close()
      return open
    })
    // Channels registered by Electron itself and by electron-log are not the app's IPC_CHANNELS; they are listed, not
    // failed (a guest frame has no preload to reach them). Every app channel must refuse a guest sender.
    const FRAMEWORK = /^(IMPORT_SHARED_TEXTURE_|ELECTRON_|__ELECTRON_LOG__)/
    const appOpen = accepted.filter(c => !FRAMEWORK.test(c))
    console.log('B12-FRAMEWORK-CHANNELS', JSON.stringify(accepted.filter(c => FRAMEWORK.test(c))))
    expect(appOpen, 'app handlers that accept a guest sender').toEqual([])
  } finally { await app.evaluate(({ app }) => app.exit(0)).catch(() => undefined) }
})
