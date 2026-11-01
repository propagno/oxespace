import { expect, test, type Page } from '@playwright/test'
import { DatabaseSync } from 'node:sqlite'
import { launchReal, mode, quitReal, realProfile } from './real-app'

/**
 * S3 exit check (F13 + B1.3 + B1.4 + F15 + F30) · Sections, nesting, the coordinator and "since last time" survive a
 * restart, on the REAL main (no thread doubles).
 *
 * Four conversations are created through the window's own API (creating one starts no agent). One is made the child of
 * another the way oxespace_thread_create records it (mcp_thread_handoffs), as an agent would while the app runs.
 * The person then makes a section, puts a conversation in it, and marks a coordinator from the list's menus.
 * After the app closes and opens again, all of that is still there, and the list says what changed since last time.
 */
type Api = { thread: {
  addProject: (root: string) => Promise<{ projectId: string }>
  create: (i: { projectId: string; rootPath?: string; provider: 'claude' | 'codex' }) => Promise<{ thread: { id: string } }>
  saveSections: (ws: string, s: unknown) => Promise<{ ok: boolean }>
} }
const TITLES = ['Parent plan', 'Child spike', 'Sectioned review', 'Coordinator']

test('S3: sections, nesting, coordinator and "since last time" come back after a restart', async () => {
  test.setTimeout(240_000)
  const profile = realProfile('s3', { OXESPACE_LOCALE: 'en-US' })
  let { app, page } = await launchReal(profile)
  const ids: string[] = []
  let projectId: string
  try {
    ;({ projectId } = await page.evaluate(root => (window as unknown as { oxe: Api }).oxe.thread.addProject(root), profile.repo))
    for (let i = 0; i < 4; i++) ids.push(await page.evaluate(i => (window as unknown as { oxe: Api }).oxe.thread.create({ projectId: i.projectId, rootPath: i.root, provider: 'claude' }).then(s => s.thread.id), { projectId, root: profile.repo }))
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
    await item(page, 'Sectioned review').getByRole('button', { name: /Actions for/ }).click()
    await page.getByRole('menuitem', { name: /Move to section/ }).click()
    await page.getByRole('menuitem', { name: 'Reviews' }).click()
    // Coordinator, marked by the person.
    await item(page, 'Coordinator').getByRole('button', { name: /Actions for/ }).click()
    await page.getByRole('menuitem', { name: /coordinator/i }).click()
    await page.waitForTimeout(1_000)
  } finally { await quitReal(app) }

  // Something happens while the app is closed: a conversation finished (as its runtime records it).
  const db2 = new DatabaseSync(profile.db)
  db2.prepare("UPDATE conversation_threads SET data_json = json_set(data_json, '$.updatedAt', ?, '$.lastTurnStatus', 'completed') WHERE id = ?").run(Date.now(), ids[2])
  db2.close()

  ;({ app, page } = await launchReal(profile))
  try {
    await mode(page, 'thread')
    const nav = page.locator('.thread-navigation')
    await expect(nav.getByRole('region', { name: 'Reviews', exact: true }).getByText('Sectioned review'), 'the section and its conversation are back').toBeVisible({ timeout: 15_000 })
    await expect(childOf(page, 'Parent plan').getByText('Child spike'), 'nesting is back').toBeVisible()
    const firstTitle = await nav.locator('.thread-session-title').first().textContent()
    expect(firstTitle, 'the coordinator is pinned on top').toBe('Coordinator')
    await expect(item(page, 'Coordinator').getByText(/coordinator/i).first(), 'it is shown as the coordinator').toBeVisible()
    await expect(page.getByText(/since (you were here|last time)/i).first(), '"since last time" says what changed').toBeVisible()
  } finally { await quitReal(app) }
})

const item = (page: Page, title: string) => page.locator('.thread-navigation-item', { hasText: title }).first()
/** The nested list under a conversation: its tree group (role="group") right under the item. */
const childOf = (page: Page, title: string) => page.locator('[role="treeitem"], .thread-navigation-item', { hasText: title }).first().locator('xpath=following-sibling::*[1] | descendant::*[@role="group"]').first()
