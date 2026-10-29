import { _electron as electron, test } from '@playwright/test'
import { mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runPaletteCommand, togglePanel } from './helpers/panels'

const SHOTS = join(process.cwd(), 'e2e', 'screenshots', 'redesign-audit', 'shots')

test('redesign audit part 2', async () => {
  // Walks every surface in one session; the default 30 s per-test timeout is far too short.
  test.setTimeout(15 * 60_000)
  mkdirSync(SHOTS, { recursive: true })
  const root = join(tmpdir(), `oxespace-audit2-${Date.now()}`)
  const ws = join(root, 'demo-repo'); mkdirSync(ws, { recursive: true })
  const app = await electron.launch({ args: [join(process.cwd(), 'e2e', 'electron-main.cjs')],
    env: { ...process.env, OXESPACE_DISABLE_SINGLE_INSTANCE: '1', OXESPACE_E2E_MOCK_NATIVE: '1', OXESPACE_DB_PATH: join(root, 'o.sqlite3') } })
  const page = await app.firstWindow()
  const log: string[] = []
  const shot = async (n: string) => { await page.waitForTimeout(400); await page.screenshot({ path: join(SHOTS, `${n}.png`) }) }
  try {
    await page.waitForLoadState('domcontentloaded'); await page.waitForTimeout(1000)
    await page.getByTestId('btn-new-workspace').click()
    await page.getByTestId('wizard-dir-input').fill(ws)
    await page.getByTestId('wizard-launch-btn').click()
    await page.waitForSelector('[data-testid="workspace-grid"], [data-testid="workspace-split-grid"]', { timeout: 10000 })
    const open: Record<string, () => Promise<void>> = {
      Skills: () => runPaletteCommand(page, 'Skills'), 'Semantic index log': () => runPaletteCommand(page, 'Semantic index log'),
      Files: () => togglePanel(page, 'Files'), Changes: () => togglePanel(page, 'Changes'),
      'Command palette': () => page.keyboard.press('Control+k'), 'Workspace settings': () => runPaletteCommand(page, 'Workspace settings')
    }
    for (const label of Object.keys(open)) {
      try {
        await open[label]()
        await page.waitForTimeout(900); await shot(`13-tool-${label.toLowerCase().replace(/\W+/g, '-')}`)
      } catch (e) { log.push(`${label}: ${(e as Error).message.split('\n')[0]}`) }
      const dlg = page.getByRole('dialog').first()
      if (await dlg.count()) { const c = dlg.getByRole('button', { name: 'Close' }).first(); if (await c.count()) await c.click().catch(() => undefined); else await page.keyboard.press('Escape') }
      await page.keyboard.press('Escape'); await page.waitForTimeout(300)
    }
    try {
      await page.getByRole('button', { name: 'Thread', exact: true }).first().click({ timeout: 5000 })
      await shot('14-thread-mode')
      const btn = page.getByRole('button', { name: /new thread|new chat|nova/i }).first()
      if (await btn.count()) { await btn.click(); await shot('15-thread-new') }
    } catch (e) { log.push(`thread: ${(e as Error).message.split('\n')[0]}`) }
    await page.getByRole('button', { name: 'Code', exact: true }).first().click().catch(() => undefined)
    await page.getByRole('button', { name: /Delegated work/ }).click().then(() => shot('16-delegated-work')).catch(e => log.push('delegated ' + e.message.split('\n')[0]))
    await page.keyboard.press('Escape')
    await page.getByRole('button', { name: /Activity/ }).first().click().then(() => shot('17-activity')).catch(e => log.push('activity ' + e.message.split('\n')[0]))
    await page.keyboard.press('Escape')
    await page.getByRole('button', { name: /Connections/ }).first().click().then(() => shot('18-connections')).catch(e => log.push('conn ' + e.message.split('\n')[0]))
  } finally { console.log('LOG', JSON.stringify(log)); await app.close() }
})
