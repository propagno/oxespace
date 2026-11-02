import { expect, test, type ElectronApplication, type Locator, type Page } from '@playwright/test'
import { launchApp, setAppearance } from './helpers/launch'

/**
 * F13 · Sections in the conversation list, against the E2E double of main's sections store (same shared validator):
 * create, move by menu and by drag, collapse, rename, reorder by menu, delete, and everything survives a reload.
 * thread-sections-restart.spec.ts runs main for real across a restart.
 */
const SHOTS = 'e2e/screenshots/thread-sections'
const TITLES = ['Alpha plan', 'Bravo review', 'Charlie notes', 'Delta spike']

async function seedConversations(app: ElectronApplication, rootPath: string): Promise<void> {
  await app.evaluate(({ ipcMain, BrowserWindow }, { rootPath, titles }) => {
    const at = Date.UTC(2026, 9, 14, 11, 0, 0)
    const threads = titles.map((title, index) => ({ id: `t${index}`, workspaceId: 'thread:sections', projectId: 'sections', rootPath, provider: index % 2 ? 'codex' : 'claude', nativeSessionId: null, title, status: 'idle', lastTurnStatus: 'completed', pinned: false, createdAt: at - index * 60_000, updatedAt: at - index * 60_000 }))
    for (const channel of ['list', 'read', 'commands', 'projects', 'models']) ipcMain.removeHandler(`thread:${channel}`)
    ipcMain.handle('thread:projects', () => ({ projects: [{ projectId: 'sections', displayName: 'demo-repo', identityLabel: rootPath, hidden: false, contexts: [{ workspaceId: 'thread:sections', rootPath, label: 'demo-repo' }] }], unavailable: [] }))
    ipcMain.handle('thread:list', () => threads)
    ipcMain.handle('thread:read', (_event, id: string) => ({ thread: threads.find(thread => thread.id === id) ?? threads[0], events: [] }))
    ipcMain.handle('thread:commands', () => ({ commands: [] }))
    ipcMain.handle('thread:models', () => ({ defaultModel: 'test-model', models: [{ id: 'test-model', label: 'Test model', description: '', efforts: ['low'], defaultEffort: 'low' }] }))
    for (const window of BrowserWindow.getAllWindows()) window.webContents.send('thread:changed', { threadId: threads[0].id })
  }, { rootPath, titles: TITLES })
}

/** The conversation mode's button, under its current name or the OxeChat one. */
async function openConversations(page: Page): Promise<void> {
  await page.getByRole('navigation', { name: 'Application view' }).getByRole('button', { name: /^(Thread|OxeChat)$/ }).click()
  await expect(page.locator('.thread-project-group', { hasText: 'demo-repo' })).toBeVisible()
  await expect(page.locator('.thread-navigation-item').first()).toBeVisible()
}

const nav = (page: Page): Locator => page.locator('.thread-navigation')
const section = (page: Page, name: string): Locator => nav(page).getByRole('region', { name, exact: true })
const titlesIn = (scope: Locator): Promise<string[]> => scope.locator('.thread-session-title').allTextContents()
const sectionNames = (page: Page): Promise<string[]> => nav(page).locator('.thread-section').evaluateAll(nodes => nodes.map(node => node.getAttribute('aria-label') ?? ''))

async function createSection(page: Page, name: string): Promise<void> {
  await nav(page).getByRole('button', { name: 'Actions for demo-repo' }).click()
  await page.getByRole('menuitem', { name: 'New section…' }).click()
  const dialog = page.getByRole('dialog', { name: 'New section' })
  await dialog.getByRole('textbox', { name: 'Section name' }).fill(name)
  await dialog.getByRole('button', { name: 'Create section' }).click()
  await expect(dialog).toHaveCount(0)
  await expect(section(page, name)).toBeVisible()
}

async function sectionAction(page: Page, name: string, action: string): Promise<void> {
  await section(page, name).getByRole('button', { name: `Actions for section ${name}` }).click()
  await page.getByRole('menuitem', { name: action }).click()
}

