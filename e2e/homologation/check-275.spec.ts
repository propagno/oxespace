import { test, type Page } from '@playwright/test'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { launchApp, openDemoWorkspace, resizeWindow } from '../helpers/launch'

/**
 * #275 (F25) on main, black box with the quarantine fixture of #237 (nothing real is trusted or started): can a person
 * miss a quarantined MCP server? The MCP button and the Installed tab count, the row's badge and its contrast, "Confiar
 * de novo…" in place of Test and its confirmation (what changed, default button, Enter, Escape; always cancelled,
 * never confirmed), "0 ferramentas", and the activity center. pt-BR light and en dark.
 * Output: e2e/screenshots/homologation/check-275/
 */
const OUT = join(process.cwd(), 'e2e', 'screenshots', 'homologation', 'check-275')
mkdirSync(OUT, { recursive: true })
process.env.OXESPACE_E2E_MCP_FIXTURE = 'quarantine'
const focused = (page: Page) => page.evaluate(() => { const el = document.activeElement as HTMLElement | null; return el ? `${el.tagName} ${el.getAttribute('aria-label') ?? ''} ${(el.textContent ?? '').trim().slice(0, 30)}`.trim() : null })
const contrastOf = (page: Page, text: RegExp) => page.evaluate(source => {
  const re = new RegExp(source, 'i')
  const ctx = document.createElement('canvas').getContext('2d')!
  const rgb = (v: string) => { ctx.fillStyle = '#000'; ctx.fillStyle = v; ctx.fillRect(0, 0, 1, 1); const d = ctx.getImageData(0, 0, 1, 1).data; return [d[0], d[1], d[2], d[3] / 255] }
  const lum = (c: number[]) => c.slice(0, 3).map(x => x / 255).map(x => x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4).reduce((s, x, i) => s + x * [0.2126, 0.7152, 0.0722][i], 0)
  return [...document.querySelectorAll('span, small, b, strong, em, div')].filter(e => e.children.length === 0 && re.test(e.textContent ?? '')).slice(0, 4).map(e => {
    const fg = rgb(getComputedStyle(e).color); let n: Element | null = e, bg: number[] = []
    while (n) { const c = rgb(getComputedStyle(n).backgroundColor); if (c[3] === 1) { bg = c; break } n = n.parentElement }
    const a = lum(fg), b = lum(bg), ratio = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
    return `${(e.textContent ?? '').trim()} ${ratio.toFixed(2)}:1 size=${getComputedStyle(e).fontSize}`
  })
}, text.source)

