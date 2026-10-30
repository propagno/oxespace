import { modeButton } from './helpers/modes'
import { _electron as electron, expect, test } from '@playwright/test'
import { mkdtempSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// Titles like the ones that were cut to "ACOMPANHAM…" at a larger zoom.
const TITLES = [
  'ACOMPANHAMENTO DA MIGRAÇÃO DO SERVIÇO DE DOCUMENTOS PARA O NOVO BANCO',
  'Revisar a política de permissões do agente antes do merge',
  'Fix flaky e2e',
  'Investigar por que a fila de mensagens fica parada depois de um turno com falha'
]

test('the Thread sidebar keeps rows readable at every width and zoom', async () => {
  test.setTimeout(120_000)
  const root = mkdtempSync(join(tmpdir(), 'oxe-sidebar-scaling-'))
  const repo = join(root, 'repo'); mkdirSync(repo)
  const app = await electron.launch({ args: [join(process.cwd(), 'e2e/electron-main.cjs')], env: {
    ...process.env, OXESPACE_DISABLE_SINGLE_INSTANCE: '1', OXESPACE_E2E_MOCK_NATIVE: '1', OXESPACE_DB_PATH: join(root, 'db.sqlite3')
  } })
  try {
    const page = await app.firstWindow()
    await page.setViewportSize({ width: 1280, height: 800 })
    await page.getByTestId('btn-new-workspace').click()
    await page.getByTestId('wizard-dir-input').fill(repo)
    await page.getByTestId('wizard-layout-card-1').click()
    await page.getByTestId('wizard-launch-btn').click()
    await app.evaluate(({ ipcMain }, { rootPath, titles }) => {
      const now = Date.now()
      const threads = titles.map((title, index) => ({ id: `t${index}`, workspaceId: 'thread:p', projectId: 'p', rootPath, provider: index % 2 ? 'codex' : 'claude', nativeSessionId: null, title,
        status: index === 1 ? 'running' : 'idle', lastTurnStatus: 'completed', pinned: index === 0, createdAt: now - index * 3_600_000, updatedAt: now - index * 900_000 }))
      for (const channel of ['list', 'read', 'projects', 'commands', 'models']) ipcMain.removeHandler(`thread:${channel}`)
      ipcMain.handle('thread:projects', () => ({ projects: [{ projectId: 'p', displayName: 'oxespace', identityLabel: rootPath, hidden: false, contexts: [{ workspaceId: 'thread:p', rootPath, label: 'oxespace' }] }], unavailable: [] }))
      ipcMain.handle('thread:list', () => threads)
      ipcMain.handle('thread:read', (_event, id) => ({ thread: threads.find(thread => thread.id === id), events: [] }))
      ipcMain.handle('thread:commands', () => ({ commands: [] }))
      ipcMain.handle('thread:models', () => ({ defaultModel: 'm', models: [{ id: 'm', label: 'Model', description: '', efforts: ['low'], defaultEffort: 'low' }] }))
    }, { rootPath: repo, titles: TITLES })
    await modeButton(page, 'thread').click()
    const sidebar = page.getByRole('complementary', { name: 'Thread sidebar' })
    await expect(sidebar.locator('.thread-navigation-item').first()).toBeVisible()
    const separator = page.getByRole('separator', { name: 'Thread sidebar width' })

    for (const zoom of [1, 1.25, 1.5]) {
      await app.evaluate(({ BrowserWindow }, factor) => BrowserWindow.getAllWindows()[0].webContents.setZoomFactor(factor), zoom)
      for (const width of [240, 320, 416]) {
        await separator.focus()
        await page.keyboard.press('Home')
        for (let step = 240; step < width; step += 8) await page.keyboard.press('ArrowRight')
        expect(Number(await separator.getAttribute('aria-valuenow'))).toBe(width)
        await page.waitForTimeout(100)
        const rows = await sidebar.locator('.thread-navigation-row').evaluateAll(elements => elements.map(row => {
          const title = row.querySelector('.thread-session-title') as HTMLElement
          return { overflow: row.scrollWidth > row.clientWidth + 1, lines: Math.round(title.clientHeight / parseFloat(getComputedStyle(title).lineHeight)), cut: title.scrollHeight > title.clientHeight + 1 }
        }))
        console.log(`zoom ${zoom} width ${width}:`, JSON.stringify(rows))
        await page.screenshot({ path: test.info().outputPath(`sidebar-${width}-${String(zoom).replace('.', '_')}.png`), clip: { x: 0, y: 0, width: Math.min(width + 80, page.viewportSize()!.width), height: 420 } })
        // Nothing spills sideways, and a long title gets a second line before it is cut.
        expect(rows.every(row => !row.overflow)).toBe(true)
        expect(rows[0].lines).toBe(2)
      }
    }
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.setZoomFactor(1))
  } finally { await app.close() }
})
