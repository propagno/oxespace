import { test, type Page } from '@playwright/test'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { launchApp, openDemoWorkspace, resizeWindow } from '../helpers/launch'

/**
 * #271 (F31) pre-homologation, black box, Windows high contrast emulated (forced-colors: active) in light and dark:
 * does the chosen option of every segmented control / choice card differ from the others, is every Switch visible
 * on and off, and do the swatches keep their colour. Surfaces: Nova conexão (OxeQuery), Settings › Aparência,
 * Settings › Atualizações, the OxePod engine switch. Output: e2e/screenshots/homologation/pre-271/
 */
const OUT = join(process.cwd(), 'e2e', 'screenshots', 'homologation', 'pre-271')
mkdirSync(OUT, { recursive: true })

/** For each group of pressed/checked-able controls: the look of the chosen one against an unchosen one. */
const groups = (page: Page) => page.evaluate(() => {
  const look = (el: Element) => { const s = getComputedStyle(el); const a = getComputedStyle(el, '::after'); const b = getComputedStyle(el, '::before')
    return [s.backgroundColor, s.color, `${s.borderTopStyle} ${s.borderTopWidth} ${s.borderTopColor}`, `${s.outlineStyle} ${s.outlineWidth} ${s.outlineColor}`, s.boxShadow, s.textDecorationLine, s.fontWeight, a.content, a.backgroundColor, b.content].join(' ; ') }
  const visible = (el: Element) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 }
  const out: Array<{ group: string; chosen: string; differs: boolean }> = []
  const containers = new Set<Element>()
  for (const el of document.querySelectorAll('[aria-pressed], [role="radio"], [role="tab"][aria-selected]')) if (visible(el) && el.parentElement) containers.add(el.parentElement)
  for (const c of containers) {
    const items = [...c.children].filter(e => e.matches('[aria-pressed], [role="radio"], [role="tab"]') && visible(e))
    const chosen = items.find(e => e.getAttribute('aria-pressed') === 'true' || e.getAttribute('aria-checked') === 'true' || e.getAttribute('aria-selected') === 'true')
    const other = items.find(e => e !== chosen)
    if (!chosen || !other) continue
    out.push({ group: items.map(e => (e.getAttribute('aria-label') || e.textContent || '').trim().slice(0, 14)).join('/'), chosen: (chosen.getAttribute('aria-label') || chosen.textContent || '').trim().slice(0, 20), differs: look(chosen) !== look(other) })
  }
  const switches = [...document.querySelectorAll('[role="switch"], input[type="checkbox"][role="switch"]')].filter(visible).map(el => {
    const r = el.getBoundingClientRect(); const s = getComputedStyle(el)
    return { name: (el.getAttribute('aria-label') || el.closest('label')?.textContent || '').trim().slice(0, 30), checked: el.getAttribute('aria-checked') ?? String((el as HTMLInputElement).checked), size: `${Math.round(r.width)}x${Math.round(r.height)}`, border: `${s.borderTopStyle} ${s.borderTopWidth} ${s.borderTopColor}`, bg: s.backgroundColor }
  })
  return { groups: out, switches }
})

for (const appearance of ['light', 'dark'] as const) {
  test(`F31 forced-colors: pt-BR ${appearance}`, async () => {
    test.setTimeout(240_000)
    const notes: Record<string, unknown> = {}
    const { app, page, workspaceRoot, consoleErrors } = await launchApp({ locale: 'pt-BR', appearance })
    const shot = (name: string) => page.screenshot({ path: join(OUT, `${appearance}-${name}.png`) })
    try {
      await resizeWindow(app, 1280, 860)
      await openDemoWorkspace(page, workspaceRoot)
      await page.emulateMedia({ forcedColors: 'active' })
      // OxeQuery › Nova conexão; flip read-only to see both states of the Switch.
      await page.keyboard.press('Control+3'); await page.waitForTimeout(600)
      await page.getByRole('button', { name: /^(Nova conexão|New connection)$/ }).first().click()
      await page.waitForTimeout(600)
      notes.newConnection = await groups(page); await shot('new-connection')
      await page.getByRole('radio', { name: /Produção/ }).first().click().catch(() => page.getByRole('button', { name: /^Produção$/ }).first().click().catch(() => undefined))
      await page.getByRole('switch').first().click().catch(() => undefined)
      await page.waitForTimeout(300)
      notes.newConnectionProdWritable = await groups(page); await shot('new-connection-prod-writable')
      for (let i = 0; i < 3; i++) await page.keyboard.press('Escape')
      // OxePod engine.
      await page.keyboard.press('Control+4'); await page.waitForTimeout(800)
      notes.oxepod = await groups(page); await shot('oxepod')
      // Settings › Aparência and Atualizações.
      await page.keyboard.press('Control+1'); await page.keyboard.press('Control+,')
      const settings = page.locator('.settings-center'); await settings.waitFor({ timeout: 10_000 })
      for (const name of ['Aparência', 'Atualizações']) {
        await settings.getByText(name, { exact: true }).locator('visible=true').first().click(); await page.waitForTimeout(500)
        notes[name] = await groups(page); await shot(`settings-${name}`)
      }
      notes.errors = consoleErrors
    } finally {
      writeFileSync(join(OUT, `${appearance}.json`), JSON.stringify(notes, null, 2))
      await app.close()
    }
  })
}