test('sections organise conversations by menu, drag and keyboard, and persist', async () => {
  test.setTimeout(180_000)
  const launched = await launchApp({ appearance: 'light' })
  const { app, page, workspaceRoot, consoleErrors } = launched
  try {
    await seedConversations(app, workspaceRoot)
    await openConversations(page)
    await expect(page.locator('.thread-navigation-item')).toHaveCount(TITLES.length)

    // Create two sections from the project menu; an invalid name is explained under the field.
    await nav(page).getByRole('button', { name: 'Actions for demo-repo' }).click()
    await page.getByRole('menuitem', { name: 'New section…' }).click()
    const dialog = page.getByRole('dialog', { name: 'New section' })
    await dialog.getByRole('textbox', { name: 'Section name' }).fill('x'.repeat(61))
    await dialog.getByRole('button', { name: 'Create section' }).click()
    await expect(dialog.getByText('Use 1 to 60 characters, without line breaks or control characters.')).toBeVisible()
    await dialog.getByRole('button', { name: 'Cancel' }).click()
    await createSection(page, 'Work')
    await createSection(page, 'Later')
    expect(await sectionNames(page)).toEqual(['Work', 'Later'])

    // Move by the conversation menu, from the keyboard: the submenu opens with ArrowRight.
    await nav(page).getByRole('button', { name: 'Actions for Alpha plan' }).click()
    await page.getByRole('menuitem', { name: 'Move to section' }).focus()
    await page.keyboard.press('ArrowRight')
    await page.getByTestId('thread-move-to-section').getByRole('menuitemradio', { name: 'Work' }).click()
    await expect.poll(() => titlesIn(section(page, 'Work'))).toEqual(['Alpha plan'])
    // Said politely, and the focus goes to the moved row, never to the page.
    const announcer = page.getByTestId('thread-sections-announcer')
    await expect(announcer).toHaveText('Moved Alpha plan to Work')
    await expect.poll(() => page.evaluate(() => document.activeElement?.closest('[data-thread-row]') ? (document.activeElement as HTMLElement).innerText : document.activeElement?.tagName)).toContain('Alpha plan')

    // Move another by dragging it onto a section: the same move.
    await nav(page).locator('.thread-navigation-row', { hasText: 'Bravo review' }).dragTo(section(page, 'Later'))
    await expect.poll(() => titlesIn(section(page, 'Later'))).toEqual(['Bravo review'])
    await expect.poll(() => titlesIn(nav(page).locator('.thread-project-rows'))).toEqual(['Charlie notes', 'Delta spike'])

    // Collapse with the heading; its count stays visible.
    const workToggle = section(page, 'Work').getByRole('button', { name: /^Work/ })
    await workToggle.click()
    await expect(workToggle).toHaveAttribute('aria-expanded', 'false')
    await expect(section(page, 'Work').locator('.thread-session-title')).toHaveCount(0)
    await expect(workToggle).toContainText('1')

    // Rename and reorder from the section's menu.
    await sectionAction(page, 'Later', 'Rename section…')
    const rename = page.getByRole('dialog', { name: 'Rename section' })
    await rename.getByRole('textbox', { name: 'Section name' }).fill('Someday')
    await rename.getByRole('button', { name: 'Rename' }).click()
    await expect(section(page, 'Someday')).toBeVisible()
    await sectionAction(page, 'Someday', 'Move section up')
    await expect.poll(() => sectionNames(page)).toEqual(['Someday', 'Work'])

    // Visual check in both modes, which also reloads: everything above persisted.
    for (const mode of ['light', 'dark'] as const) {
      await setAppearance(page, mode)
      await openConversations(page)
      await expect.poll(() => sectionNames(page)).toEqual(['Someday', 'Work'])
      await expect(section(page, 'Work').getByRole('button', { name: /^Work/ })).toHaveAttribute('aria-expanded', 'false')
      await expect.poll(() => titlesIn(section(page, 'Someday'))).toEqual(['Bravo review'])
      await nav(page).screenshot({ path: `${SHOTS}-${mode}.png` })
    }
    await section(page, 'Work').getByRole('button', { name: /^Work/ }).click()
    await expect.poll(() => titlesIn(section(page, 'Work'))).toEqual(['Alpha plan'])

    // Delete a section: its conversation goes back to no section, none is deleted.
    await sectionAction(page, 'Work', 'Delete section…')
    const confirm = page.getByRole('dialog', { name: 'Delete this section?' })
    await expect(confirm).toContainText('its 1 conversation goes back to no section')
    await confirm.getByRole('button', { name: 'Delete section' }).click()
    await expect(page.getByTestId('thread-sections-announcer')).toHaveText('Section deleted; 1 conversation went back to No section')
    await expect(section(page, 'Work')).toHaveCount(0)
    await expect(page.locator('.thread-navigation-item')).toHaveCount(TITLES.length)
    await expect.poll(() => titlesIn(nav(page).locator('.thread-project-rows'))).toEqual(['Alpha plan', 'Charlie notes', 'Delta spike'])

    await page.reload()
    await page.waitForLoadState('load')
    await openConversations(page)
    await expect.poll(() => sectionNames(page)).toEqual(['Someday'])
    await expect.poll(() => titlesIn(section(page, 'Someday'))).toEqual(['Bravo review'])
    await expect.poll(() => titlesIn(nav(page).locator('.thread-project-rows'))).toEqual(['Alpha plan', 'Charlie notes', 'Delta spike'])
    expect(consoleErrors.filter(line => line.startsWith('pageerror:'))).toEqual([])
  } finally {
    await Promise.race([app.close().catch(() => undefined), new Promise(resolve => setTimeout(resolve, 4000))])
  }
})
