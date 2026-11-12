import { modeButton } from './helpers/modes'
import { _electron as electron, expect, test } from '@playwright/test'
import { mkdtempSync, mkdirSync, renameSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'

test('Thread projects and conversations survive restart without creating Code workspaces', async () => {
  test.setTimeout(120000)
  const root = mkdtempSync(join(tmpdir(), 'oxespace-thread-independent-'))
  const first = join(root, 'first-project'), second = join(root, 'second-project'), codeOnly = join(root, 'code-only')
  mkdirSync(first); mkdirSync(second); mkdirSync(codeOnly)
  for (const directory of [first, second, codeOnly]) execFileSync('git', ['init', directory], { windowsHide: true, stdio: 'ignore' })
  const env = { ...process.env, OXESPACE_DISABLE_SINGLE_INSTANCE: '1', OXESPACE_E2E_MOCK_NATIVE: '0', OXESPACE_DB_PATH: join(root, 'app.sqlite3') }
  const launch = () => electron.launch({ args: [join(process.cwd(), 'e2e/electron-main.cjs')], env })
  let app = await launch()
  try {
    let page = await app.firstWindow()
    await modeButton(page, 'thread').click()
    const add = async (path: string) => {
      await page.locator('.thread-navigation').getByRole('button', { name: 'Add project' }).click()
      await page.getByRole('textbox', { name: 'Project folder path' }).fill(path)
      await page.getByRole('dialog', { name: 'Add project' }).getByRole('button', { name: 'Add project', exact: true }).click()
      await expect(page.getByRole('dialog', { name: 'Add project' })).toHaveCount(0).catch(async () => {
        throw Error(await page.getByRole('dialog', { name: 'Add project' }).innerText())
      })
    }
    await add(first); await add(second); await add(first)
    await expect(page.locator('.thread-project-group')).toHaveCount(2)
    const codeId = await page.evaluate(async directory => (await window.oxe.workspace.create({ rootPath: directory, autoStart: false })).id, codeOnly)
    await expect(page.locator('.thread-project-group')).toHaveCount(2)
    expect(await page.evaluate(async () => (await window.oxe.workspace.list()).length)).toBe(1)
    await modeButton(page, 'code').click()
    await page.evaluate(async id => window.oxe.workspace.delete(id), codeId)
    expect(await page.evaluate(async () => (await window.oxe.workspace.list()).length)).toBe(0)
    await expect(page.locator('[data-testid="sidebar-workspace-item"]')).toHaveCount(0)
    await modeButton(page, 'thread').click()
    await expect(page.locator('.thread-project-group')).toHaveCount(2)
    await page.getByRole('button', { name: 'New conversation in first-project' }).click()
    await page.getByRole('dialog', { name: 'New conversation' }).getByRole('button', { name: 'Create conversation' }).click()
    await expect(page.locator('.thread-session-title')).toContainText(['New conversation'])
    await page.getByRole('button', { name: 'Actions for second-project' }).click()
    await page.getByRole('menuitem', { name: 'Remove project…' }).click()
    await page.getByRole('dialog', { name: 'Remove this project?' }).getByRole('button', { name: 'Remove project', exact: true }).click()
    await expect(page.locator('.thread-project-group')).toHaveCount(1)
    await modeButton(page, 'code').click()
    await expect(page.locator('[data-testid="sidebar-workspace-item"]')).toHaveCount(0)
    await app.close()

    app = await launch()
    page = await app.firstWindow()
    await page.getByTestId('btn-new-workspace').waitFor({ state: 'visible' }).catch(async cause => {
      // This wait timed out once in several runs on Linux (four pull requests on 2026-11-12) with nothing to say why.
      // The failure now says what the window showed after the relaunch.
      const relaunched = page
      const seen = await relaunched.evaluate(() => ({ url: location.href, title: document.title, ready: document.readyState, text: (document.body?.innerText ?? '').slice(0, 600) })).catch(error => ({ unreadable: String(error) }))
      throw new Error(`${(cause as Error).message}
window after relaunch: ${JSON.stringify(seen)}
windows: ${JSON.stringify(app.windows().map(window => window.url()))}`)
    })
    await modeButton(page, 'thread').click()
    await expect(page.locator('.thread-project-group')).toHaveCount(1)
    await expect(page.locator('.thread-session-title')).toContainText(['New conversation'])
    const removed = page.getByRole('region', { name: 'Removed projects' })
    await removed.getByRole('button', { name: 'second-project Restore' }).click()
    await expect(page.locator('.thread-project-group')).toHaveCount(2)
    const relocated = join(root, 'second-relocated')
    for (let attempt = 0; attempt < 10; attempt++) {
      try { renameSync(second, relocated); break }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EBUSY' || attempt === 9) throw error
        await page.waitForTimeout(200)
      }
    }
    await page.getByRole('button', { name: 'Actions for second-project' }).click()
    await page.getByRole('menuitem', { name: 'Project settings' }).click()
    const settings = page.getByRole('dialog', { name: 'OxeChat project · second-project' })
    await expect(settings.locator('.thread-project-current-path')).toContainText(/second-project$/)
    await expect(settings.getByText('Relink missing directory')).toBeVisible()
    await expect(settings.getByRole('textbox', { name: 'New project directory' })).toBeVisible()
    await expect(settings.getByText(/ENOENT/)).toHaveCount(0)
    await settings.getByRole('textbox', { name: 'New project directory' }).fill(relocated)
    await settings.getByRole('button', { name: 'Relink directory' }).click()
    const relinked = page.getByRole('dialog', { name: 'OxeChat project · second-relocated' })
    await expect(relinked).toBeVisible()
    await page.getByRole('dialog', { name: 'OxeChat project · second-relocated' }).getByRole('button', { name: 'Close', exact: true }).click()
    await expect(page.getByRole('button', { name: 'New conversation in second-relocated' })).toBeVisible()
    await modeButton(page, 'code').click()
    await expect(page.locator('[data-testid="sidebar-workspace-item"]')).toHaveCount(0)
    await modeButton(page, 'thread').click()
    await page.getByRole('button', { name: 'Actions for second-relocated' }).click()
    await page.getByRole('menuitem', { name: 'Open in OxeCode' }).click()
    await expect(page.locator('[data-testid="sidebar-workspace-item"]')).toHaveCount(1)
    await modeButton(page, 'thread').click()
    await expect(page.locator('.thread-project-group')).toHaveCount(2)
  } finally { await app.close() }
})
