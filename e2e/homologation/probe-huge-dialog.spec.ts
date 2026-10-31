import { _electron as electron, test } from '@playwright/test'
import { cleanEnv } from './clean-env'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

test('probe: a native dialog with a very long detail', async () => {
  test.setTimeout(90_000)
  const root = mkdtempSync(join(tmpdir(), 'oxespace-hml-huge-'))
  const app = await electron.launch({ args: [join(process.cwd(), 'e2e', 'electron-main.cjs')], env: { ...cleanEnv(), OXESPACE_DISABLE_SINGLE_INSTANCE: '1', OXESPACE_E2E_MOCK_NATIVE: '1', OXESPACE_DB_PATH: join(root, 'db.sqlite3') } })
  try {
    const page = await app.firstWindow(); await page.waitForLoadState('load')
    for (const size of [2_000, 20_000, 100_000]) {
      const out = await app.evaluate(async ({ BrowserWindow, dialog }, n) => {
        const controller = new AbortController()
        const started = Date.now()
        const timer = setTimeout(() => controller.abort(), 5_000)
        try {
          const r = await dialog.showMessageBox(BrowserWindow.getAllWindows()[0], { type: 'warning', title: 't', message: 'm', detail: 'x'.repeat(n), buttons: ['Negar', 'Permitir uma vez'], defaultId: 0, cancelId: 0, signal: controller.signal })
          return { response: r.response, ms: Date.now() - started, abortedByTimer: controller.signal.aborted }
        } catch (e) { return { error: String(e).slice(0, 120), ms: Date.now() - started } } finally { clearTimeout(timer) }
      }, size)
      console.log('HUGE', size, JSON.stringify(out))
    }
  } finally { await app.close() }
})
