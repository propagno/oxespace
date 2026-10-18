import { _electron as electron, test, type ElectronApplication, type Page } from '@playwright/test'
import { mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * Redesign audit — captures every reachable surface plus measured design facts
 * (type scale, radii, colours, shadows, hit targets, contrast, overflow) so a
 * redesign starts from evidence instead of impressions.
 *
 * Output: e2e/screenshots/redesign-audit/{shots,metrics}. Not part of CI.
 * Run: npx playwright test --config playwright.tools.config.ts redesign-audit.spec.ts
 */
// OXESPACE_AUDIT_MODE=light|dark captures that mode into its own folder; unset keeps the default.
const MODE = process.env.OXESPACE_AUDIT_MODE === 'light' || process.env.OXESPACE_AUDIT_MODE === 'dark' ? process.env.OXESPACE_AUDIT_MODE : undefined
const OUT = join(process.cwd(), 'e2e', 'screenshots', MODE ? `redesign-audit-${MODE}` : 'redesign-audit')
const SHOTS = join(OUT, 'shots')
const METRICS = join(OUT, 'metrics')

type Surface = { name: string; metrics: unknown }
const surfaces: Surface[] = []
const consoleErrors: string[] = []
const failures: string[] = []

async function measure(page: Page): Promise<unknown> {
  return page.evaluate(() => {
    const visible = (el: Element) => {
      const r = el.getBoundingClientRect(), s = getComputedStyle(el)
      return r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < innerHeight && r.right > 0 && r.left < innerWidth &&
        s.visibility !== 'hidden' && s.display !== 'none' && s.opacity !== '0'
    }
    const tally = (map: Record<string, number>, key: string) => { map[key] = (map[key] ?? 0) + 1 }
    const fontSizes: Record<string, number> = {}, fontWeights: Record<string, number> = {}, fontFamilies: Record<string, number> = {}
    const radii: Record<string, number> = {}, shadows: Record<string, number> = {}
    const textColors: Record<string, number> = {}, bgColors: Record<string, number> = {}, borderColors: Record<string, number> = {}
    const gaps: Record<string, number> = {}
    const small: Array<{ name: string; tag: string; w: number; h: number }> = []
    const unnamed: Array<{ tag: string; cls: string; w: number; h: number }> = []
    // Computed colors can be `color(srgb …)` or `oklab(…)` (color-mix output), so ask a canvas for plain RGBA.
    const ctx = document.createElement('canvas').getContext('2d', { willReadFrequently: true })!
    const rgb = (v: string): number[] => {
      if (!v || v === 'transparent') return [0, 0, 0, 0]
      ctx.clearRect(0, 0, 1, 1); ctx.fillStyle = '#000'; ctx.fillStyle = v; ctx.fillRect(0, 0, 1, 1)
      const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data
      return [r, g, b, a / 255]
    }
    const lum = (c: number[]) => c.slice(0, 3).map(x => x / 255).map(x => x <= .04045 ? x / 12.92 : ((x + .055) / 1.055) ** 2.4)
      .reduce((s, x, i) => s + x * [.2126, .7152, .0722][i], 0)
    const contrast: Array<{ text: string; ratio: number; size: string }> = []
    let elements = 0
    for (const el of document.querySelectorAll('body *')) {
      if (!visible(el)) continue
      elements++
      const s = getComputedStyle(el)
      const hasText = [...el.childNodes].some(n => n.nodeType === 3 && n.textContent?.trim())
      if (hasText) {
        tally(fontSizes, s.fontSize); tally(fontWeights, s.fontWeight)
        tally(fontFamilies, s.fontFamily.split(',')[0].replace(/["']/g, '').trim())
        tally(textColors, s.color)
        const fg = rgb(s.color)
        let node: Element | null = el, bg: number[] = []
        while (node) { const c = rgb(getComputedStyle(node).backgroundColor); if (c.length === 3 || c[3] === 1) { bg = c; break } if (c[3] > 0) break; node = node.parentElement }
        if (bg.length && fg.length >= 3 && (fg.length === 3 || fg[3] === 1)) {
          const a = lum(fg), b = lum(bg), ratio = (Math.max(a, b) + .05) / (Math.min(a, b) + .05)
          const px = parseFloat(s.fontSize)
          if (ratio < (px >= 24 || px >= 18.66 && +s.fontWeight >= 700 ? 3 : 4.5)) contrast.push({ cls: String((el as HTMLElement).className).slice(0, 60), parent: String(el.parentElement?.className ?? '').slice(0, 40), text: (el.textContent ?? '').trim().slice(0, 50), ratio: Math.round(ratio * 100) / 100, size: s.fontSize })
        }
      }
      if (s.borderRadius !== '0px') tally(radii, s.borderRadius)
      if (s.boxShadow !== 'none') tally(shadows, s.boxShadow.slice(0, 80))
      if (rgb(s.backgroundColor)[3] !== 0 && s.backgroundColor !== 'rgba(0, 0, 0, 0)') tally(bgColors, s.backgroundColor)
      if (parseFloat(s.borderTopWidth) > 0) tally(borderColors, s.borderTopColor)
      if (s.display.includes('flex') || s.display.includes('grid')) { if (s.rowGap !== 'normal' && s.rowGap !== '0px') tally(gaps, s.rowGap); if (s.columnGap !== 'normal' && s.columnGap !== '0px') tally(gaps, s.columnGap) }
      if (el.matches('button,a[href],input,select,textarea,[role="button"],[role="tab"],[role="menuitem"]')) {
        const r = el.getBoundingClientRect()
        const name = el.getAttribute('aria-label') || el.getAttribute('title') || el.textContent?.trim().slice(0, 40) || ''
        if (!name && !(el as HTMLInputElement).placeholder) unnamed.push({ tag: el.tagName, cls: String(el.className).slice(0, 60), w: Math.round(r.width), h: Math.round(r.height) })
        if (r.width < 24 || r.height < 24) small.push({ name, tag: el.tagName, w: Math.round(r.width), h: Math.round(r.height) })
      }
    }
    const top = (m: Record<string, number>, n = 25) => Object.entries(m).sort((a, b) => b[1] - a[1]).slice(0, n)
    const root = getComputedStyle(document.documentElement)
    const cssVars: Record<string, string> = {}
    for (const sheet of document.styleSheets) {
      try { for (const rule of sheet.cssRules) if (rule instanceof CSSStyleRule && rule.selectorText === ':root') for (const p of rule.style) if (p.startsWith('--')) cssVars[p] = root.getPropertyValue(p).trim() } catch { /* cross-origin */ }
    }
    return {
      viewport: { w: innerWidth, h: innerHeight }, theme: document.documentElement.dataset.theme, density: document.documentElement.dataset.density,
      elements, horizontalOverflow: document.documentElement.scrollWidth > innerWidth || document.body.scrollWidth > innerWidth,
      fontSizes: top(fontSizes), fontWeights: top(fontWeights), fontFamilies: top(fontFamilies),
      radii: top(radii), shadows: top(shadows, 10), textColors: top(textColors), bgColors: top(bgColors), borderColors: top(borderColors, 15), gaps: top(gaps),
      smallTargets: small.slice(0, 30), unnamedControls: unnamed.slice(0, 20), contrastFailures: contrast.slice(0, 30), contrastFailureCount: contrast.length,
      buttons: document.querySelectorAll('button').length, inputs: document.querySelectorAll('input,select,textarea').length,
      cssVarCount: Object.keys(cssVars).length
    }
  })
}

async function capture(page: Page, name: string): Promise<void> {
  await page.waitForTimeout(350)
  await page.screenshot({ path: join(SHOTS, `${name}.png`) })
  surfaces.push({ name, metrics: await measure(page) })
}

async function step(name: string, fn: () => Promise<void>): Promise<void> {
  try { await fn() } catch (e) { failures.push(`${name}: ${(e as Error).message.split('\n')[0]}`) }
}

async function resize(app: ElectronApplication, width: number, height: number): Promise<void> {
  await app.evaluate(({ BrowserWindow }, [w, h]) => {
    const win = BrowserWindow.getAllWindows()[0]
    win.setSize(w, h)
    win.center()
  }, [width, height])
}

test('redesign audit', async () => {
  // Walks every surface in one session; the default 30 s per-test timeout is far too short.
  test.setTimeout(15 * 60_000)
  mkdirSync(SHOTS, { recursive: true })
  mkdirSync(METRICS, { recursive: true })
  const root = join(tmpdir(), `oxespace-audit-${Date.now()}`)
  const workspaceRoot = join(root, 'demo-repo')
  mkdirSync(workspaceRoot, { recursive: true })

  const app = await electron.launch({
    args: [join(process.cwd(), 'e2e', 'electron-main.cjs')],
    env: { ...process.env, OXESPACE_DISABLE_SINGLE_INSTANCE: '1', OXESPACE_E2E_MOCK_NATIVE: '1', OXESPACE_DB_PATH: join(root, 'oxespace.sqlite3') }
  })
  const page = await app.firstWindow()
  page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 300)) })
  page.on('pageerror', e => consoleErrors.push(`pageerror: ${e.message.slice(0, 300)}`))
  await page.waitForLoadState('domcontentloaded')
  if (MODE) {
    // The window may still navigate while it boots; let it settle before writing the setting.
    await page.waitForLoadState('load')
    await page.waitForTimeout(1500)
    await page.evaluate(mode => localStorage.setItem('oxe-settings', JSON.stringify({ state: { appearance: mode, notificationsEnabled: true, visitedWorkspacesCap: 5 }, version: 3 })), MODE)
    await page.reload()
    await page.waitForLoadState('domcontentloaded')
  }
  await page.waitForTimeout(1000)
  await resize(app, 1440, 900)

  try {
    await step('empty', () => capture(page, '01-empty-state'))

    await step('wizard', async () => {
      await page.getByTestId('btn-new-workspace').click()
      await capture(page, '02-new-workspace-wizard')
      await page.getByTestId('wizard-dir-input').fill(workspaceRoot)
      await capture(page, '03-new-workspace-wizard-filled')
      await page.getByTestId('wizard-launch-btn').click()
      await page.waitForSelector('[data-testid="workspace-grid"], [data-testid="workspace-split-grid"]', { timeout: 10000 })
    })
    await step('workspace', () => capture(page, '04-workspace'))

    // Responsive sweep on the main workspace surface.
    for (const [w, h] of [[1920, 1080], [1100, 720], [900, 600]] as const) {
      await step(`resize-${w}`, async () => { await resize(app, w, h); await page.waitForTimeout(400); await capture(page, `05-workspace-${w}x${h}`) })
    }
    await resize(app, 1440, 900)

    await step('sidebar-collapsed', async () => {
      await page.getByRole('button', { name: 'Collapse sidebar' }).click()
      await capture(page, '06-sidebar-collapsed')
      await page.getByRole('button', { name: 'Expand sidebar' }).click()
    })

    // Theme + density sweep.
    const themes = ['midnight', 'nord', 'dracula', 'ocean', 'monokai', 'amber', 'rose-pine', 'gruvbox', 'one-dark', 'synthwave84', 'github-dark']
    for (const t of themes) {
      await step(`theme-${t}`, async () => {
        await page.evaluate(v => { document.documentElement.dataset.theme = v }, t)
        await capture(page, `07-theme-${t}`)
      })
    }
    await page.evaluate(() => { document.documentElement.dataset.theme = 'midnight'; document.documentElement.dataset.density = 'comfortable' })
    await step('density', () => capture(page, '08-density-comfortable'))
    await page.evaluate(() => { delete document.documentElement.dataset.density })

    await step('palette', async () => { await page.keyboard.press('Control+k'); await capture(page, '09-command-palette'); await page.keyboard.press('Escape') })

    // Tools menu: record the live item list, then visit every item.
    let items: string[] = []
    await step('tools-menu', async () => {
      await page.getByTestId('btn-open-tools').click()
      await capture(page, '10-tools-menu')
      items = (await page.getByRole('menu', { name: 'Panels' }).getByRole('menuitemcheckbox').allInnerTexts()).map(t => t.split('\n')[0].trim()).filter(Boolean)
      writeFileSync(join(METRICS, 'tools-menu-items.json'), JSON.stringify(items, null, 2))
      await page.keyboard.press('Escape')
    })
    for (const [i, label] of items.entries()) {
      await step(`tool-${label}`, async () => {
        await page.getByTestId('btn-open-tools').click()
        await page.getByRole('menu', { name: 'Panels' }).getByRole('menuitemcheckbox').filter({ hasText: label }).first().click()
        await page.waitForTimeout(500)
        await capture(page, `11-tool-${String(i).padStart(2, '0')}-${label.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 30)}`)
        const dlg = page.getByRole('dialog').first()
        if (await dlg.count()) { const c = dlg.getByRole('button', { name: 'Close' }).first(); if (await c.count()) await c.click().catch(() => undefined) }
        await page.keyboard.press('Escape')
        await page.waitForTimeout(300)
      })
    }

    // Settings: both scopes, every category.
    await step('settings', async () => {
      await page.keyboard.press('Control+,')
      await page.locator('.settings-center').waitFor({ timeout: 5000 })
      for (const scope of ['Application', 'Workspace']) {
        await step(`scope-${scope}`, async () => {
          await page.getByRole('group', { name: 'Settings scope' }).getByRole('button', { name: scope === 'Application' ? scope : /Current workspace/ }).click()
          const nav = page.getByRole('navigation', { name: 'Settings categories' }).getByRole('button')
          const n = await nav.count()
          for (let i = 0; i < n; i++) {
            const label = ((await nav.nth(i).innerText()).split('\n')[0] || `cat${i}`).trim()
            await nav.nth(i).click()
            await capture(page, `12-settings-${scope.toLowerCase()}-${String(i).padStart(2, '0')}-${label.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 24)}`)
          }
        })
      }
      await page.keyboard.press('Escape')
    })
  } finally {
    writeFileSync(join(METRICS, 'surfaces.json'), JSON.stringify(surfaces, null, 2))
    writeFileSync(join(METRICS, 'console-errors.json'), JSON.stringify([...new Set(consoleErrors)], null, 2))
    writeFileSync(join(METRICS, 'step-failures.json'), JSON.stringify(failures, null, 2))
    await app.close()
  }
})
