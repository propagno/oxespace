import { _electron as electron, expect, test, type Page } from '@playwright/test'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { launchReal, mode, quitReal, realProfile } from './real-app'

/**
 * S3 exit check (F13 + B1.3 / OXE-346) · Sections and delegated child nesting survive a restart, on the REAL main
 * (no thread doubles).
 *
 * User-authorized update (25/11/2026) to align with the delivered 1.6.0 scope:
 * - Validates F13 sections and B1.3/OXE-346 delegated child nesting surviving a restart.
 * - Drops B1.4 coordinator (cut from scope per docs/guide/pt-BR/03-conversas.md:5) and the obsolete "since last time"
 *   text check (F30 shipped as the Activity Center, covered by e2e/acceptance/F30-activity-survives-restart.spec.ts).
 *
 * Three conversations are created through the window's own API (creating one starts no agent). One is made the child of
 * another the way oxespace_thread_create records it (mcp_thread_handoffs), as an agent would while the app runs.
 * The person then makes a section and puts a conversation in it from the list's menus.
 * After the app closes and opens again, the section, its conversation, and the parent/child nesting are all still there.
 */
type Api = { thread: {
  addProject: (root: string) => Promise<{ projectId: string }>
  create: (i: { projectId: string; rootPath?: string; provider: 'claude' | 'codex' }) => Promise<{ thread: { id: string } }>
} }
const TITLES = ['Parent plan', 'Child spike', 'Sectioned review']

test('S3: sections and delegated child nesting come back after a restart', async () => {
  test.setTimeout(240_000)
  const profile = realProfile('s3', { OXESPACE_LOCALE: 'en-US' })
  let { app, page } = await launchReal(profile)
  const ids: string[] = []
  let projectId: string
  try {
    ;({ projectId } = await page.evaluate(root => (window as unknown as { oxe: Api }).oxe.thread.addProject(root), profile.repo))
    for (let i = 0; i < TITLES.length; i++) ids.push(await page.evaluate(i => (window as unknown as { oxe: Api }).oxe.thread.create({ projectId: i.projectId, rootPath: i.root, provider: 'claude' }).then(s => s.thread.id), { projectId, root: profile.repo }))
  } finally { await quitReal(app) }

  // Titles, and the child link an agent's oxespace_thread_create leaves behind.
  const db = new DatabaseSync(profile.db)
  ids.forEach((id, i) => db.prepare("UPDATE conversation_threads SET data_json = json_set(data_json, '$.title', ?) WHERE id = ?").run(TITLES[i], id))
  db.prepare('INSERT INTO mcp_thread_handoffs (origin_thread_id, request_key, destination_thread_id, created_at) VALUES (?, ?, ?, ?)').run(ids[0], 'acc-child', ids[1], Date.now())
  db.close()

  ;({ app, page } = await launchReal(profile))
  try {
    await mode(page, 'thread')
    const nav = page.locator('.thread-navigation')
    await expect(nav.getByText('Parent plan')).toBeVisible({ timeout: 15_000 })
    // Nesting: the child sits under its parent, not as a top-level conversation.
    await expect(childOf(page, 'Parent plan').getByText('Child spike'), 'the child is nested under its parent').toBeVisible()
    // Section by the menu, as the person does it.
    await nav.getByRole('button', { name: /^Actions for / }).first().click()
    await page.getByRole('menuitem', { name: 'New section…' }).click()
    const dialog = page.getByRole('dialog', { name: 'New section' })
    await dialog.getByRole('textbox', { name: 'Section name' }).fill('Reviews')
    await dialog.getByRole('button', { name: 'Create section' }).click()
    await expect(nav.getByRole('region', { name: 'Reviews', exact: true })).toBeVisible()
    const sectioned = item(page, 'Sectioned review')
    await sectioned.hover()
    await sectioned.getByRole('button', { name: /Actions for/ }).click()
    await page.getByRole('menuitem', { name: /Move to section/ }).focus()
    await page.keyboard.press('ArrowRight')
    await page.getByTestId('thread-move-to-section').getByRole('menuitemradio', { name: 'Reviews' }).click()
    await expect(nav.getByRole('region', { name: 'Reviews', exact: true }).getByText('Sectioned review')).toBeVisible()
  } finally { await quitReal(app) }

  // Restart: the app reopens in OxeChat (the mode it closed in), where OxeCode's btn-new-workspace is not mounted.
  app = await electron.launch({ args: [join(process.cwd(), 'e2e', 'electron-main.cjs')], env: profile.env })
  try {
    page = await app.firstWindow()
    await page.locator('button[data-app-mode="thread"]').first().waitFor({ timeout: 30_000 })
    await mode(page, 'thread')
    const nav = page.locator('.thread-navigation')
    await expect(nav.getByRole('region', { name: 'Reviews', exact: true }).getByText('Sectioned review'), 'the section and its conversation are back').toBeVisible({ timeout: 15_000 })
    await expect(childOf(page, 'Parent plan').getByText('Child spike'), 'nesting is back').toBeVisible()
  } finally { await quitReal(app) }
})

const item = (page: Page, title: string) => page.locator('.thread-navigation-row', { hasText: title }).first()
/** The nested list under a conversation: its tree group (role="group") right under the item. */
const childOf = (page: Page, title: string) => page.locator('[role="treeitem"], .thread-navigation-item', { hasText: title }).first().locator('xpath=following-sibling::*[1] | descendant::*[@role="group"]').first()
