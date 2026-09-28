import { _electron as electron, expect, test } from '@playwright/test'
import { mkdtempSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

test('Thread project visibility is independent and re-adding a folder does not duplicate Code workspaces', async () => {
  test.setTimeout(120000)
  const root = mkdtempSync(join(tmpdir(), 'oxespace-thread-project-nav-'))
  const first = join(root, 'first-project'), second = join(root, 'second-project')
  mkdirSync(first); mkdirSync(second)
  const app = await electron.launch({ args: [join(process.cwd(), 'e2e/electron-main.cjs')], env: {
    ...process.env, OXESPACE_DISABLE_SINGLE_INSTANCE: '1', OXESPACE_E2E_MOCK_NATIVE: '1', OXESPACE_DB_PATH: join(root, 'app.sqlite3')
  } })
  try {
    const page = await app.firstWindow()
    await app.evaluate(({ ipcMain }) => {
      const workspaces: Record<string, unknown>[] = []
      ipcMain.removeHandler('workspace:create')
      ipcMain.handle('workspace:create', (_event, input: { rootPath: string }) => {
        const existing = workspaces.find(item => String(item.rootPath).replaceAll('\\', '/').toLowerCase() === input.rootPath.replaceAll('\\', '/').toLowerCase())
        if (existing) return existing
        const workspace = { id: `workspace-${workspaces.length + 1}`, rootPath: input.rootPath, name: input.rootPath.split(/[\\/]/).at(-1), layout: '1x1', layoutPreset: 1,
          themeId: 'midnight', uiDensity: 'compact', defaultShellProfileId: 'builtin-claude', autoStart: false, isActive: false, panes: [] }
        workspaces.push(workspace)
        return workspace
      })
      ipcMain.removeHandler('thread:projects')
      ipcMain.handle('thread:projects', () => ({ projects: workspaces.map(workspace => ({ projectId: String(workspace.id), displayName: String(workspace.name),
        identityLabel: String(workspace.rootPath), contexts: [{ workspaceId: workspace.id, rootPath: workspace.rootPath, label: workspace.name }] })), unavailable: [] }))
    })
    await page.getByRole('button', { name: 'Thread', exact: true }).click()
    const add = async (path: string) => {
      await page.locator('.thread-navigation').getByRole('button', { name: 'Add project' }).click()
      await page.getByRole('textbox', { name: 'Project folder path' }).fill(path)
      await page.getByRole('dialog', { name: 'Add project' }).getByRole('button', { name: 'Add project', exact: true }).click()
      await expect(page.getByRole('dialog', { name: 'Add project' })).toHaveCount(0)
    }
    await add(first)
    await add(second)
    await expect(page.locator('.thread-project-group')).toHaveCount(2)
    await add(first)
    await expect(page.locator('.thread-project-group')).toHaveCount(2)

    for (const name of ['first-project', 'second-project']) {
      await page.getByRole('button', { name: `Remove project ${name}` }).click()
      await page.getByRole('dialog', { name: 'Remove project' }).getByRole('button', { name: 'Remove project', exact: true }).click()
    }
    await expect(page.locator('.thread-project-group')).toHaveCount(0)
    const removed = page.getByRole('region', { name: 'Removed projects' })
    await expect(removed.getByRole('button')).toHaveCount(2)
    await removed.getByRole('button', { name: 'first-project Restore' }).click()
    await expect(page.locator('.thread-project-group')).toHaveCount(1)
    await expect(removed.getByRole('button', { name: 'second-project Restore' })).toBeVisible()

    await page.locator('.thread-navigation').getByRole('button', { name: 'Code', exact: true }).click()
    await expect(page.locator('[data-testid="sidebar-workspace-item"]')).toHaveCount(2)
  } finally { await app.close() }
})
