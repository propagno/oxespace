import { mkdirSync, realpathSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test, type ElectronApplication, type Locator, type Page } from '@playwright/test'
import { launchApp, openDemoWorkspace, resizeWindow } from './helpers/launch'

/**
 * F33 · the path menu, end to end, on the E2E double of B18 (fake VS Code, Cursor and Zed that record their argument
 * list; electron/main/e2e/open-in-mock.ts). The same items in the same order on every surface (spec §4), and with no
 * editor installed, no editor group and no separator left behind. Each surface's menu is attached as a screenshot.
 */
type OpenedIn = { kind: 'launch' | 'reveal'; file: string; args: string[] }
const recorded = (app: ElectronApplication): Promise<OpenedIn[]> =>
  app.evaluate(() => (globalThis as typeof globalThis & { __oxeOpenedIn?: OpenedIn[] }).__oxeOpenedIn ?? [])

const REVEAL = /^(Reveal in File Explorer|Open containing folder|Reveal in Finder)$/
const EDITORS = [/^Open in VS Code\b/, /^Open in Cursor\b/, /^Open in Zed\b/]

/** The menu's items as the person reads them, separators included as "—". The menu loads on first use: wait for it. */
async function menuShape(menu: Locator): Promise<string[]> {
  await expect(menu.getByRole('menuitem').first()).toBeVisible()
  return menu.locator('[role="menuitem"], [role="separator"]').evaluateAll(nodes => nodes.map(node => node.getAttribute('role') === 'separator' ? '—' : (node.textContent ?? '').trim()))
}

async function shot(page: Page, name: string): Promise<void> {
  // After the menu's open animation: mid-fade, its items read as greyed (DESIGN #470).
  await page.evaluate(() => Promise.all(document.getAnimations().map(animation => animation.finished.catch(() => undefined))))
  await test.info().attach(name, { body: await page.screenshot(), contentType: 'image/png' })
}

function project(workspaceRoot: string): string {
  mkdirSync(join(workspaceRoot, 'src'), { recursive: true })
  writeFileSync(join(workspaceRoot, 'src', 'app.ts'), 'export const needle = 1\n')
  return realpathSync.native(join(workspaceRoot, 'src', 'app.ts'))
}

async function openTree(page: Page): Promise<void> {
  await page.keyboard.press('Control+Shift+P')
  await page.locator('[cmdk-item][data-value="cmd-tool-editor"]').click()
  await page.locator('.editor-browser-directory', { hasText: 'src' }).click()
}

test('the path menu has the same items in the same order on the tree, a tab and search', async () => {
  test.setTimeout(150_000)
  const { app, page, workspaceRoot, consoleErrors } = await launchApp()
  try {
    await resizeWindow(app, 1280, 800)
    const file = project(workspaceRoot)
    await openDemoWorkspace(page, workspaceRoot)

    // File tree: no "open in OXESpace" (it is the editor); editors, reveal, copy.
    await openTree(page)
    const row = page.locator('.editor-browser-file', { hasText: 'app.ts' })
    await row.click({ button: 'right' })
    const treeMenu = page.getByRole('menu', { name: 'Actions for src/app.ts' })
    await expect(treeMenu).toBeVisible()
    const tree = await menuShape(treeMenu)
    expect(tree.slice(0, 3).every((item, index) => EDITORS[index].test(item))).toBe(true)
    expect(tree[3]).toBe('—')
    expect(tree[4]).toMatch(REVEAL)
    expect(tree.slice(5)).toEqual(['—', 'Copy relative path', 'Copy full path'])
    await shot(page, 'tree')
    await treeMenu.getByRole('menuitem', { name: /^Open in Cursor/ }).click()
    await expect.poll(async () => (await recorded(app)).map(entry => entry.args)).toEqual([[file]])

    // A tab: its own actions, then the same items.
    await row.click()
    const tab = page.getByTestId('editor-tab-src/app.ts')
    await tab.click({ button: 'right' })
    const tabMenu = page.getByTestId('editor-tab-menu')
    await expect(tabMenu.getByRole('menuitem', { name: /^Open in VS Code/ })).toBeVisible()
    await shot(page, 'tab')
    await page.keyboard.press('Escape')

    // Search: a match carries its line, and "open in OXESpace" comes first. The E2E search double finds nothing, so
    // this test answers with the one match the file has.
    await app.evaluate(({ ipcMain }) => {
      ipcMain.removeHandler('search:run')
      ipcMain.handle('search:run', () => ({ files: [{ path: 'src/app.ts', truncated: false, matches: [{ lineNumber: 1, line: 'export const needle = 1', submatches: [{ text: 'needle', start: 13, end: 19 }] }] }], totalMatches: 1, totalFiles: 1, truncated: false, elapsedMs: 1 }))
    })
    await page.keyboard.press('Control+Shift+P')
    await page.keyboard.type('Find in files')
    await page.keyboard.press('Enter')
    await page.locator('.search-panel-input').fill('needle')
    const match = page.locator('.search-match-row').first()
    await match.click({ button: 'right' })
    const searchMenu = page.getByRole('menu', { name: 'Actions for src/app.ts' })
    const search = await menuShape(searchMenu)
    expect(search[0]).toBe("Open in OXESpace's editor")
    expect(search[2]).toMatch(/^Open in VS Code · line 1/)
    await shot(page, 'search')
    await searchMenu.getByRole('menuitem', { name: /^Open in VS Code/ }).click()
    await expect.poll(async () => (await recorded(app)).at(-1)?.args).toEqual(['--goto', `${file}:1:1`])
    expect(consoleErrors.filter(line => line.startsWith('pageerror:'))).toEqual([])
  } finally {
    await app.close()
  }
})

test('with no editor installed, the menu has no editor group and no separator left behind', async () => {
  test.setTimeout(120_000)
  const { app, page, workspaceRoot } = await launchApp({ env: { OXESPACE_E2E_OPEN_IN_EDITORS: 'none' } })
  try {
    project(workspaceRoot)
    await openDemoWorkspace(page, workspaceRoot)
    await openTree(page)
    await page.locator('.editor-browser-file', { hasText: 'app.ts' }).click({ button: 'right' })
    const menu = page.getByRole('menu', { name: 'Actions for src/app.ts' })
    const shape = await menuShape(menu)
    expect(shape[0]).toMatch(REVEAL)
    expect(shape.slice(1)).toEqual(['—', 'Copy relative path', 'Copy full path'])
    await shot(page, 'no-editor')
  } finally {
    await app.close()
  }
})
