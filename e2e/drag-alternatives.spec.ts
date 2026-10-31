import { expect, test, type Locator, type Page } from '@playwright/test'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { launchApp, openDemoWorkspace, resizeWindow } from './helpers/launch'

/**
 * WCAG 2.5.7 Dragging Movements: everything that can be dragged can also be done with single clicks. A click on a
 * divider (a press that does not travel) opens its menu; the file tree's menu copies a path instead of dragging it
 * into a terminal. Tab and pane reordering are covered by offer-audit (tab menu) and the pane menu's Arrange.
 */
const click = async (page: Page, target: Locator): Promise<void> => {
  const box = await target.boundingBox()
  if (!box) throw new Error('target not visible')
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
  await page.mouse.up()
}

test('dividers and the file tree work without dragging', async () => {
  test.setTimeout(120_000)
  const { app, page, workspaceRoot, consoleErrors } = await launchApp()
  try {
    await resizeWindow(app, 1280, 800)
    writeFileSync(join(workspaceRoot, 'notes.md'), '# notes\n')
    await openDemoWorkspace(page, workspaceRoot)

    // The workspaces sidebar: a click opens Smaller, Larger and Restore; Larger keeps the menu open.
    const sidebar = page.getByRole('separator', { name: 'Sidebar width' })
    const before = Number(await sidebar.getAttribute('aria-valuenow'))
    await click(page, sidebar)
    const sidebarMenu = page.getByRole('menu', { name: 'Sidebar width: size options' })
    await expect(sidebarMenu).toBeVisible()
    await sidebarMenu.getByRole('menuitem', { name: 'Larger' }).click()
    await sidebarMenu.getByRole('menuitem', { name: 'Larger' }).click()
    await expect(sidebar).toHaveAttribute('aria-valuenow', String(before + 16))
    await sidebarMenu.getByRole('menuitem', { name: 'Restore the default size' }).click()
    await expect(sidebarMenu).toHaveCount(0)
    await expect(sidebar).toHaveAttribute('aria-valuenow', '280')
    await expect(sidebar).toBeFocused()
    // The keyboard opens it like the grid dividers below: Space and Shift+F10 (a contextmenu event on Linux).
    for (const key of ['Space', 'Shift+F10']) {
      await sidebar.focus()
      await page.keyboard.press(key)
      await expect(sidebarMenu).toBeVisible()
      await expect(sidebarMenu.getByRole('menuitem').first()).toBeFocused()
      await page.keyboard.press('Escape')
      await expect(sidebarMenu).toHaveCount(0)
      await expect(sidebar).toBeFocused()
    }

    // A divider of the pane grid moves with its menu.
    const divider = page.getByTestId('split-resize-handle').first()
    const left = await divider.evaluate(element => (element as HTMLElement).style.left)
    // Playwright's own click: a press without travel, after checking the divider itself receives the pointer.
    await divider.click()
    const dividerMenu = page.getByRole('menu', { name: /Divider between (columns|rows)/ })
    await expect(dividerMenu).toBeVisible()
    await dividerMenu.getByRole('menuitem').last().click()
    await expect.poll(() => divider.evaluate(element => (element as HTMLElement).style.left + (element as HTMLElement).style.top)).not.toBe(left)
    await page.keyboard.press('Escape')
    // Closed for good before the keyboard round, so its focus hand-back cannot meet the next menu.
    await expect(dividerMenu).toHaveCount(0)
    await expect(divider).toBeFocused()
    // The same menu from the keyboard: Space and Shift+F10, like the other dividers; Escape gives focus back.
    // (On Linux, Chromium turns Shift+F10 into a contextmenu event; the divider opens its menu from that too.)
    for (const key of ['Space', 'Shift+F10']) {
      await divider.focus()
      await expect(divider).toBeFocused()
      await page.keyboard.press(key)
      await expect(dividerMenu).toBeVisible()
      // A menu a keyboard user can walk: its first item holds the focus, also after the earlier menu's focus hand-back.
      await expect(dividerMenu.getByRole('menuitem').first()).toBeFocused()
      await page.keyboard.press('Escape')
      await expect(dividerMenu).toHaveCount(0)
    }
    await expect(divider).toHaveAttribute('aria-valuenow', /\d+/)

    // The file tree copies a path instead of dragging it into a terminal.
    await page.keyboard.press('Control+k')
    await page.locator('[cmdk-item][data-value="cmd-tool-editor"]').click()
    const file = page.locator('.editor-browser-file', { hasText: 'notes.md' })
    await file.click({ button: 'right' })
    const pathMenu = page.getByRole('menu', { name: 'Path of notes.md' })
    await pathMenu.getByRole('menuitem', { name: 'Copy relative path' }).click()
    await expect(page.getByText('Path copied')).toBeVisible()

    // The conversations sidebar has the same divider.
    // Ctrl+2 opens the conversations mode, whatever it is called on screen.
    await page.keyboard.press('Control+2')
    const threadSidebar = page.getByRole('separator', { name: /sidebar width/i })
    await click(page, threadSidebar)
    await expect(page.getByRole('menu', { name: /: size options$/ })).toBeVisible()
    expect(consoleErrors.filter(line => line.startsWith('pageerror:'))).toEqual([])
  } finally {
    await app.close()
  }
})
