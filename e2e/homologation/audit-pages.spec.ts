import { test, type Page } from '@playwright/test'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { launchApp, openDemoWorkspace, resizeWindow } from '../helpers/launch'

/**
 * Redesign audit, part 3 (pages and modals per mode), black box, in light/dark × pt-BR/en: every surface a person
 * reaches is captured and measured — horizontal overflow, targets under 24px, text under AA contrast, and (pt-BR)
 * English words left on screen. Not part of CI. Output: e2e/screenshots/homologation/audit-pages/<combo>/
 */
const ROOT = join(process.cwd(), 'e2e', 'screenshots', 'homologation', 'audit-pages')

const ENGLISH = /\b(the|and|your|with|this|for|from|open|close|new|add|remove|settings|search|filter|no |not |yet|run|stop|loading|failed|error|save|cancel|delete|create|select|choose|show|hide|use|connect|send|import|export|copy)\b/i

const measure = (page: Page, locale: string) => page.evaluate(pt => {
  const visible = (el: Element) => { const r = el.getBoundingClientRect(), s = getComputedStyle(el); return r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < innerHeight && s.visibility !== 'hidden' && s.display !== 'none' && s.opacity !== '0' }
  const ctx = document.createElement('canvas').getContext('2d', { willReadFrequently: true })!
  const rgb = (v: string) => { ctx.clearRect(0, 0, 1, 1); ctx.fillStyle = '#000'; ctx.fillStyle = v; ctx.fillRect(0, 0, 1, 1); const d = ctx.getImageData(0, 0, 1, 1).data; return [d[0], d[1], d[2], d[3] / 255] }
  const lum = (c: number[]) => c.slice(0, 3).map(x => x / 255).map(x => x <= .04045 ? x / 12.92 : ((x + .055) / 1.055) ** 2.4).reduce((s, x, i) => s + x * [.2126, .7152, .0722][i], 0)
  const small: string[] = [], lowContrast: string[] = [], english: string[] = []
  for (const el of document.querySelectorAll('body *')) {
    if (!visible(el) || el.closest('.xterm, .monaco-editor')) continue
    const s = getComputedStyle(el)
    const own = [...el.childNodes].filter(n => n.nodeType === 3).map(n => n.textContent?.trim()).filter(Boolean).join(' ')
    if (own) {
      const fg = rgb(s.color); let node: Element | null = el, bg: number[] = []
      while (node) { const c = rgb(getComputedStyle(node).backgroundColor); if (c[3] === 1) { bg = c; break } node = node.parentElement }
      if (bg.length && fg[3] === 1) {
        const a = lum(fg), b = lum(bg), ratio = (Math.max(a, b) + .05) / (Math.min(a, b) + .05), px = parseFloat(s.fontSize)
        if (ratio < (px >= 24 || (px >= 18.66 && +s.fontWeight >= 700) ? 3 : 4.5) && !(el as HTMLElement).closest('[disabled],[aria-disabled="true"]')) lowContrast.push(`${own.slice(0, 40)} (${ratio.toFixed(2)})`)
      }
      if (pt && /[a-z]{3,}/i.test(own) && !/[áéíóúãõçâêô]/i.test(own)) english.push(own.slice(0, 60))
    }
    if (el.matches('button,a[href],input:not([type=hidden]),select,[role="button"],[role="tab"],[role="menuitem"],[role="checkbox"],[role="switch"]')) {
      const r = el.getBoundingClientRect()
      if ((r.width < 24 || r.height < 24) && !el.closest('.xterm')) small.push(`${el.getAttribute('aria-label') || (el.textContent ?? '').trim().slice(0, 30) || el.tagName} ${Math.round(r.width)}x${Math.round(r.height)}`)
    }
  }
  return { overflow: document.documentElement.scrollWidth > innerWidth + 1, small: [...new Set(small)], lowContrast: [...new Set(lowContrast)], english: pt ? [...new Set(english)] : [] }
}, locale === 'pt-BR').then(m => ({ ...m, english: m.english.filter(t => ENGLISH.test(t)) }))

