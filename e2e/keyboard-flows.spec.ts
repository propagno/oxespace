import { expect, test, type Page } from '@playwright/test'
import { launchApp, openDemoWorkspace, resizeWindow } from './helpers/launch'
import { installThreadFixtures, openThreadWithState, registerThreadProject } from './helpers/thread-fixtures'

/**
 * Keyboard-only flows through the places people spend the most time: the Thread composer, the two
 * sidebars, the OxeQuery result grid and the shortcut guide. Each step is done with keys alone once
 * the starting point has focus; a step that needs the mouse would be a keyboard trap for someone who
 * cannot use one. Runs against the built app (`npm run build`) in the E2E mock mode.
 */

/** Takes focus off whatever control holds it (a terminal grabs focus when a workspace opens). */
async function focusNothing(page: Page): Promise<void> {
  await page.evaluate(() => { (document.activeElement as HTMLElement | null)?.blur() })
}

/** Describes where focus is, for failure messages. */
async function focusedName(page: Page): Promise<string> {
  return page.evaluate(() => {
    const el = document.activeElement as HTMLElement | null
    return el ? `${el.tagName.toLowerCase()} "${el.getAttribute('aria-label') ?? el.textContent?.trim().slice(0, 40) ?? ''}"` : 'none'
  })
}

test('Thread composer: write, break lines, reach its controls and send without a mouse', async () => {
  test.setTimeout(120_000)
  const { app, page, workspaceRoot } = await launchApp()
  try {
    await resizeWindow(app, 1280, 800)
    await installThreadFixtures(app, workspaceRoot)
    // Count what the composer sends, so Enter and Shift+Enter can be told apart.
    await app.evaluate(({ ipcMain }) => {
      const g = globalThis as Record<string, unknown>
      g.keyboardSends = [] as unknown[]
      ipcMain.removeHandler('thread:send')
      ipcMain.handle('thread:send', (_event, ...args: unknown[]) => { (g.keyboardSends as unknown[]).push(args) })
    })
    await openDemoWorkspace(page, workspaceRoot)
    await registerThreadProject(app, page, workspaceRoot)
    await openThreadWithState(app, page, workspaceRoot, 'conversation')
    const sends = () => app.evaluate(() => ((globalThis as Record<string, unknown>).keyboardSends as unknown[]).length)

    const message = page.getByRole('textbox', { name: 'Message', exact: true })
    await expect(message).toBeEnabled()
    await message.focus()
    await page.keyboard.type('First line')
    await page.keyboard.press('Shift+Enter')
    await page.keyboard.type('second line')
    await expect(message).toHaveValue('First line\nsecond line')
    expect(await sends()).toBe(0)

    // Tab leaves the field for the composer's own controls, and Shift+Tab comes back to it.
    await page.keyboard.press('Tab')
    await expect(page.getByRole('button', { name: 'Show thread commands' }), await focusedName(page)).toBeFocused()
    await page.keyboard.press('Tab')
    const addToPrompt = page.getByRole('button', { name: 'Add to prompt' })
    await expect(addToPrompt).toBeFocused()

    // The "Add to prompt" menu opens with Enter, walks with the arrows and gives focus back on Escape.
    await page.keyboard.press('Enter')
    const menu = page.getByRole('menu', { name: 'Add to prompt' })
    await expect(menu).toBeVisible()
    const focusedItem = () => page.evaluate(() => document.activeElement?.getAttribute('role') === 'menuitem' ? document.activeElement.textContent?.trim() ?? '' : '')
    await expect.poll(focusedItem).not.toBe('')
    const first = await focusedItem()
    await page.keyboard.press('ArrowDown')
    await expect.poll(focusedItem).not.toBe(first)
    expect(await focusedItem()).not.toBe('')
    await page.keyboard.press('Escape')
    await expect(menu).toHaveCount(0)
    await expect(addToPrompt).toBeFocused()

    await page.keyboard.press('Shift+Tab')
    await page.keyboard.press('Shift+Tab')
    await expect(message, await focusedName(page)).toBeFocused()
    await expect(message).toHaveValue('First line\nsecond line')

    // Enter sends, once, and the draft clears.
    await page.keyboard.press('End')
    await page.keyboard.press('Enter')
    await expect.poll(sends).toBe(1)
    await expect(message).toHaveValue('')
  } finally {
    await app.close()
  }
})

