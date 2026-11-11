import { _electron as electron, expect, test } from '@playwright/test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

test('the first-run screen presents the three setup steps, opens a workspace wizard and exits to OxeCode persistently', async () => {
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
    // Load again so FirstRun reads the CLIs from the handlers above.
    await page.reload()

    const guide = page.getByTestId('first-run')
    await expect(guide).toBeVisible()
    await expect(guide.getByRole('heading', { name: 'Open a project folder' })).toBeVisible()
    await expect(guide.getByRole('heading', { name: 'Connect an agent' })).toBeVisible()
    await expect(guide.getByRole('heading', { name: 'Start your first conversation' })).toBeVisible()
    await expect(guide).toContainText('Claude Code')
    await expect(guide).toContainText('Ready')
    await expect(guide.getByRole('button', { name: 'How to install' })).toBeVisible()
    await expect(guide.getByRole('button', { name: 'New conversation' })).toBeEnabled()
    await expect(guide).toContainText('Or open a mode on its own')
    await page.screenshot({ path: test.info().outputPath('first-run-guide.png') })

    await guide.getByTestId('btn-new-workspace').click()
    const wizard = page.getByRole('dialog', { name: 'Create new workspace' })
    await expect(wizard).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(wizard).toBeHidden()

    // Opening a mode on its own exits first-run and remembers the view across reloads.
    await guide.getByRole('button', { name: /^OxeCode\b/ }).click()
    await expect(guide).toBeHidden()
    await page.reload()
    await expect(page.getByText('Select a folder to start your first agentic terminal workspace.')).toBeVisible()
    await expect(page.getByTestId('first-run')).toHaveCount(0)
  } finally {
    await app.close()
  }
})
