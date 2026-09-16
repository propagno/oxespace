import { _electron as electron, expect, test } from '@playwright/test'
import { mkdtempSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

test('coordination consent and result UI follows settings layout', async () => {
  const root = mkdtempSync(join(tmpdir(), 'oxe-coordination-ui-'))
  const source = join(root, 'source'); mkdirSync(source)
  const app = await electron.launch({ args: [join(process.cwd(), 'e2e/electron-main.cjs')], env: {
    ...process.env, OXESPACE_DISABLE_SINGLE_INSTANCE: '1', OXESPACE_E2E_MOCK_NATIVE: '1', OXESPACE_DB_PATH: join(root, 'db.sqlite3')
  } })
  try {
    const page = await app.firstWindow()
    await page.getByTestId('btn-new-workspace').click()
    await page.getByTestId('wizard-dir-input').fill(source)
    await page.getByTestId('wizard-launch-btn').click()
    const ws = await page.evaluate(async () => (await window.oxe.workspace.list())[0])
    // Renderer test only; real Git/SQLite/authorization are covered in integration tests.
    await app.evaluate(({ ipcMain }, id) => {
      let route: { workspaceId: string; name: string; rootPath: string; expiresAt: number; allowEvidence: boolean } | undefined
      ipcMain.removeHandler('delegation:status')
      ipcMain.handle('delegation:status', () => ({ enabled: true, targets: route ? [route] : [], tasks: [{
        id: 'task', workspaceId: 'destination', originWorkspaceId: id, objective: 'Analyze workflows', branch: 'oxe/analyze',
        state: 'review', mode: 'analysis', lastReport: 'Verified report: remove duplicate checklists; preserve validation.',
        handoff: 'Selected evidence from source repository'
      }] }))
      ipcMain.removeHandler('delegation:configure-target')
      ipcMain.handle('delegation:configure-target', (_event, _ws, path, enabled, allowEvidence) => {
        route = enabled ? { workspaceId: 'destination', name: 'configuration', rootPath: path, expiresAt: Date.now() + 86400000, allowEvidence } : undefined
      })
    }, ws.id)
    await page.getByTestId('btn-open-tools').click()
    await page.getByTestId('tools-modal').getByRole('menuitem', { name: 'Workspace Settings', exact: true }).click()
    const modal = page.getByRole('dialog', { name: 'Settings', exact: true })
    await modal.getByRole('navigation', { name: 'Settings categories' }).getByRole('button', { name: /^Agent delegation/ }).click()
    const authorize = modal.getByRole('button', { name: 'Authorize local destination' })
    await modal.getByText('Manage authorized destinations (0)').click()
    await modal.getByLabel('Destination repository path').fill(join(root, 'configuration'))
    await expect(authorize).toBeDisabled()
    await modal.getByRole('checkbox', { name: /I authorize task handoffs/ }).check()
    await modal.getByRole('checkbox', { name: /Allow selected committed/ }).check()
    await expect(authorize).toBeDisabled() // changing scope requires renewed consent
    await modal.getByRole('checkbox', { name: /I authorize task handoffs/ }).check()
    await authorize.click()
    await expect(modal.getByText(/Evidence allowed/)).toBeVisible()
    for (const size of [{ width: 850, height: 650 }, { width: 1280, height: 720 }, { width: 1920, height: 1080 }]) {
      await page.setViewportSize(size)
      await modal.locator('.ws-settings-main').evaluate(el => { el.scrollTop = 0 })
      expect(await modal.evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true)
      await modal.screenshot({ path: test.info().outputPath(`coordination-${size.width}.png`) })
    }
    await modal.getByRole('button', { name: 'Revoke destination' }).click()
    await expect(modal.getByRole('button', { name: 'Revoke destination' })).toHaveCount(0)
    await expect(modal.getByText(/Verified report:/)).toBeVisible()
    await modal.getByText(/Verified report:/).scrollIntoViewIfNeeded()
    await modal.screenshot({ path: test.info().outputPath('coordination-result.png') })
  } finally { await app.close() }
})