test('sidebars: "/" finds the filter, Ctrl+B folds the Code sidebar, the Thread sidebar resizes from the keyboard', async () => {
  test.setTimeout(120_000)
  const { app, page, workspaceRoot } = await launchApp()
  try {
    await resizeWindow(app, 1280, 800)
    await installThreadFixtures(app, workspaceRoot)
    await openDemoWorkspace(page, workspaceRoot)

    // Code sidebar: "/" from anywhere outside a field lands in the workspace filter.
    const shell = page.locator('main.app-shell')
    const workspaces = page.getByRole('searchbox', { name: 'Filter workspaces' })
    await focusNothing(page)
    await page.keyboard.press('/')
    await expect(workspaces).toBeFocused()
    await page.keyboard.type('no-such-workspace')
    await expect(workspaces).toHaveValue('no-such-workspace')
    await page.keyboard.press('Tab')
    // With text in the field, the next stop is its clear button, and Enter on it empties the field.
    await expect(page.getByRole('button', { name: 'Clear search' }).first()).toBeFocused()
    await page.keyboard.press('Enter')
    await expect(workspaces).toHaveValue('')

    // Ctrl+B folds the sidebar and unfolds it; "/" on a folded sidebar unfolds it and focuses the filter.
    await focusNothing(page)
    await page.keyboard.press('Control+b')
    await expect(shell).toHaveClass(/sidebar-collapsed/)
    await page.keyboard.press('Control+b')
    await expect(shell).not.toHaveClass(/sidebar-collapsed/)
    await page.keyboard.press('Control+b')
    await expect(shell).toHaveClass(/sidebar-collapsed/)
    await focusNothing(page)
    await page.keyboard.press('/')
    await expect(shell).not.toHaveClass(/sidebar-collapsed/)
    await expect(workspaces).toBeFocused()

    // Thread sidebar: the same "/" reaches its filter, and the width handle answers the arrows, Home and End.
    await registerThreadProject(app, page, workspaceRoot)
    await openThreadWithState(app, page, workspaceRoot, 'conversation')
    const sidebar = page.getByRole('complementary', { name: 'Thread sidebar' })
    await focusNothing(page)
    await page.keyboard.press('/')
    const threads = sidebar.getByRole('searchbox', { name: 'Filter threads' })
    await expect(threads).toBeFocused()
    await page.keyboard.type('Authentication')
    await expect(sidebar.getByText('Authentication flow').first()).toBeVisible()
    await page.keyboard.press('Control+a')
    await page.keyboard.press('Delete')

    const handle = sidebar.getByRole('separator', { name: 'Thread sidebar width' })
    await handle.focus()
    const width = async () => Number(await handle.getAttribute('aria-valuenow'))
    const start = await width()
    await page.keyboard.press('ArrowRight')
    await expect.poll(width).toBeGreaterThan(start)
    await page.keyboard.press('Home')
    await expect.poll(width).toBe(Number(await handle.getAttribute('aria-valuemin')))
    await page.keyboard.press('End')
    await expect.poll(width).toBe(Number(await handle.getAttribute('aria-valuemax')))
  } finally {
    await app.close()
  }
})

// Arrow keys, j/k, Home and End across the rows of both sidebars come with the list keyboard work
// (pillar V, track 2.4: src/hooks/useListKeyboard.ts), which is not on main yet. Enable this then.
test.skip('sidebars: arrow keys walk the workspace and conversation rows (track 2.4)', async () => {
  // Expected: focus a row, ArrowDown/ArrowUp and j/k move one row, Home/End jump to the ends,
  // Enter opens the row, and only one row is in the tab order (roving tabindex).
})

test('OxeQuery grid: arrows, extend, jump, open a row and let go of the selection by keyboard', async () => {
  test.setTimeout(120_000)
  const { app, page, workspaceRoot } = await launchApp()
  try {
    await resizeWindow(app, 1280, 800)
    await openDemoWorkspace(page, workspaceRoot)
    await page.getByRole('navigation', { name: 'Application view' }).getByRole('button', { name: 'OxeQuery' }).click()
    await page.getByRole('button', { name: 'Connect to pg-dev' }).click()
    const tree = page.getByRole('tree', { name: 'Schema objects' })
    await tree.getByRole('treeitem', { name: 'users', exact: true }).click({ position: { x: 12, y: 8 } })
    const grid = page.locator('.oq-grid')
    await expect(grid.getByRole('gridcell', { name: 'alice', exact: true })).toBeVisible()

    // The grid is one tab stop; the active cell is announced through aria-activedescendant.
    await expect(grid).toHaveAttribute('tabindex', '0')
    await grid.focus()
    const active = async () => (await grid.getAttribute('aria-activedescendant')) ?? ''
    await page.keyboard.press('ArrowDown')
    await expect.poll(active).toMatch(/-cell-1-0$/)
    await page.keyboard.press('ArrowRight')
    await expect.poll(active).toMatch(/-cell-1-1$/)
    await page.keyboard.press('ArrowUp')
    await page.keyboard.press('ArrowLeft')
    await expect.poll(active).toMatch(/-cell-0-0$/)
    // The active cell is a real element, so a screen reader can read it.
    await expect(page.locator(`[id="${await active()}"]`)).toHaveCount(1)

    // Shift extends the selection; Escape lets go of it.
    await page.keyboard.press('Shift+ArrowDown')
    await page.keyboard.press('Shift+ArrowRight')
    await expect(grid.locator('[role="gridcell"][aria-selected="true"]')).toHaveCount(4)
    await page.keyboard.press('Escape')
    await expect(grid).not.toHaveAttribute('aria-activedescendant', /.+/)
    await expect(grid.locator('[role="gridcell"][aria-selected="true"]')).toHaveCount(0)

    // Ctrl+End goes to the last cell, Home to the first column of that row, Ctrl+Home back to the start.
    await page.keyboard.press('Control+End')
    const last = await active()
    expect(last).toMatch(/-cell-\d+-\d+$/)
    await page.keyboard.press('Home')
    await expect.poll(active).toMatch(/-cell-\d+-0$/)
    await page.keyboard.press('Control+Home')
    await expect.poll(active).toMatch(/-cell-0-0$/)

    // Enter opens the row, and the details close by keyboard.
    await page.keyboard.press('Enter')
    const details = page.getByRole('complementary', { name: 'Row details' })
    await expect(details).toBeVisible()
    await details.getByRole('button', { name: 'Close row details' }).focus()
    await page.keyboard.press('Enter')
    await expect(details).toHaveCount(0)
  } finally {
    await app.close()
  }
})

// The shortcut guide (`?` or Ctrl+/ outside a text field) comes with PR #121 (pillar V, track 2.2),
// which is not on main yet. Enable this once it is merged.
test.skip('shortcut guide opens from the keyboard, lists the current screen and closes with Escape (PR #121)', async () => {
  // Expected: with focus outside a field, `?` opens a dialog named after the shortcut guide; it lists the
  // chords of the registry for the current view; Tab stays inside it; Escape closes it and focus returns.
})
