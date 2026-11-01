import { _electron as electron, expect, test, type ElectronApplication, type Locator, type Page } from '@playwright/test'
import { mkdirSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { resizeWindow } from './helpers/launch'

/**
 * F13 · Sections of the conversation list are kept by the main process. This runs main for real (no E2E doubles) on
 * a database of its own: sections a window kept in localStorage before are moved to main on the first load, and
 * what is made, moved and folded comes back after a restart. Creating a conversation only records it; no agent runs.
 */
const launchReal = (dbPath: string) => electron.launch({
  args: [join(process.cwd(), 'e2e', 'electron-main.cjs')],
  env: { ...process.env, OXESPACE_DISABLE_SINGLE_INSTANCE: '1', OXESPACE_E2E_MOCK_NATIVE: '0', OXESPACE_DB_PATH: dbPath }
})
const close = (app: ElectronApplication) => Promise.race([app.close().catch(() => undefined), new Promise(resolve => setTimeout(resolve, 4000))])

const nav = (page: Page): Locator => page.locator('.thread-navigation')
const section = (page: Page, name: string): Locator => nav(page).getByRole('region', { name, exact: true })
const row = (id: string): string => `[data-thread-row="${id}"]`
const sectionNames = (page: Page): Promise<string[]> => nav(page).locator('.thread-section').evaluateAll(nodes => nodes.map(node => node.getAttribute('aria-label') ?? ''))

async function openConversations(page: Page, project: string): Promise<void> {
  await page.getByRole('navigation', { name: 'Application view' }).getByRole('button', { name: /^(Thread|OxeChat)$/ }).click()
  await expect(nav(page).locator('.thread-project-group', { hasText: project })).toBeVisible()
}

test('sections live in the main process: a local copy moves there once, and the list comes back after a restart', async () => {
  test.setTimeout(150_000)
  const root = mkdtempSync(join(tmpdir(), 'oxe-sections-'))
  const repo = join(root, 'sections-repo')
  mkdirSync(repo, { recursive: true })
  const project = basename(repo)
  const dbPath = join(root, 'db.sqlite3')

  let app = await launchReal(dbPath)
  let second!: string
  try {
    const page = await app.firstWindow()
    await resizeWindow(app, 1280, 800)
    await page.getByTestId('btn-new-workspace').waitFor()
    const ids = await page.evaluate(async repo => {
      const added = await window.oxe.thread!.addProject(repo)
      const threads: string[] = []
      for (let index = 0; index < 3; index++) threads.push((await window.oxe.thread!.create({ projectId: added.projectId, provider: 'codex' })).thread.id)
      return { projectId: added.projectId, threads }
    }, repo)
    const first = ids.threads[0]
    second = ids.threads[1]
    // What a window kept before main did: one section holding the first conversation.
    await page.evaluate(({ projectId, first }) => {
      localStorage.setItem(`oxe-thread-sections:${projectId}`, JSON.stringify({ sections: [{ id: 'imported', projectId, name: 'Imported', order: 0, collapsed: false, createdAt: 1 }], assignments: { [first]: 'imported' } }))
    }, { projectId: ids.projectId, first })
    await page.reload()
    await openConversations(page, project)

    // Moved to main on this first load, and forgotten locally.
    await expect(section(page, 'Imported').locator(row(first))).toHaveCount(1)
    await expect.poll(() => page.evaluate(projectId => window.oxe.thread!.sections!(`thread:${projectId}`), ids.projectId))
      .toMatchObject({ sections: [{ id: 'imported', name: 'Imported' }], assignments: { [first]: 'imported' } })
    expect(await page.evaluate(projectId => localStorage.getItem(`oxe-thread-sections:${projectId}`), ids.projectId)).toBeNull()

    // A new section, a conversation moved into it, and the imported one folded.
    await nav(page).getByRole('button', { name: `Actions for ${project}` }).click()
    await page.getByRole('menuitem', { name: 'New section…' }).click()
    const dialog = page.getByRole('dialog', { name: 'New section' })
    await dialog.getByRole('textbox', { name: 'Section name' }).fill('Work')
    await dialog.getByRole('button', { name: 'Create section' }).click()
    await expect(section(page, 'Work')).toBeVisible()
    // Moved with the row's context menu, from the keyboard into the submenu.
    await nav(page).locator(row(second)).click({ button: 'right' })
    await page.getByRole('menuitem', { name: 'Move to section' }).focus()
    await page.keyboard.press('ArrowRight')
    await page.getByTestId('thread-move-to-section').getByRole('menuitemradio', { name: 'Work' }).click()
    await expect(section(page, 'Work').locator(row(second))).toHaveCount(1)
    const imported = section(page, 'Imported').getByRole('button', { name: /^Imported/ })
    await imported.click()
    await expect(imported).toHaveAttribute('aria-expanded', 'false')
    await expect.poll(() => page.evaluate(projectId => window.oxe.thread!.sections!(`thread:${projectId}`), ids.projectId).then(state => state.sections.map(item => `${item.name}:${item.collapsed}`)))
      .toEqual(['Imported:true', 'Work:false'])
  } finally { await close(app) }

  // Restart: the same sections, in order, with the same conversations, and the fold kept.
  app = await launchReal(dbPath)
  try {
    const page = await app.firstWindow()
    await resizeWindow(app, 1280, 800)
    await page.getByTestId('btn-new-workspace').waitFor()
    await openConversations(page, project)
    await expect.poll(() => sectionNames(page)).toEqual(['Imported', 'Work'])
    await expect(section(page, 'Imported').getByRole('button', { name: /^Imported/ })).toHaveAttribute('aria-expanded', 'false')
    await expect(section(page, 'Work').locator(row(second))).toHaveCount(1)
    await page.waitForTimeout(300)
    await page.screenshot({ path: test.info().outputPath('sections-after-restart.png') })
  } finally { await close(app) }
})
