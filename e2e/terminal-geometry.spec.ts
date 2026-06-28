import { _electron as electron, test, expect } from '@playwright/test'
import { mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * Geometry probe: confirms the terminal's rendered text area does NOT clip past
 * the card edges (the v0.2.6 "sides cut off" regression). Measures the xterm
 * screen against the .terminal-view content box.
 */
test('terminal text area stays inside the card (no side clipping)', async () => {
  const root = join(tmpdir(), `oxe-geo-${Date.now()}`, 'repo')
  mkdirSync(root, { recursive: true })
  const app = await electron.launch({
    args: [join(process.cwd(), 'e2e', 'electron-main.cjs')],
    env: { ...process.env, OXESPACE_DISABLE_SINGLE_INSTANCE: '1', OXESPACE_E2E_MOCK_NATIVE: '1', OXESPACE_DB_PATH: join(root, 'db.sqlite3') }
  })
  try {
    const page = await app.firstWindow()
    await page.getByTestId('btn-new-workspace').click()
    await page.getByTestId('wizard-dir-input').fill(root)
    await page.getByTestId('wizard-layout-card-1').click()
    await page.getByTestId('wizard-launch-btn').click()
    await page.getByTestId('terminal-view').first().waitFor({ state: 'visible' })
    await page.waitForTimeout(1200) // let fit + render settle

    const geo = await page.evaluate(() => {
      const view = document.querySelector('.terminal-view') as HTMLElement | null
      const screen = document.querySelector('.terminal-view .xterm-screen') as HTMLElement | null
      const rows = document.querySelector('.terminal-view .xterm-rows') as HTMLElement | null
      const canvas = document.querySelector('.terminal-view canvas') as HTMLElement | null
      if (!view) return { error: 'no .terminal-view' }
      const cs = getComputedStyle(view)
      const vr = view.getBoundingClientRect()
      const padL = parseFloat(cs.paddingLeft), padR = parseFloat(cs.paddingRight)
      const bL = parseFloat(cs.borderLeftWidth), bR = parseFloat(cs.borderRightWidth)
      // content box of the card (where text must stay inside)
      const contentLeft = vr.left + bL + padL
      const contentRight = vr.right - bR - padR
      const content = screen ?? rows ?? canvas
      const sr = content?.getBoundingClientRect()
      return {
        which: screen ? 'screen' : rows ? 'rows' : canvas ? 'canvas' : 'none',
        viewPadding: cs.padding,
        xtermPadding: getComputedStyle(document.querySelector('.terminal-view .xterm') as Element).padding,
        contentLeft: Math.round(contentLeft), contentRight: Math.round(contentRight),
        textLeft: sr ? Math.round(sr.left) : null, textRight: sr ? Math.round(sr.right) : null,
        leftGutter: sr ? Math.round(sr.left - contentLeft) : null,
        rightOverflow: sr ? Math.round(sr.right - contentRight) : null
      }
    })
    // eslint-disable-next-line no-console
    console.log('[GEO]', JSON.stringify(geo, null, 2))
    expect(geo.error).toBeUndefined()
    // Text must start at/after the card content edge (no left clip) and not
    // overflow it (no right clip). Allow 1px rounding slack.
    expect(geo.textLeft! >= geo.contentLeft! - 1).toBeTruthy()
    expect(geo.textRight! <= geo.contentRight! + 1).toBeTruthy()
  } finally {
    await Promise.race([app.close().catch(() => undefined), new Promise((r) => setTimeout(r, 4000))])
  }
})
