import { _electron as electron, expect, test } from '@playwright/test'
import { mkdtempSync, mkdirSync, realpathSync, renameSync } from 'node:fs'
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
    await page.getByRole('button', { name: 'Thread', exact: true }).click()
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
    await page.getByRole('button', { name: 'Code', exact: true }).click()
    await page.evaluate(async id => window.oxe.workspace.delete(id), codeId)
    expect(await page.evaluate(async () => (await window.oxe.workspace.list()).length)).toBe(0)
    await expect(page.locator('[data-testid="sidebar-workspace-item"]')).toHaveCount(0)
    await page.getByRole('button', { name: 'Thread', exact: true }).click()
    await expect(page.locator('.thread-project-group')).toHaveCount(2)
    await page.getByRole('button', { name: 'New thread in first-project' }).click()
    await page.getByRole('dialog', { name: 'New thread' }).getByRole('button', { name: 'Create thread' }).click()
    await expect(page.locator('.thread-session-title')).toContainText(['New thread'])
    await page.getByRole('button', { name: 'Remove project second-project' }).click()
    await page.getByRole('dialog', { name: 'Remove project' }).getByRole('button', { name: 'Remove project', exact: true }).click()
    await expect(page.locator('.thread-project-group')).toHaveCount(1)
    await page.getByRole('button', { name: 'Code', exact: true }).click()
    await expect(page.locator('[data-testid="sidebar-workspace-item"]')).toHaveCount(0)
    await app.close()

    app = await launch()
    page = await app.firstWindow()
    await page.getByRole('button', { name: 'Thread', exact: true }).click()
    await expect(page.locator('.thread-project-group')).toHaveCount(1)
    await expect(page.locator('.thread-session-title')).toContainText(['New thread'])
    const removed = page.getByRole('region', { name: 'Removed projects' })
    await removed.getByRole('button', { name: 'second-project Restore' }).click()
    await expect(page.locator('.thread-project-group')).toHaveCount(2)
    const canonicalSecond = realpathSync(second)
    const relocated = join(root, 'second-relocated')
    for (let attempt = 0; attempt < 10; attempt++) {
      try { renameSync(second, relocated); break }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EBUSY' || attempt === 9) throw error
        await page.waitForTimeout(200)
      }
    }
    await page.getByRole('button', { name: 'Settings for second-project' }).click()
    const settings = page.getByRole('dialog', { name: 'Thread project · second-project' })
    await expect(settings).toContainText(canonicalSecond)
    const checkboxLayout = await settings.locator('.thread-project-check').first().evaluate(label => {
      const box = label.querySelector('input')!.getBoundingClientRect()
      const text = label.getBoundingClientRect()
      return { width: box.width, height: box.height, left: box.left - text.left, labelWidth: text.width }
    })
    expect(checkboxLayout.width).toBe(16)
    expect(checkboxLayout.height).toBe(16)
    expect(checkboxLayout.left).toBeLessThan(12)
    expect(checkboxLayout.labelWidth).toBeGreaterThan(300)
    await expect(settings.getByText('Change project directory')).toBeVisible()
    await expect(settings.getByRole('textbox', { name: 'New project directory' })).not.toBeVisible()
    await settings.getByText('Change project directory').click()
    await settings.getByRole('textbox', { name: 'New project directory' }).fill(relocated)
    await settings.getByRole('button', { name: 'Relink directory' }).click()
    await expect(page.getByRole('dialog', { name: 'Thread project · second-relocated' })).toBeVisible()
    await page.getByRole('button', { name: 'Done' }).click()
    await expect(page.getByRole('button', { name: 'New thread in second-relocated' })).toBeVisible()
    await page.getByRole('button', { name: 'Code', exact: true }).click()
    await expect(page.locator('[data-testid="sidebar-workspace-item"]')).toHaveCount(0)
    await page.getByRole('button', { name: 'Thread', exact: true }).click()
    await page.getByRole('button', { name: 'Open second-relocated in Code' }).click()
    await expect(page.locator('[data-testid="sidebar-workspace-item"]')).toHaveCount(1)
    await page.getByRole('button', { name: 'Thread', exact: true }).click()
    await expect(page.locator('.thread-project-group')).toHaveCount(2)
  } finally { await app.close() }
})
