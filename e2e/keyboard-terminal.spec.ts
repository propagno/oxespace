import { _electron as electron, expect, test, type ElectronApplication } from '@playwright/test'
import { mkdirSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * A focused xterm cancels every key it understands, so app shortcuts used to
 * end up in the shell. Only the reserved chords (palette, settings, sidebar)
 * leave the terminal; everything else, Ctrl+R included, still reaches the PTY.
 */
async function recordTerminalWrites(app: ElectronApplication): Promise<void> {
  await app.evaluate(({ ipcMain, BrowserWindow }) => {
    const store = globalThis as typeof globalThis & { __terminalWrites?: string[] }
    store.__terminalWrites = []
    ipcMain.removeHandler('terminal:write')
    ipcMain.handle('terminal:write', (_event, input: { paneId: string; data: string }) => {
      store.__terminalWrites?.push(input.data)
      for (const window of BrowserWindow.getAllWindows()) window.webContents.send('terminal:data', { paneId: input.paneId, data: input.data })
    })
  })
}

const terminalWrites = (app: ElectronApplication): Promise<string[]> =>
  app.evaluate(() => [...((globalThis as typeof globalThis & { __terminalWrites?: string[] }).__terminalWrites ?? [])])

test('reserved shortcuts leave a focused terminal, the rest reach the shell', async () => {
  test.setTimeout(60_000)
  const root = mkdtempSync(join(tmpdir(), 'oxe-keyboard-terminal-'))
  const workspaceRoot = join(root, 'repo')
  mkdirSync(workspaceRoot, { recursive: true })
  const app = await electron.launch({ args: [join(process.cwd(), 'e2e/electron-main.cjs')], env: {
    ...process.env, OXESPACE_DISABLE_SINGLE_INSTANCE: '1', OXESPACE_E2E_MOCK_NATIVE: '1', OXESPACE_DB_PATH: join(root, 'db.sqlite3')
  } })
  try {
    const page = await app.firstWindow()
    await page.waitForURL(/index\.html/)
    await app.evaluate(({ BrowserWindow }) => { const window = BrowserWindow.getAllWindows()[0]; window.show(); window.focus() })
    await recordTerminalWrites(app)
    await page.getByTestId('btn-new-workspace').click()
    await page.getByTestId('wizard-dir-input').fill(workspaceRoot)
    await page.getByTestId('wizard-layout-card-1').click()
    await page.getByTestId('wizard-launch-btn').click()
    const terminal = page.getByTestId('terminal-view').first()
    await terminal.waitFor({ state: 'visible' })
    const focusTerminal = async (): Promise<void> => {
      await terminal.locator('.xterm-helper-textarea').focus()
      await expect.poll(() => page.evaluate(() => Boolean(document.activeElement?.closest('.xterm')))).toBe(true)
    }

    // Ctrl+K opens the palette instead of sending ^K (kill line) to the shell.
    await focusTerminal()
    await page.keyboard.press('Control+k')
    const palette = page.locator('input[placeholder="Search files and commands…"]')
    await expect(palette).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(palette).toBeHidden()

    // Ctrl+B collapses the sidebar instead of sending ^B (back one character).
    await focusTerminal()
    const collapsed = await page.locator('.sidebar.sidebar-collapsed').count()
    await page.keyboard.press('Control+b')
    await expect.poll(() => page.locator('.sidebar.sidebar-collapsed').count()).not.toBe(collapsed)
    await focusTerminal()
    await page.keyboard.press('Control+b')
    await expect.poll(() => page.locator('.sidebar.sidebar-collapsed').count()).toBe(collapsed)

    // Ctrl+R (reverse search) and Ctrl+J (newline) stay with the shell.
    await focusTerminal()
    await page.keyboard.press('Control+r')
    await page.keyboard.press('Control+j')
    await expect.poll(() => terminalWrites(app)).toEqual(expect.arrayContaining(['\x12', '\n']))
    await expect(palette).toBeHidden()

    const writes = await terminalWrites(app)
    expect(writes).not.toContain('\x0b')
    expect(writes).not.toContain('\x02')
  } finally {
    await Promise.race([app.close().catch(() => undefined), new Promise(resolve => setTimeout(resolve, 4000))])
  }
})