for (const [appearance, locale] of [['light', 'pt-BR'], ['dark', 'en-US'], ['dark', 'pt-BR'], ['light', 'en-US']] as const) {
  test(`pages and modals: ${appearance} ${locale}`, async () => {
    test.setTimeout(540_000)
    const combo = `${appearance}-${locale}`
    const OUT = join(ROOT, combo); mkdirSync(OUT, { recursive: true })
    const surfaces: Record<string, unknown> = {}
    const { app, page, workspaceRoot, consoleErrors } = await launchApp({ locale, appearance })
    const pt = locale === 'pt-BR'
    const visit = async (name: string) => {
      await page.waitForTimeout(500)
      await page.screenshot({ path: join(OUT, `${name}.png`) })
      surfaces[name] = await measure(page, locale)
    }
    const esc = async () => { for (let i = 0; i < 3; i++) await page.keyboard.press('Escape'); await page.waitForTimeout(200) }
    try {
      await resizeWindow(app, 1280, 860)
      await page.getByTestId('btn-new-workspace').first().waitFor()
      await visit('00-start')
      await page.getByTestId('btn-new-workspace').first().click(); await visit('01-modal-new-workspace'); await esc()
      await openDemoWorkspace(page, workspaceRoot)
      for (const [key, name] of [['1', 'code'], ['2', 'chat'], ['3', 'query'], ['4', 'pod'], ['5', 'post']] as const) { await page.keyboard.press(`Control+${key}`); await page.waitForTimeout(800); await visit(`10-mode-${name}`) }
      // Modals reachable per mode.
      await page.keyboard.press('Control+2'); await page.waitForTimeout(500)
      await page.getByRole('button', { name: /^(New conversation|Nova conversa)$/ }).first().click().catch(() => undefined); await visit('20-modal-new-conversation'); await esc()
      await page.keyboard.press('Control+3'); await page.waitForTimeout(500)
      await page.getByRole('button', { name: /^(New connection|Nova conexão)$/ }).first().click().catch(() => undefined); await visit('21-modal-new-connection'); await esc()
      await page.keyboard.press('Control+5'); await page.waitForTimeout(500)
      await page.getByRole('button', { name: /Import cURL|Importar cURL/ }).first().click().catch(() => undefined); await visit('22-modal-oxepost-import'); await esc()
      await page.keyboard.press('Control+4'); await page.waitForTimeout(800)
      await page.getByRole('button', { name: /^(Remove|Remover)…?$/ }).first().click().catch(() => undefined); await visit('23-modal-remove-container'); await esc()
      await page.keyboard.press('Control+1'); await page.waitForTimeout(500)
      await page.getByRole('button', { name: /^Team$|^Equipe$/ }).first().click().catch(() => undefined); await visit('24-modal-team'); await esc()
      await page.keyboard.press('Shift+?').catch(() => undefined); await visit('25-shortcuts'); await esc()
      // Help: About and Report a problem from the palette.
      for (const [query, name] of [[pt ? 'Sobre' : 'About', '26-modal-about'], [pt ? 'Relatar' : 'Report a problem', '27-modal-report']] as const) {
        await page.keyboard.press('Control+k'); await page.locator('[cmdk-root]').waitFor().catch(() => undefined)
        await page.keyboard.insertText(query); await page.waitForTimeout(200)
        await page.locator('[cmdk-item]').first().click().catch(() => undefined); await visit(name); await esc()
      }
      // Settings: every category, app scope then workspace scope.
      await page.keyboard.press('Control+,'); await page.locator('.settings-center').waitFor({ timeout: 10_000 }).catch(() => undefined)
      const nav = page.getByRole('navigation').filter({ has: page.locator('button') }).last()
      const count = await nav.getByRole('button').count()
      for (let i = 0; i < count; i++) {
        const label = (await nav.getByRole('button').nth(i).innerText().catch(() => String(i))).trim().replace(/\W+/g, '_').slice(0, 24)
        await nav.getByRole('button').nth(i).click().catch(() => undefined); await visit(`30-settings-${String(i).padStart(2, '0')}-${label}`)
      }
      const scope = page.getByRole('group').filter({ has: page.getByRole('button', { name: /demo-repo/ }) }).first()
      if (await scope.getByRole('button', { name: /demo-repo/ }).first().click().then(() => true, () => false)) {
        const wsCount = await nav.getByRole('button').count()
        for (let i = 0; i < wsCount; i++) {
          const label = (await nav.getByRole('button').nth(i).innerText().catch(() => String(i))).trim().replace(/\W+/g, '_').slice(0, 24)
          await nav.getByRole('button').nth(i).click().catch(() => undefined); await visit(`40-workspace-settings-${String(i).padStart(2, '0')}-${label}`)
        }
      }
      surfaces.consoleErrors = consoleErrors
    } finally {
      writeFileSync(join(OUT, 'metrics.json'), JSON.stringify(surfaces, null, 2))
      await app.close()
    }
  })
}
