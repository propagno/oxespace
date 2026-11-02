import { _electron as electron, expect, test } from '@playwright/test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { modeButton } from '../helpers/modes'

/**
 * DIAG 2 for FL-09 (never merged). DIAG 1 (the same presses with no mode switches) lost nothing in 540 presses on
 * both OSes; thread-view.spec.ts:9 loses one ArrowLeft in the group that follows Thread → Settings → Close → Code.
 * This does that round trip before every group, presses at once as the spec does, and for every lost press records
 * the separator's identity (remount), focus, the keydowns it got, and the values it went through.
 */
test('DIAG FL-09: key presses right after the Thread → Settings → Code round trip', async () => {
  test.setTimeout(175_000)
  const root = mkdtempSync(join(tmpdir(), 'oxespace-diag-fl09b-'))
  const app = await electron.launch({ args: [join(process.cwd(), 'e2e/electron-main.cjs')], env: {
    ...process.env, OXESPACE_DISABLE_SINGLE_INSTANCE: '1', OXESPACE_E2E_MOCK_NATIVE: '1', OXESPACE_DB_PATH: join(root, 'app.sqlite3')
  } })
  const lost: string[] = []
  let presses = 0
  try {
    const page = await app.firstWindow()
    await page.waitForLoadState('domcontentloaded')
    const resize = page.locator('.sidebar').getByRole('separator', { name: 'Sidebar width', exact: true })
    await expect(resize).toBeVisible({ timeout: 30_000 })
    await page.evaluate(() => {
      const w = window as unknown as { __d: { keydowns: number; elsewhere: string[]; values: string[]; mounts: number } }
      w.__d = { keydowns: 0, elsewhere: [], values: [], mounts: 0 }
      document.addEventListener('keydown', event => {
        const t = event.target as HTMLElement
        if (t?.getAttribute?.('aria-label') === 'Sidebar width') w.__d.keydowns++
        else if (event.key.startsWith('Arrow')) w.__d.elsewhere.push(`${event.key}@${t?.tagName}.${String(t?.className ?? '').slice(0, 50)}${t?.isConnected ? '' : '(detached)'}`)
      }, true)
      // Every value the separator shows, and every time a new separator node appears.
      new MutationObserver(records => {
        for (const r of records) {
          if (r.type === 'attributes' && (r.target as HTMLElement).getAttribute('aria-label') === 'Sidebar width') w.__d.values.push((r.target as HTMLElement).getAttribute('aria-valuenow') ?? '')
          for (const n of Array.from(r.addedNodes)) if (n instanceof HTMLElement && (n.matches('[aria-label="Sidebar width"]') || n.querySelector('[aria-label="Sidebar width"]'))) w.__d.mounts++
        }
      }).observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['aria-valuenow'] })
    })
    const read = () => page.evaluate(() => {
      const el = document.querySelector('.sidebar [role="separator"][aria-label="Sidebar width"]') as HTMLElement | null
      const w = window as unknown as { __d: { keydowns: number; elsewhere: string[]; values: string[]; mounts: number } }
      const stamp = el ? (el.dataset.diag ??= String(Math.random()).slice(2, 8)) : 'none'
      const a = document.activeElement as HTMLElement | null
      return { value: Number(el?.getAttribute('aria-valuenow')), stamp, keydowns: w.__d.keydowns, elsewhere: w.__d.elsewhere.length, values: w.__d.values.length, mounts: w.__d.mounts,
        focus: a === el ? 'separator' : `${a?.tagName}.${String(a?.className ?? '').slice(0, 50)}` }
    })
    const roundTrip = async () => {
      await modeButton(page, 'thread').click()
      await expect(page.locator('.thread-navigation')).toBeVisible()
      await page.getByRole('button', { name: 'Open settings', exact: true }).click()
      await expect(page.locator('.settings-center-nav')).toBeVisible()
      await page.getByRole('button', { name: 'Close settings', exact: true }).click()
      await modeButton(page, 'code').click()
    }
    for (let round = 0; round < 5; round++) {
      for (const [key, count, step] of [['ArrowLeft', 20, -8], ['ArrowRight', 15, 8], ['ArrowLeft', 10, -8]] as const) {
        await roundTrip()
        for (let index = 0; index < count; index++) {
          const before = await read().catch(() => null)
          await resize.press(key)
          presses++
          const after = await read()
          if (!before) continue
          const expected = Math.max(240, Math.min(520, before.value + step))
          if (after.value !== expected) {
            const tail = await page.evaluate(n => (window as unknown as { __d: { values: string[]; elsewhere: string[] } }).__d.values.slice(n), before.values)
            const away = await page.evaluate(n => (window as unknown as { __d: { elsewhere: string[] } }).__d.elsewhere.slice(n), before.elsewhere)
            const line = `LOST round=${round} ${key}#${index} before=${before.value} after=${after.value} expected=${expected} keydowns+${after.keydowns - before.keydowns} ` +
              `elsewhere=${JSON.stringify(away)} valuesSeen=${JSON.stringify(tail)} mounts+${after.mounts - before.mounts} remounted=${before.stamp !== after.stamp} ` +
              `focusBefore=${before.focus} focusAfter=${after.focus}`
            lost.push(line)
            console.log(line)
          }
        }
      }
    }
    console.log(`DIAG2 summary: ${lost.length} lost of ${presses} presses`)
  } finally {
    await app.close()
  }
  expect(lost, lost.join('\n')).toEqual([])
})
