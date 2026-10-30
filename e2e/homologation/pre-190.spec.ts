import { test } from '@playwright/test'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { launchApp } from '../helpers/launch'

/**
 * Pre-homologation of #190 (R1): the boot splash opens in the appearance saved in Settings, whatever the system is.
 * The bundle is blocked so the splash stays on screen; the system scheme is emulated. Not part of CI.
 */
const OUT = join(process.cwd(), 'e2e', 'screenshots', 'homologation', 'pre-190')
mkdirSync(OUT, { recursive: true })
const notes: Record<string, unknown> = {}
test.afterAll(() => writeFileSync(join(OUT, 'notes.json'), JSON.stringify(notes, null, 2)))

test('splash follows the saved appearance', async () => {
  test.setTimeout(120_000)
  const { app, page } = await launchApp()
  try {
    await page.route(/assets\/index-[^/]+\.js$/, route => route.abort())
    for (const saved of ['dark', 'light', 'system'] as const) {
      for (const system of ['light', 'dark'] as const) {
        await page.evaluate(a => localStorage.setItem('oxe-settings', JSON.stringify({ state: { appearance: a, motion: 'reduce' }, version: 7 })), saved)
        await page.emulateMedia({ colorScheme: system })
        await page.reload()
        await page.waitForTimeout(500)
        const tag = `saved-${saved}-system-${system}`
        notes[tag] = await page.evaluate(() => ({
          splash: !!document.querySelector('.oxe-splash'),
          mode: document.documentElement.dataset.mode ?? null,
          motion: document.documentElement.dataset.motion ?? null,
          background: getComputedStyle(document.querySelector('.oxe-splash') ?? document.body).backgroundColor
        }))
        await page.screenshot({ path: join(OUT, `${tag}.png`) })
      }
    }
    // Corrupt settings must not break the boot.
    await page.evaluate(() => localStorage.setItem('oxe-settings', '{not json'))
    await page.reload(); await page.waitForTimeout(400)
    notes.corrupt = await page.evaluate(() => ({ splash: !!document.querySelector('.oxe-splash'), mode: document.documentElement.dataset.mode ?? null }))
  } finally { await app.close() }
})
