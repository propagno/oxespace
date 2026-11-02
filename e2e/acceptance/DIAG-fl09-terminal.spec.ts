import { _electron as electron, expect, test } from '@playwright/test'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { modeButton } from '../helpers/modes'

/**
 * DIAG 3 for FL-09 (never merged). DIAG 1 (presses alone) and DIAG 2 (after the Thread → Settings → Code round trip)
 * lost no key on either OS. thread-view.spec.ts:9 also has a workspace with a running terminal, focused before the
 * resize. Hypothesis: back in Code mode, the app hands focus back to the terminal a moment later, and a key pressed in
 * that window goes to xterm instead of the separator. This records, for every press that does not move the width,
 * where the keydown went (separator or another element, e.g. the xterm textarea) and what had focus.
 */
test('DIAG FL-09: presses with a running terminal, after the round trip', async () => {
  test.setTimeout(175_000)
  const root = mkdtempSync(join(tmpdir(), 'oxespace-diag-fl09c-'))
  const repo = join(root, 'repo'); mkdirSync(repo)
  writeFileSync(join(repo, 'README.md'), '# fixture\n')
  const app = await electron.launch({ args: [join(process.cwd(), 'e2e/electron-main.cjs')], env: {
    ...process.env, OXESPACE_DISABLE_SINGLE_INSTANCE: '1', OXESPACE_E2E_MOCK_NATIVE: '1', OXESPACE_DB_PATH: join(root, 'app.sqlite3')
  } })
  const lost: string[] = []
  let presses = 0
  try {
    const page = await app.firstWindow()
    await page.waitForLoadState('domcontentloaded')
    await page.getByTestId('btn-new-workspace').click()
    await page.getByTestId('wizard-dir-input').fill(repo)
    await page.getByTestId('wizard-layout-card-1').click()
    await page.getByTestId('wizard-launch-btn').click()
    const codeInput = page.locator('.terminal-pane .xterm-helper-textarea').first()
    await expect(page.getByTestId('terminal-status-label').first()).toHaveText('running', { timeout: 30_000 })
    const resize = page.locator('.sidebar').getByRole('separator', { name: 'Sidebar width', exact: true })
    await page.evaluate(() => {
      const w = window as unknown as { __d: { keydowns: number; elsewhere: string[] } }
      w.__d = { keydowns: 0, elsewhere: [] }
      document.addEventListener('keydown', event => {
        const t = event.target as HTMLElement
        if (t?.getAttribute?.('aria-label') === 'Sidebar width') w.__d.keydowns++
        else if (event.key.startsWith('Arrow')) w.__d.elsewhere.push(`${event.key}@${t?.tagName}.${String(t?.className ?? '').slice(0, 50)}`)
      }, true)
    })
    const read = () => page.evaluate(() => {
      const el = document.querySelector('.sidebar [role="separator"][aria-label="Sidebar width"]') as HTMLElement | null
      const w = window as unknown as { __d: { keydowns: number; elsewhere: string[] } }
      const a = document.activeElement as HTMLElement | null
      return { value: Number(el?.getAttribute('aria-valuenow')), keydowns: w.__d.keydowns, elsewhere: w.__d.elsewhere.length,
        focus: a === el ? 'separator' : `${a?.tagName}.${String(a?.className ?? '').slice(0, 50)}` }
    })
    for (let round = 0; round < 4; round++) {
      for (const [key, count, step] of [['ArrowLeft', 20, -8], ['ArrowRight', 15, 8], ['ArrowLeft', 10, -8]] as const) {
        await modeButton(page, 'thread').click()
        await page.getByRole('button', { name: 'Open settings', exact: true }).click()
        await page.getByRole('button', { name: 'Close settings', exact: true }).click()
        await modeButton(page, 'code').click()
        await codeInput.focus().catch(() => {})
        await expect(resize).toBeVisible()
        for (let index = 0; index < count; index++) {
          const before = await read()
          await resize.press(key)
          presses++
          const after = await read()
          const expected = Math.max(240, Math.min(520, before.value + step))
          if (Number.isFinite(before.value) && after.value !== expected) {
            const away = await page.evaluate(n => (window as unknown as { __d: { elsewhere: string[] } }).__d.elsewhere.slice(n), before.elsewhere)
            const line = `LOST round=${round} ${key}#${index} before=${before.value} after=${after.value} expected=${expected} keydowns+${after.keydowns - before.keydowns} ` +
              `elsewhere=${JSON.stringify(away)} focusBefore=${before.focus} focusAfter=${after.focus}`
            lost.push(line)
            console.log(line)
          }
        }
      }
    }
    console.log(`DIAG3 summary: ${lost.length} lost of ${presses} presses`)
  } finally {
    await app.close()
  }
  expect(lost, lost.join('\n')).toEqual([])
})
