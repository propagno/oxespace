import { expect, test } from '@playwright/test'
import { join } from 'node:path'
import { launchApp } from './helpers/launch'

// F20 (#228 P2-6): the wizard no longer turns a folder that does not exist into a workspace. Main refuses it,
// the wizard says why next to the folder field and stays open with the typed path; a real folder then works.
test('the new-workspace wizard refuses a missing folder and accepts a real one', async () => {
  test.setTimeout(60_000)
  const { app, page, root, workspaceRoot, consoleErrors } = await launchApp()
  try {
    // The folder picker answers with the real demo folder, as if the person chose it in the system dialog.
    await app.evaluate(({ ipcMain }, folder) => {
      ipcMain.removeHandler('workspace:pick-folder')
      ipcMain.handle('workspace:pick-folder', () => folder)
    }, workspaceRoot)

    const missing = join(root, 'nao', 'existe', 'pasta')
    await page.getByTestId('btn-new-workspace').click()
    const wizard = page.getByRole('dialog', { name: 'Create new workspace' })
    const field = page.getByTestId('wizard-dir-input')
    await field.fill(missing)
    await page.getByTestId('wizard-launch-btn').click()

    const refusal = page.getByTestId('wizard-root-refusal')
    await expect(refusal).toHaveAttribute('data-refusal', 'notFound')
    await expect(refusal.getByRole('alert')).toHaveText(`The folder ${missing} does not exist. Create it or choose another folder.`)
    await expect(refusal).toContainText('Create it in your file manager')
    await expect(wizard).toBeVisible()
    await expect(field).toHaveValue(missing)
    await expect(field).toHaveAttribute('aria-invalid', 'true')
    expect(await page.evaluate(() => window.oxe.workspace.list())).toEqual([])

    await refusal.getByRole('button', { name: 'Choose another folder' }).click()
    await expect(field).toHaveValue(workspaceRoot)
    await expect(field).toBeFocused()
    await expect(refusal).toHaveCount(0)

    await page.getByTestId('wizard-launch-btn').click()
    await page.waitForSelector('[data-testid="workspace-grid"], [data-testid="workspace-split-grid"]', { timeout: 10_000 })
    await expect(wizard).toHaveCount(0)
    const created = await page.evaluate(() => window.oxe.workspace.list())
    expect(created.map((workspace) => workspace.rootPath)).toEqual([workspaceRoot])
    expect(consoleErrors.filter(line => line.includes('pageerror'))).toEqual([])
  } finally {
    await app.close()
  }
})
