import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { scanSurface } from './helpers/a11y'
import { launchApp, openDemoWorkspace, resizeWindow } from './helpers/launch'

/**
 * WCAG 2.1.2 No Keyboard Trap (roadmap F23). A focused terminal keeps Tab for the shell, so there are two ways out:
 * F6 / Shift+F6 between the window's regions, and the per-pane "Tab moves focus" toggle (Ctrl+M). Neither key,
 * nor Tab while the mode is on, reaches the shell. With the mode on, the pane-grid dividers (the 2.5.7 alternative
 * to dragging) are reachable by keyboard, and choosing "Move the divider …" closes their menu with focus back on
 * the divider.
 */
async function recordTerminalWrites(app: ElectronApplication): Promise<void> {
  await app.evaluate(({ ipcMain }) => {
    const store = globalThis as typeof globalThis & { __terminalWrites?: string[] }
    store.__terminalWrites = []
    ipcMain.removeHandler('terminal:write')
    ipcMain.handle('terminal:write', (_event, input: { paneId: string; data: string }) => { store.__terminalWrites?.push(input.data) })
  })
}
const terminalWrites = (app: ElectronApplication): Promise<string[]> =>
  app.evaluate(() => [...((globalThis as typeof globalThis & { __terminalWrites?: string[] }).__terminalWrites ?? [])])

/** The pane of the terminal holding focus, or null when focus is outside every terminal. */
const focusedTerminal = (page: Page): Promise<string | null> => page.evaluate(() => {
  const active = document.activeElement
  return active?.closest('.xterm') ? active.closest<HTMLElement>('[data-terminal-pane]')?.dataset.terminalPane ?? null : null
})
const focusedRegion = (page: Page): Promise<string> => page.evaluate(() => {
  const active = document.activeElement
  const region = active?.closest('.workbench-titlebar, .app-shell > aside, .workspace-grid, .workspace-split-grid, .workspace-panel-stack, .app-statusbar')
  return region ? region.className.split(' ')[0] : `none (${active?.tagName})`
})

test('F6 and the Tab focus toggle leave a terminal; the dividers are reachable and their menu returns focus', async () => {
  test.setTimeout(120_000)
  const { app, page, workspaceRoot, consoleErrors } = await launchApp()
  try {
    await resizeWindow(app, 1280, 800)
    await app.evaluate(({ BrowserWindow }) => { const window = BrowserWindow.getAllWindows()[0]; window.show(); window.focus() })
    await recordTerminalWrites(app)
    await openDemoWorkspace(page, workspaceRoot)
    await page.getByTestId('terminal-view').first().waitFor({ state: 'visible' })
    await expect(page.getByTestId('split-resize-handle').first()).toBeAttached()

    // From the sidebar filter, Tab walks into the first terminal.
    await page.locator('.sidebar-search-input').focus()
    let first: string | null = null
    for (let step = 0; step < 80 && !first; step++) {
      await page.keyboard.press('Tab')
      first = await focusedTerminal(page)
    }
    expect(first, 'Tab never reached a terminal').not.toBeNull()
    // The way out is said once, politely, on entry.
    const announcer = page.getByTestId('terminal-focus-announcer')
    await expect(announcer).toHaveAttribute('aria-live', 'polite')
    await expect(announcer).toHaveText('Terminal. Press F6 to leave, or Ctrl+M to make Tab move focus.')

    // F6 leaves the terminal for the next region; Shift+F6 comes back to it.
    await page.keyboard.press('F6')
    await expect.poll(() => focusedTerminal(page)).toBeNull()
    expect(await focusedRegion(page)).not.toMatch(/^none/)
    await page.keyboard.press('Shift+F6')
    await expect.poll(() => focusedTerminal(page)).toBe(first)

    // Ctrl+M: Tab moves focus in this pane, with a badge and an announcement.
    await page.keyboard.press('Control+m')
    const badge = page.locator(`[data-terminal-pane="${first}"] ~ [data-testid="tab-focus-badge"]`)
    await expect(badge).toHaveText('Tab moves focus')
    await expect(announcer).toHaveText('Tab moves focus: on')
    await page.keyboard.press('Tab')
    await expect.poll(() => focusedTerminal(page)).not.toBe(first)

    // On to a divider. Another pane's terminal keeps Tab until its own mode is on, so turn it on there too.
    const divider = page.locator('[data-testid="split-resize-handle"]:focus')
    for (let step = 0; step < 80 && !(await divider.count()); step++) {
      const pane = await focusedTerminal(page)
      if (pane && pane !== first && !(await page.locator(`[data-terminal-pane="${pane}"] ~ [data-testid="tab-focus-badge"]`).count())) await page.keyboard.press('Control+m')
      await page.keyboard.press('Tab')
    }
    await expect(divider).toHaveCount(1)
    const key = await divider.getAttribute('data-divider')
    const handle = page.locator(`[data-divider="${key}"]`)

    // Enter opens the divider's menu; choosing a move closes it and gives focus back to the divider.
    const before = await handle.getAttribute('aria-valuenow')
    await page.keyboard.press('Enter')
    const menu = page.getByRole('menu', { name: /Divider between (columns|rows)/ })
    await expect(menu).toBeVisible()
    // Whichever move holds focus after an arrow (Radix may already have focused the first one).
    await page.keyboard.press('ArrowDown')
    await expect(menu.locator('[role="menuitem"]:focus')).toHaveText(/^Move the divider/)
    await page.keyboard.press('Enter')
    await expect(menu).toHaveCount(0)
    await expect(handle).toBeFocused()
    await expect.poll(() => handle.getAttribute('aria-valuenow')).not.toBe(before)
    // The arrows still resize from the divider.
    const moved = await handle.getAttribute('aria-valuenow')
    await page.keyboard.press(await handle.getAttribute('aria-orientation') === 'vertical' ? 'ArrowRight' : 'ArrowDown')
    await expect.poll(() => handle.getAttribute('aria-valuenow')).not.toBe(moved)

    // None of the ways out reached a shell: no F6 or Shift+F6 sequence, no CR from Ctrl+M, no Tab.
    const writes = await terminalWrites(app)
    for (const sequence of ['\x1b[17~', '\x1b[17;2~', '\r', '\t']) expect(writes, JSON.stringify(writes)).not.toContain(sequence)

    // The terminal pane, its badge and the announcer pass axe (xterm's canvas itself is excluded, as everywhere).
    const violations = await scanSurface(page, 'terminal/focus-exit')
    const terminalFindings = violations.filter(item => item.nodes.some(node => /terminal|tab-focus|pane-actions|split-resize/.test(node)))
    expect(terminalFindings.filter(item => item.impact === 'critical' || item.impact === 'serious'), JSON.stringify(terminalFindings, null, 2)).toEqual([])
    expect(consoleErrors.filter(line => line.startsWith('pageerror:'))).toEqual([])
  } finally {
    await Promise.race([app.close().catch(() => undefined), new Promise(resolve => setTimeout(resolve, 4000))])
  }
})
