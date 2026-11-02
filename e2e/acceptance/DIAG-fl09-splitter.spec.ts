import { _electron as electron, expect, test } from '@playwright/test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * DIAG for FL-09 (not a product spec; never merged): the Code sidebar's "Sidebar width" separator lost one ArrowLeft in
 * e2e/thread-view.spec.ts even with #466. This repeats that spec's key sequence (20 left, 15 right, 10 left) many
 * times and records, for every press: whether the separator received the keydown, which element had focus, the
 * separator's aria-valuenow before and after, and whether the element was replaced (remounted) in between.
 */
test('DIAG FL-09: every Sidebar width key press, with what the separator saw', async () => {
  test.setTimeout(170_000)
  const root = mkdtempSync(join(tmpdir(), 'oxespace-diag-fl09-'))
  const app = await electron.launch({ args: [join(process.cwd(), 'e2e/electron-main.cjs')], env: {
    ...process.env, OXESPACE_DISABLE_SINGLE_INSTANCE: '1', OXESPACE_E2E_MOCK_NATIVE: '1', OXESPACE_DB_PATH: join(root, 'app.sqlite3')
  } })
  const lost: string[] = []
  try {
    const page = await app.firstWindow()
    await page.waitForLoadState('domcontentloaded')
    const resize = page.locator('.sidebar').getByRole('separator', { name: 'Sidebar width', exact: true })
    await expect(resize).toBeVisible({ timeout: 30_000 })
    // Count keydowns that reach any "Sidebar width" separator, and mark the element so a remount shows.
    await page.evaluate(() => {
      const w = window as unknown as { __diag: { keydowns: number; other: string[] } }
      w.__diag = { keydowns: 0, other: [] }
      document.addEventListener('keydown', event => {
        const target = event.target as HTMLElement
        if (target?.getAttribute?.('aria-label') === 'Sidebar width') w.__diag.keydowns++
        else w.__diag.other.push(`${event.key}@${target?.tagName}.${target?.className ?? ''}`.slice(0, 120))
      }, true)
    })
    const read = () => page.evaluate(() => {
      const el = document.querySelector('.sidebar [role="separator"][aria-label="Sidebar width"]') as HTMLElement | null
      const w = window as unknown as { __diag: { keydowns: number; other: string[] } }
      const stamp = el ? (el.dataset.diag ??= String(Math.random()).slice(2, 8)) : 'none'
      const active = document.activeElement as HTMLElement | null
      return { value: Number(el?.getAttribute('aria-valuenow')), stamp, keydowns: w.__diag.keydowns, other: w.__diag.other.length,
        focus: active === el ? 'separator' : `${active?.tagName}.${(active?.className ?? '').toString().slice(0, 60)}` }
    })
    for (let round = 0; round < 12; round++) {
      for (const [key, presses, step] of [['ArrowLeft', 20, -8], ['ArrowRight', 15, 8], ['ArrowLeft', 10, -8]] as const) {
        for (let index = 0; index < presses; index++) {
          const before = await read()
          await resize.press(key)
          const after = await read()
          const expected = Math.max(240, Math.min(520, before.value + step))
          if (after.value !== expected) {
            const line = `LOST round=${round} ${key}#${index} before=${before.value} after=${after.value} expected=${expected} ` +
              `keydownsDelta=${after.keydowns - before.keydowns} otherDelta=${after.other - before.other} focusBefore=${before.focus} ` +
              `focusAfter=${after.focus} remounted=${before.stamp !== after.stamp}`
            lost.push(line)
            console.log(line)
            const later = await read()
            console.log(`  settled later: value=${later.value}`)
          }
        }
      }
    }
    const other = await page.evaluate(() => (window as unknown as { __diag: { other: string[] } }).__diag.other.slice(0, 20))
    console.log(`DIAG summary: ${lost.length} lost of ${12 * 45} presses; keydowns elsewhere (first 20): ${JSON.stringify(other)}`)
  } finally {
    await app.close()
  }
  expect(lost, lost.join('\n')).toEqual([])
})