for (const [locale, appearance] of [['pt-BR', 'light'], ['en-US', 'dark']] as const) {
  test(`F25 quarantine is hard to miss: ${locale} ${appearance}`, async () => {
    test.setTimeout(240_000)
    const notes: Record<string, unknown> = {}
    const pt = locale === 'pt-BR'
    const { app, page, workspaceRoot, consoleErrors } = await launchApp({ locale, appearance })
    const shot = (n: string) => page.screenshot({ path: join(OUT, `${locale}-${n}.png`) })
    try {
      await resizeWindow(app, 1280, 860)
      await openDemoWorkspace(page, workspaceRoot)
      await page.waitForTimeout(800)
      const mcpButton = page.getByRole('button', { name: /servidores MCP|MCP servers/ }).first()
      notes.mcpButton = { name: await mcpButton.getAttribute('aria-label'), text: (await mcpButton.innerText().catch(() => '')).trim(), title: await mcpButton.getAttribute('title') }
      notes.mcpBadge = await mcpButton.evaluate(b => { const badge = b.querySelector('[class*="badge" i], [class*="count" i], span'); const r = badge?.getBoundingClientRect(); return badge ? `${(badge.textContent ?? '').trim()} ${Math.round(r!.width)}x${Math.round(r!.height)} visible=${r!.width > 0}` : 'no badge element' }).catch(() => 'n/a')
      await resizeWindow(app, 820, 860); await page.waitForTimeout(400)
      notes.mcpBadge820 = await page.getByRole('button', { name: /servidores MCP|MCP servers/ }).first().evaluate(b => { const badge = b.querySelector('[class*="badge" i], [class*="count" i], span'); const r = badge?.getBoundingClientRect(); return badge ? `${(badge.textContent ?? '').trim()} visible=${!!r && r.width > 0}` : 'no badge element' }).catch(() => 'button not visible at 820')
      await shot('00-workspace-820'); await resizeWindow(app, 1280, 860); await page.waitForTimeout(300)
      await shot('00-workspace')
      // Activity center.
      await page.keyboard.press('Control+Shift+A'); await page.waitForTimeout(600)
      notes.activity = (await page.getByRole('dialog').last().innerText().catch(() => '')).slice(0, 700)
      await shot('01-activity'); await page.keyboard.press('Escape')
      // The list.
      await mcpButton.click(); await page.waitForTimeout(800)
      const panel = page.getByRole('dialog').last()
      const installed = panel.getByRole('tab', { name: pt ? /Instalados/ : /Installed/ }).first()
      notes.installedTab = { text: (await installed.innerText().catch(() => '')).trim(), label: await installed.getAttribute('aria-label') }
      await installed.click().catch(() => undefined); await page.waitForTimeout(600)
      notes.rows = await panel.locator('button', { hasText: /docs-search|deploy-helper|new-server|notes/ }).allInnerTexts().then(t => t.map(x => x.replace(/\n/g, ' · ')))
      notes.rowButtons = await panel.getByRole('button').allInnerTexts().then(t => t.map(x => x.trim()).filter(x => /Testar|Test|Confiar|Trust/.test(x)))
      notes.contrast = await contrastOf(page, pt ? /^EM QUARENTENA$|^PRECISA DE REVISÃO$/ : /^QUARANTINED$|^REVIEW REQUIRED$/)
      await shot('02-installed')
      // "Confiar de novo…" on each quarantined server: look, then cancel. Never confirm.
      for (const server of ['docs-search', 'deploy-helper']) {
        notes[`panelOpenBefore-${server}`] = await panel.isVisible().catch(() => false)
        if (!(await panel.isVisible().catch(() => false))) { await mcpButton.click(); await page.waitForTimeout(600); await page.getByRole('dialog').last().getByRole('tab', { name: pt ? /Instalados/ : /Installed/ }).first().click().catch(() => undefined); await page.waitForTimeout(400) }
        const retrust = page.getByRole('dialog').last().locator('button', { hasText: pt ? /Confiar de novo/ : /Trust again/ }).nth(server === 'docs-search' ? 0 : 1)
        notes[`retrustName-${server}`] = await retrust.getAttribute('aria-label').catch(() => null)
        const present = await retrust.isVisible().catch(() => false)
        const entry: Record<string, unknown> = { present }
        if (present) {
          await retrust.click(); await page.waitForTimeout(600)
          const confirm = page.getByRole('dialog').last()
          entry.text = (await confirm.innerText()).slice(0, 1500)
          entry.buttons = await confirm.getByRole('button').allInnerTexts()
          entry.focus = await focused(page)
          await shot(`03-retrust-${server}`)
          await page.keyboard.press('Enter'); await page.waitForTimeout(400)
          entry.afterEnter = { open: await confirm.isVisible().catch(() => false) }
          if (await confirm.isVisible().catch(() => false)) await confirm.getByRole('button', { name: pt ? 'Cancelar' : 'Cancel' }).click().catch(() => page.keyboard.press('Escape'))
          await page.waitForTimeout(300)
          entry.stillQuarantined = (await panel.locator('button', { hasText: server }).first().innerText().catch(() => '')).replace(/\n/g, ' · ')
        }
        notes[`retrust-${server}`] = entry
      }
      notes.errors = consoleErrors
    } finally {
      writeFileSync(join(OUT, `${locale}.json`), JSON.stringify(notes, null, 2))
      await app.close()
    }
  })
}
