import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { launchApp, openDemoWorkspace, resizeWindow } from './helpers/launch'
import { installThreadFixtures, openThreadWithState, registerThreadProject } from './helpers/thread-fixtures'

/**
 * Every link that leaves the window goes through one confirmed path (src/lib/externalLinks.ts). window.open is
 * stubbed in the renderer to record calls, so no browser opens. Runs against the built app in the E2E mock mode.
 */
async function recordOpens(page: Page): Promise<void> {
  await page.evaluate(() => {
    const store = window as typeof window & { __opened?: string[] }
    store.__opened = []
    window.open = ((url?: string | URL) => { store.__opened!.push(String(url)); return null }) as typeof window.open
  })
}
const opened = (page: Page): Promise<string[]> => page.evaluate(() => [...((window as typeof window & { __opened?: string[] }).__opened ?? [])])

/** Records the pane the terminal writes for, and lets the test print to it as if the shell had. */
async function captureTerminal(app: ElectronApplication): Promise<void> {
  await app.evaluate(({ ipcMain }) => {
    const store = globalThis as typeof globalThis & { __linkPane?: string }
    ipcMain.removeHandler('terminal:write')
    ipcMain.handle('terminal:write', (_event, input: { paneId: string }) => { store.__linkPane = input.paneId })
  })
}
async function printToTerminal(app: ElectronApplication, data: string): Promise<void> {
  await app.evaluate(({ BrowserWindow }, text) => {
    const paneId = (globalThis as typeof globalThis & { __linkPane?: string }).__linkPane
    for (const window of BrowserWindow.getAllWindows()) window.webContents.send('terminal:data', { paneId, data: text })
  }, data)
}

test('links ask before leaving, remember the site, and Settings clears what was remembered', async () => {
  test.setTimeout(150_000)
  const { app, page, workspaceRoot } = await launchApp()
  try {
    await resizeWindow(app, 1280, 800)
    await installThreadFixtures(app, workspaceRoot)
    await captureTerminal(app)
    await openDemoWorkspace(page, workspaceRoot)
    await page.evaluate(() => localStorage.removeItem('oxe.externalLinks.seenHosts'))
    await recordOpens(page)

    // Terminal: a plain click selects; Ctrl+click asks through the same dialog.
    const terminal = page.getByTestId('terminal-view').first()
    await terminal.waitFor({ state: 'visible' })
    await terminal.locator('.xterm-helper-textarea').focus()
    await page.keyboard.type('a')
    await expect.poll(() => app.evaluate(() => (globalThis as typeof globalThis & { __linkPane?: string }).__linkPane ?? '')).not.toBe('')
    await printToTerminal(app, '\x1b[2J\x1b[Hhttps://terminal.example/path/to/page\r\n')
    const screen = terminal.locator('.xterm-screen')
    await page.waitForTimeout(300)
    const box = (await screen.boundingBox())!
    const onLink = { x: box.x + 60, y: box.y + 6 }
    await page.mouse.move(onLink.x, onLink.y)
    await page.mouse.move(onLink.x + 4, onLink.y)
    await page.mouse.click(onLink.x + 4, onLink.y)
    await page.waitForTimeout(300)
    await expect(page.getByTestId('external-link-dialog')).toHaveCount(0)
    expect(await opened(page)).toEqual([])
    await page.keyboard.down('Control')
    await page.mouse.move(onLink.x + 8, onLink.y)
    await page.mouse.click(onLink.x + 8, onLink.y)
    await page.keyboard.up('Control')
    const terminalDialog = page.getByTestId('external-link-dialog')
    await expect(terminalDialog).toBeVisible()
    await expect(terminalDialog.getByTestId('external-link-host')).toHaveText('terminal.example')
    await terminalDialog.getByRole('button', { name: 'Open', exact: true }).click()
    await expect.poll(() => opened(page)).toEqual(['https://terminal.example/path/to/page'])

    // Agent markdown: text that names another site shows the real host and asks.
    await registerThreadProject(app, page, workspaceRoot)
    await openThreadWithState(app, page, workspaceRoot, 'conversation')
    await recordOpens(page)
    await app.evaluate((_context, root) => {
      ;(globalThis as unknown as Record<string, (s: unknown) => void>).applyThreadState({ status: 'idle', title: 'Links', events: [
        { type: 'message', id: 'u1', role: 'user', text: 'Where do I sign in?', cwd: root },
        { type: 'message', id: 'a1', role: 'assistant', text: 'Sign in at [github.com/login](https://login.evil.example/session?next=%2F) or [evil docs](https://login.evil.example/docs).' },
        { type: 'completed', status: 'completed' }
      ] })
    }, workspaceRoot)
    const link = page.locator('.thread-markdown a', { hasText: 'github.com/login' })
    await expect(link).toContainText('(login.evil.example)')
    await link.click()
    const dialog = page.getByTestId('external-link-dialog')
    await expect(dialog).toBeVisible()
    await expect(dialog.getByTestId('external-link-host')).toHaveText('login.evil.example')
    await expect(dialog.getByTestId('external-link-text')).toHaveText('github.com/login')
    await expect(dialog.getByTestId('external-link-url')).toHaveText('https://login.evil.example/session?next=%2F')
    await expect(dialog.getByRole('button', { name: 'Cancel', exact: true })).toBeFocused()
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
    await expect(dialog).toHaveCount(0)
    expect(await opened(page)).toEqual([])

    await link.click()
    await page.getByTestId('external-link-dialog').getByRole('button', { name: 'Open', exact: true }).click()
    await expect.poll(() => opened(page)).toEqual(['https://login.evil.example/session?next=%2F'])

    // The same host again, with text that names it honestly, goes straight through.
    await app.evaluate(() => {
      ;(globalThis as unknown as Record<string, (s: unknown) => void>).applyThreadState({ status: 'idle', title: 'Links', events: [
        { type: 'message', id: 'a2', role: 'assistant', text: 'Docs: [login.evil.example](https://login.evil.example/docs)' },
        { type: 'completed', status: 'completed' }
      ] })
    })
    await page.locator('.thread-markdown a', { hasText: 'login.evil.example' }).click()
    await expect.poll(() => opened(page)).toHaveLength(2)
    await expect(page.getByTestId('external-link-dialog')).toHaveCount(0)

    // Settings › General › Privacy forgets both sites.
    await page.getByRole('button', { name: 'Open settings', exact: true }).click()
    const settings = page.getByRole('dialog', { name: 'Settings', exact: true })
    await settings.getByRole('group', { name: 'Settings scope' }).getByRole('button', { name: 'Application', exact: true }).click()
    await settings.getByRole('navigation', { name: 'Settings categories' }).getByRole('button', { name: /^General/ }).click()
    await expect(settings.getByTestId('seen-sites-count')).toHaveText('2 sites remembered.')
    await settings.getByRole('button', { name: "Clear sites you've opened" }).click()
    await expect(settings.getByTestId('seen-sites-count')).toHaveText('0 sites remembered.')
    expect(await page.evaluate(() => localStorage.getItem('oxe.externalLinks.seenHosts'))).toBeNull()
  } finally {
    await app.close()
  }
})
