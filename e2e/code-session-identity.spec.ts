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
    await page.getByRole('menuitem', { name: 'Detalhes' }).click()
    const details = page.getByRole('dialog', { name: 'Detalhes do terminal' })
    await expect(details).toBeVisible()
    await expect(details.getByText('IDs internos e processo do terminal')).toBeVisible()
    await expect(details.getByText('ID da sessão PTY (terminal)')).toBeHidden()
    await details.screenshot({ path: test.info().outputPath('terminal-details.png') })
    await details.getByText('IDs internos e processo do terminal').click()
    await expect(details.getByText('ID da sessão PTY (terminal)')).toBeVisible()
    await details.getByRole('button', { name: 'Encontrar sessões do Codex ou Claude' }).click()
    const finder = page.getByRole('dialog', { name: 'Sessões do Codex e Claude' })
    await expect(finder.getByText('Review the authentication flow')).toBeVisible()
    await expect(finder.getByText('019f677a-bde3-7f52-94a4-28ad76da8faa')).toBeVisible()
    await finder.screenshot({ path: test.info().outputPath('provider-sessions.png') })
    await finder.getByRole('searchbox', { name: 'Buscar sessão nativa' }).fill('missing')
    await expect(finder.getByText('Nenhuma sessão corresponde à busca.')).toBeVisible()
    await finder.getByRole('searchbox', { name: 'Buscar sessão nativa' }).fill('authentication')
    await expect(finder.getByText('Review the authentication flow')).toBeVisible()
    await finder.getByRole('button', { name: 'Copiar ID da sessão codex 019f677a-bde3-7f52-94a4-28ad76da8faa' }).click()
    await expect(finder.getByRole('button', { name: 'Copiar ID da sessão codex 019f677a-bde3-7f52-94a4-28ad76da8faa' })).toContainText('Copiado')
    expect(await app.evaluate(() => (globalThis as typeof globalThis & { __copiedSessionText?: string }).__copiedSessionText)).toBe('019f677a-bde3-7f52-94a4-28ad76da8faa')
    await finder.getByRole('button', { name: 'Copiar comando para retomar codex 019f677a-bde3-7f52-94a4-28ad76da8faa' }).click()
    await expect(finder.getByRole('button', { name: 'Copiar comando para retomar codex 019f677a-bde3-7f52-94a4-28ad76da8faa' })).toContainText('Copiado')
    expect(await app.evaluate(() => (globalThis as typeof globalThis & { __copiedSessionText?: string }).__copiedSessionText)).toBe('codex resume 019f677a-bde3-7f52-94a4-28ad76da8faa')
  } finally { await app.close() }
})
