import { _electron as electron, expect, test } from '@playwright/test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

test('the first-run guide walks the steps, opens a workspace and stays dismissed', async () => {
  test.setTimeout(90000)
  const root = mkdtempSync(join(tmpdir(), 'oxe-first-run-'))
  const app = await electron.launch({ args: [join(process.cwd(), 'e2e/electron-main.cjs')], env: {
    ...process.env, OXESPACE_DISABLE_SINGLE_INSTANCE: '1', OXESPACE_E2E_MOCK_NATIVE: '1', OXESPACE_DB_PATH: join(root, 'app.sqlite3')
  } })
  try {
    const page = await app.firstWindow()
    await app.evaluate(({ ipcMain }) => {
      for (const channel of ['agent:get-readiness', 'agent:discover']) ipcMain.removeHandler(channel)
      const readiness = [{ provider: 'claude', command: 'claude', status: 'ready' }, { provider: 'codex', command: 'codex', status: 'missing' }]
      ipcMain.handle('agent:get-readiness', () => readiness)
      ipcMain.handle('agent:discover', () => readiness)
    })
    // Load again so the guide reads the CLIs from the handlers above.
    await page.reload()

    const guide = page.getByRole('region', { name: 'Before you start' })
    await expect(guide).toBeVisible()
    await expect(guide.getByRole('heading', { name: 'Agent CLIs (done)' })).toBeVisible()
    await expect(guide).toContainText('Claude Code is ready')
    await expect(guide).toContainText('1 of 3 done')
    await expect(guide).toContainText('gh auth login')
    await page.screenshot({ path: test.info().outputPath('first-run-guide.png') })

    await guide.getByRole('button', { name: 'Skip for now' }).click()
    await expect(guide).toContainText('2 of 3 done')
    await guide.getByRole('button', { name: 'Mark as done' }).click()
    await expect(guide.getByRole('heading', { name: 'GitHub (optional) (done)' })).toBeVisible()

    await guide.getByRole('button', { name: 'New Code workspace' }).click()
    const wizard = page.getByRole('dialog', { name: 'Create new workspace' })
    await expect(wizard).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(wizard).toBeHidden()

    // Progress survives a reload; dismissing hides the guide for good.
    await page.reload()
    await expect(guide).toContainText('2 of 3 done')
    await guide.getByRole('button', { name: 'Hide this guide' }).click()
    await expect(guide).toBeHidden()
    await page.reload()
    await expect(page.getByText('Select a folder to start your first agentic terminal workspace.')).toBeVisible()
    await expect(page.getByTestId('first-run-checklist')).toHaveCount(0)
  } finally {
    await app.close()
  }
})
