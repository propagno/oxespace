import { _electron as electron, expect, test } from '@playwright/test'
import { mkdtempSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

test('Code distinguishes terminal IDs from native sessions and exposes resume IDs', async () => {
  const root = mkdtempSync(join(tmpdir(), 'oxe-session-identity-'))
  const repo = join(root, 'repo'); mkdirSync(repo)
  const app = await electron.launch({ args: [join(process.cwd(), 'e2e/electron-main.cjs')], env: {
    ...process.env, OXESPACE_DISABLE_SINGLE_INSTANCE: '1', OXESPACE_E2E_MOCK_NATIVE: '1', OXESPACE_DB_PATH: join(root, 'db.sqlite3')
  } })
  try {
    const page = await app.firstWindow()
    await page.setViewportSize({ width: 1024, height: 720 })
    await app.evaluate(({ ipcMain }) => {
      ipcMain.removeHandler('session:list')
      ipcMain.handle('session:list', (_event, input: { provider: string }) => input.provider === 'codex' ? [{
        provider: 'codex', sessionId: '019f677a-bde3-7f52-94a4-28ad76da8faa', firstMessagePreview: 'Review the authentication flow', modelId: 'gpt-test', requestCount: 8, lastUpdatedMs: Date.now(), sessionStartedAtMs: Date.now() - 3600000
      }] : [])
      ipcMain.removeHandler('clipboard:write-text')
      ipcMain.handle('clipboard:write-text', (_event, value: string) => {
        ;(globalThis as typeof globalThis & { __copiedSessionText?: string }).__copiedSessionText = value
        return true
      })
    })
    await page.getByTestId('btn-new-workspace').click()
    await page.getByTestId('wizard-dir-input').fill(repo)
    await page.getByTestId('wizard-layout-card-1').click()
    await page.getByTestId('wizard-launch-btn').click()
    await page.getByRole('button', { name: 'More pane actions' }).first().click()
    await page.getByRole('menuitem', { name: 'Details' }).click()
    const details = page.getByRole('dialog', { name: 'Terminal details' })
    await expect(details).toBeVisible()
    await expect(details.getByText('Internal IDs and terminal process')).toBeVisible()
    await expect(details.getByText('PTY session ID (terminal)')).toBeHidden()
    await details.screenshot({ path: test.info().outputPath('terminal-details.png') })
    await details.getByText('Internal IDs and terminal process').click()
    await expect(details.getByText('PTY session ID (terminal)')).toBeVisible()
    await details.getByRole('button', { name: 'Find Codex or Claude sessions' }).click()
    const finder = page.getByRole('dialog', { name: 'Codex and Claude sessions' })
    await expect(finder.getByText('Review the authentication flow')).toBeVisible()
    await expect(finder.getByText('019f677a-bde3-7f52-94a4-28ad76da8faa')).toBeVisible()
    await finder.screenshot({ path: test.info().outputPath('provider-sessions.png') })
    await finder.getByRole('searchbox', { name: 'Search native sessions' }).fill('missing')
    await expect(finder.getByText('No session matches the search.')).toBeVisible()
    await finder.getByRole('searchbox', { name: 'Search native sessions' }).fill('authentication')
    await expect(finder.getByText('Review the authentication flow')).toBeVisible()
    await finder.getByRole('button', { name: 'Copy session ID codex 019f677a-bde3-7f52-94a4-28ad76da8faa' }).click()
    await expect(finder.getByRole('button', { name: 'Copy session ID codex 019f677a-bde3-7f52-94a4-28ad76da8faa' })).toContainText('Copied')
    expect(await app.evaluate(() => (globalThis as typeof globalThis & { __copiedSessionText?: string }).__copiedSessionText)).toBe('019f677a-bde3-7f52-94a4-28ad76da8faa')
    await finder.getByRole('button', { name: 'Copy command to resume codex 019f677a-bde3-7f52-94a4-28ad76da8faa' }).click()
    await expect(finder.getByRole('button', { name: 'Copy command to resume codex 019f677a-bde3-7f52-94a4-28ad76da8faa' })).toContainText('Copied')
    expect(await app.evaluate(() => (globalThis as typeof globalThis & { __copiedSessionText?: string }).__copiedSessionText)).toBe('codex resume 019f677a-bde3-7f52-94a4-28ad76da8faa')
  } finally { await app.close() }
})
