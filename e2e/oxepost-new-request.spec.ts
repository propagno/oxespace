import { expect, test, type Page } from '@playwright/test'
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { launchApp, openDemoWorkspace } from './helpers/launch'

/**
 * T62 (1.4.1, found on v1.4.0): "New request" seemed to do nothing. It only reset an in-memory draft, and a freshly
 * opened OxePost already shows a blank one, so nothing changed on screen and nothing was saved. Now it creates the
 * request as a file of the workspace and opens it in the editor, whether .oxespace/requests exists yet or not.
 */
const sidebar = (page: Page) => page.getByRole('complementary', { name: 'OxePost sidebar' })
const pageErrors = (lines: string[]): string[] => lines.filter(line => line.startsWith('pageerror:'))
const httpFiles = (dir: string): string[] => existsSync(dir) ? readdirSync(dir).filter(name => name.endsWith('.http')).sort() : []

async function openOxePost(page: Page): Promise<void> {
  await page.keyboard.press('Control+5')
  await expect(page.getByRole('navigation', { name: 'Application view' }).getByRole('button', { name: 'OxePost' })).toHaveAttribute('aria-pressed', 'true')
}

async function newRequest(page: Page): Promise<void> {
  await sidebar(page).getByRole('button', { name: 'New request' }).first().click()
}

test('New request creates the request and the folder when .oxespace/requests does not exist yet', async () => {
  test.setTimeout(120_000)
  const { app, page, workspaceRoot, consoleErrors } = await launchApp()
  const requests = join(workspaceRoot, '.oxespace', 'requests')
  try {
    expect(existsSync(requests)).toBe(false)
    await openDemoWorkspace(page, workspaceRoot)
    await openOxePost(page)
    await expect(sidebar(page)).toContainText('No requests yet')

    await newRequest(page)
    // Saved as a file, listed and selected, and open in the editor with its name ready to type over.
    await expect.poll(() => httpFiles(requests)).toEqual(['new-request.http'])
    await expect(sidebar(page).getByRole('button', { name: /GET\s*New request/ })).toHaveAttribute('aria-current', 'page')
    await expect(page.getByLabel('Request name')).toHaveValue('New request')
    await expect(page.getByLabel('Request name')).toBeFocused()
    await expect(page.getByRole('button', { name: 'Saved', exact: true })).toBeVisible()

    // A second one never overwrites the first.
    await newRequest(page)
    await expect.poll(() => httpFiles(requests)).toEqual(['new-request-2.http', 'new-request.http'])
    await expect(sidebar(page).getByRole('button', { name: /GET\s*New request/ })).toHaveCount(2)

    // Typing a name and saving renames the file with it.
    await page.getByLabel('Request name').fill('List users')
    await page.getByRole('button', { name: 'Save', exact: true }).click()
    await expect.poll(() => httpFiles(requests)).toEqual(['list-users.http', 'new-request.http'])

    // The command palette's "New API request" takes the same path.
    await page.keyboard.press('Control+K')
    await page.getByPlaceholder('Search files and commands…').fill('New API request')
    await page.locator('[cmdk-item][data-value^="cmd-"]').first().click()
    await expect.poll(() => httpFiles(requests)).toEqual(['list-users.http', 'new-request-2.http', 'new-request.http'])
    await expect(page.getByLabel('Request name')).toBeFocused()
    expect(pageErrors(consoleErrors)).toEqual([])
  } finally {
    await app.close()
  }
})

test('New request adds to an existing .oxespace/requests folder and asks before dropping unsaved changes', async () => {
  test.setTimeout(120_000)
  const { app, page, workspaceRoot, consoleErrors } = await launchApp()
  const requests = join(workspaceRoot, '.oxespace', 'requests')
  mkdirSync(requests, { recursive: true })
  writeFileSync(join(requests, 'health.http'), '# name: Health\nGET http://127.0.0.1:9/health\n')
  try {
    await openDemoWorkspace(page, workspaceRoot)
    await openOxePost(page)
    await sidebar(page).getByRole('button', { name: /GET\s*Health/ }).click()
    await expect(page.getByLabel('Request name')).toHaveValue('Health')

    // Unsaved changes: New asks first, and Cancel keeps them and creates nothing.
    await page.getByLabel('URL', { exact: true }).fill('http://127.0.0.1:9/changed')
    await newRequest(page)
    const discard = page.getByRole('dialog', { name: 'Discard changes?' })
    await discard.getByRole('button', { name: 'Cancel' }).click()
    await expect(page.getByLabel('URL', { exact: true })).toHaveValue('http://127.0.0.1:9/changed')
    expect(httpFiles(requests)).toEqual(['health.http'])

    // Discarding creates the new one next to the existing request, which is left as it was on disk.
    await newRequest(page)
    await page.getByRole('dialog', { name: 'Discard changes?' }).getByRole('button', { name: 'Discard changes' }).click()
    await expect.poll(() => httpFiles(requests)).toEqual(['health.http', 'new-request.http'])
    await expect(sidebar(page).getByRole('button', { name: /GET\s*New request/ })).toHaveAttribute('aria-current', 'page')
    await expect(page.getByLabel('Request name')).toHaveValue('New request')
    expect(readFileSync(join(requests, 'health.http'), 'utf8')).toContain('/health')
    expect(pageErrors(consoleErrors)).toEqual([])
  } finally {
    await app.close()
  }
})
