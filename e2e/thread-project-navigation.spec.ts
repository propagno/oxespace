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
    await expect(page.locator('.thread-session-title')).toContainText(['New thread'])
    await page.getByRole('button', { name: 'Actions for second-project' }).click()
    await page.getByRole('menuitem', { name: 'Remove project…' }).click()
    await page.getByRole('dialog', { name: 'Remove this project?' }).getByRole('button', { name: 'Remove project', exact: true }).click()
    await expect(page.locator('.thread-project-group')).toHaveCount(1)
    await modeButton(page, 'code').click()
    await expect(page.locator('[data-testid="sidebar-workspace-item"]')).toHaveCount(0)
    await app.close()

    app = await launch()
    page = await app.firstWindow()
    await page.getByTestId('btn-new-workspace').waitFor({ state: 'visible' })
    await modeButton(page, 'thread').click()
    await expect(page.locator('.thread-project-group')).toHaveCount(1)
    await expect(page.locator('.thread-session-title')).toContainText(['New thread'])
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
    // A missing directory cannot be indexed.
    await expect(settings.getByRole('checkbox', { name: /Index this project/ })).toBeDisabled()
    const checkboxLayout = await settings.locator('.thread-project-check').first().evaluate(label => {
      const box = label.querySelector('input')!.getBoundingClientRect()
      const text = label.getBoundingClientRect()
      return { width: box.width, height: box.height, left: box.left - text.left, labelWidth: text.width }
    })
    expect(checkboxLayout.width).toBeCloseTo(16, 0)
    expect(checkboxLayout.height).toBeCloseTo(16, 0)
    expect(checkboxLayout.left).toBeLessThan(12)
    expect(checkboxLayout.labelWidth).toBeGreaterThan(300)
    await expect(settings.getByText('Relink missing directory')).toBeVisible()
    await expect(settings.getByRole('textbox', { name: 'New project directory' })).toBeVisible()
    await expect(settings.getByText(/ENOENT/)).toHaveCount(0)
    await settings.getByRole('textbox', { name: 'New project directory' }).fill(relocated)
    await settings.getByRole('button', { name: 'Relink directory' }).click()
    const relinked = page.getByRole('dialog', { name: 'OxeChat project · second-relocated' })
    await expect(relinked).toBeVisible()
    // Semantic search stays off until the person turns it on for this project.
    const semantic = relinked.getByRole('checkbox', { name: /Index this project/ })
    await expect(semantic).toBeEnabled()
    await expect(semantic).not.toBeChecked()
    await semantic.click()
    await expect(semantic).toBeChecked()
    await expect(relinked.getByRole('status')).toHaveText(/files (indexed|so far)/)
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
