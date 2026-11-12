import { expect, test, type Page } from '@playwright/test'
import { launchApp, openDemoWorkspace, resizeWindow } from './helpers/launch'
import { connectFromContainer, openView } from './helpers/oxepod'
import { installThreadFixtures, openThreadWithState, registerThreadProject } from './helpers/thread-fixtures'

/**
 * T61, from the user: "in OxeChat, OxeQuery and OxePod, when I click collapse, the open menu items disappear". The
 * collapsed rail drew only the actions, while OxeCode's kept its workspaces; and OxeQuery's folded sections came back
 * reset after expanding. Here: the collapsed rail lists the items and opens one, and expanding finds the same groups.
 */
const rail = (page: Page) => page.locator('[data-rail-items]')
const collapse = (page: Page) => page.getByRole('button', { name: /^Collapse (the )?sidebar/ }).first().click()
const expand = (page: Page) => page.getByRole('button', { name: /^Expand (the )?sidebar/ }).first().click()
const pageErrors = (lines: string[]): string[] => lines.filter(line => line.startsWith('pageerror:'))

test('OxeChat: the collapsed rail lists the conversations and opens one', async () => {
  test.setTimeout(120_000)
  const { app, page, workspaceRoot, consoleErrors } = await launchApp()
  try {
    await resizeWindow(app, 1280, 800)
    await installThreadFixtures(app, workspaceRoot)
    await openDemoWorkspace(page, workspaceRoot)
    await registerThreadProject(app, page, workspaceRoot)
    await openThreadWithState(app, page, workspaceRoot, 'conversation')
    await collapse(page)
    const item = rail(page).getByRole('button', { name: /^Authentication flow/ })
    await expect(item).toBeVisible()
    await expect(item).toHaveAttribute('aria-current', 'page')
    await item.click()
    await expect(page.locator('.thread-timeline')).toBeVisible()
    await expand(page)
    await expect(rail(page)).toHaveCount(0)
    await expect(page.getByRole('navigation', { name: 'OxeChat projects' }).getByRole('button', { name: /Authentication flow/ }).first()).toBeVisible()
    expect(pageErrors(consoleErrors)).toEqual([])
  } finally {
    await app.close()
  }
})

test('OxeQuery: the collapsed rail lists the connections, and expanding keeps the folded sections', async () => {
  test.setTimeout(150_000)
  const { app, page, workspaceRoot, consoleErrors } = await launchApp()
  try {
    await openDemoWorkspace(page, workspaceRoot)
    await connectFromContainer(page, 'pg-dev')
    const list = page.getByRole('region', { name: 'Connections' })
    // Two sections: Favorites and a group.
    await list.getByRole('button', { name: 'Edit pg-dev' }).click()
    const form = page.getByRole('dialog', { name: 'Edit connection' })
    await form.getByLabel('Group').fill('Client A')
    await form.getByRole('button', { name: 'Save' }).click()
    await list.getByRole('button', { name: 'Favorite pg-dev' }).first().click()
    const group = list.getByRole('button', { name: /^Client A/ }), favorites = list.getByRole('button', { name: /^Favorites/ })
    await group.click()
    await expect(group).toHaveAttribute('aria-expanded', 'false')
    await expect(favorites).toHaveAttribute('aria-expanded', 'true')

    await collapse(page)
    const item = rail(page).getByRole('button', { name: 'pg-dev', exact: true })
    await expect(item).toHaveAttribute('aria-current', 'page')
    await item.click()
    await expect(page.getByRole('tab', { name: 'pg-dev', exact: true })).toBeVisible()

    await expand(page)
    await expect(group).toHaveAttribute('aria-expanded', 'false')
    await expect(favorites).toHaveAttribute('aria-expanded', 'true')
    expect(pageErrors(consoleErrors)).toEqual([])
  } finally {
    await app.close()
  }
})

