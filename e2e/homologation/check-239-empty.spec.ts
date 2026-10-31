import { _electron as electron, test } from '@playwright/test'
import { cleanEnv } from './clean-env'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/** #239: empty, blank and quote-only roots come back as a coded refusal, not a raw error (direct calls, real app). */
test('workspace root: empty and blank', async () => {
  test.setTimeout(120_000)
  const root = mkdtempSync(join(tmpdir(), 'oxespace-hml-239e-'))
  const app = await electron.launch({ args: [join(process.cwd(), 'e2e', 'electron-main.cjs')], env: { ...cleanEnv(), OXESPACE_DISABLE_SINGLE_INSTANCE: '1', OXESPACE_DB_PATH: join(root, 'oxespace.sqlite3'), OXESPACE_LOCALE: 'pt-BR' } })
  try {
    const page = await app.firstWindow()
    await page.getByTestId('btn-new-workspace').first().waitFor({ timeout: 30_000 })
    const replies = await page.evaluate(async paths => {
      const out: string[] = []
      for (const path of paths) {
        try { const r = await (window as unknown as { oxe: { workspace: { create: (i: object) => Promise<Record<string, unknown>> } } }).oxe.workspace.create({ rootPath: path, autoStart: false }); out.push(`${JSON.stringify(path)} → ${JSON.stringify(r).slice(0, 220)}`) } catch (e) { out.push(`${JSON.stringify(path)} → threw ${String(e).slice(0, 160)}`) }
      }
      return out
    }, ['', '   ', '""', "''", '" "', '\t\n', '"', 42 as unknown as string, null as unknown as string])
    writeFileSync(join(process.cwd(), 'e2e', 'screenshots', 'homologation', 'check-239-empty.json'), JSON.stringify(replies, null, 2))
    console.log('C239E\n' + replies.join('\n'))
  } finally { await app.close() }
})
