import { test, type Page } from '@playwright/test'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { launchApp, openDemoWorkspace, resizeWindow } from '../helpers/launch'

/**
 * #246 (F22) on main: the targets P3-2 measured under 24 px, measured again (Appearance and Updates in Settings, the
 * OxePod engine switch, the new-connection environment, colour swatches and Favourite box, the Settings scope
 * picker), in both densities; and the colour swatches under Windows high contrast (forced-colors), where a background
 * colour is normally overridden. Output: e2e/screenshots/homologation/check-246/
 */
const OUT = join(process.cwd(), 'e2e', 'screenshots', 'homologation', 'check-246')
mkdirSync(OUT, { recursive: true })

const small = (page: Page) => page.evaluate(() => [...document.querySelectorAll('button,a[href],input:not([type=hidden]),select,[role="button"],[role="tab"],[role="radio"],[role="checkbox"],[role="switch"],[role="option"]')]
  .filter(el => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && !el.closest('.xterm, .monaco-editor') })
  .map(el => { const r = el.getBoundingClientRect(); return { name: (el.getAttribute('aria-label') || (el.textContent ?? '').trim() || el.tagName).slice(0, 30), w: Math.round(r.width), h: Math.round(r.height) } })
  .filter(t => t.w < 24 || t.h < 24))

for (const density of ['compact', 'comfortable'] as const) {
  test(`F22 targets: pt-BR light ${density}`, async () => {
    test.setTimeout(240_000)
    const notes: Record<string, unknown> = {}
    const { app, page, workspaceRoot, consoleErrors } = await launchApp({ locale: 'pt-BR', appearance: 'light', density })
    try {
      await resizeWindow(app, 1280, 860)
      await openDemoWorkspace(page, workspaceRoot)
      // Settings › Aparência and Atualizações.
      await page.keyboard.press('Control+,'); await page.locator('.settings-center').waitFor({ timeout: 10_000 })
      const nav = page.locator('.settings-center'); await page.screenshot({ path: join(OUT, `${density}-settings-open.png`) }); notes.settingsCopies = await nav.getByText('Aparência', { exact: true }).evaluateAll(els => els.map(e => { const r = e.getBoundingClientRect(); return `${Math.round(r.width)}x${Math.round(r.height)} pressed=${e.getAttribute('aria-pressed')} in=${e.closest('nav,aside,[role=dialog],[class]')?.className.toString().slice(0, 40)}` }))
      for (const name of ['Aparência', 'Atualizações']) {
        notes[`role-${name}`] = await nav.getByText(name, { exact: true }).locator('visible=true').first().evaluate(el => { const c = el.closest('button,a,[role]'); return c ? `${c.tagName} role=${c.getAttribute('role')}` : 'none' }).catch(() => 'not found'); await nav.getByText(name, { exact: true }).locator('visible=true').first().click(); await page.waitForTimeout(500)
        notes[`settings-${name}`] = await small(page)
        await page.screenshot({ path: join(OUT, `${density}-settings-${name}.png`) })
      }
      for (let i = 0; i < 3; i++) await page.keyboard.press('Escape')
      // OxePod engine switch.
      await page.keyboard.press('Control+4'); await page.waitForTimeout(800)
      notes.oxepod = await small(page)
      // OxeQuery › new connection: environment, swatches, Favourite.
      await page.keyboard.press('Control+3'); await page.waitForTimeout(600)
      await page.getByRole('button', { name: /^(Nova conexão|New connection)$/ }).first().click().catch(() => undefined)
      await page.waitForTimeout(600)
      notes.newConnection = await small(page)
      await page.screenshot({ path: join(OUT, `${density}-new-connection.png`) })
      if (density === 'compact') {
        // Forced colors: do the swatches still show their colour and the chosen one?
        await page.emulateMedia({ forcedColors: 'active' })
        await page.waitForTimeout(400)
        notes.forcedSwatches = await page.evaluate(() => [...document.querySelectorAll('[role="dialog"] [role="radio"], [role="dialog"] [class*="swatch" i]')]
          .filter(el => /swatch|color|cor/i.test(`${el.className} ${el.getAttribute('aria-label') ?? ''}`))
          .map(el => { const s = getComputedStyle(el); return { name: el.getAttribute('aria-label'), checked: el.getAttribute('aria-checked') ?? el.getAttribute('aria-pressed'), bg: s.backgroundColor, adjust: s.getPropertyValue('forced-color-adjust'), outline: `${s.outlineStyle} ${s.outlineWidth}`, border: `${s.borderStyle} ${s.borderWidth} ${s.borderColor}` } }))
        await page.screenshot({ path: join(OUT, 'forced-colors-new-connection.png') })
        await page.emulateMedia({ forcedColors: 'none' })
      }
      for (let i = 0; i < 3; i++) await page.keyboard.press('Escape')
      // Settings scope picker (workspace scope).
      await page.keyboard.press('Control+1'); await page.keyboard.press('Control+,'); await page.locator('.settings-center').waitFor({ timeout: 10_000 }).catch(() => undefined)
      notes.scope = (await small(page)).filter(t => /demo-repo|Aplicativo|Application/.test(t.name))
      notes.errors = consoleErrors
    } finally {
      writeFileSync(join(OUT, `${density}.json`), JSON.stringify(notes, null, 2))
      await app.close()
    }
  })
}
