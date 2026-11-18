// Frozen end-to-end acceptance test for 1.5.2 Polimento · Componentes base (Jira OXE-203, PB-01·12, CA-3), in the built
// app with real services (OXESPACE_E2E_MOCK_NATIVE=0). Written by the planner; the executor must not edit it.
// The design-system viewer (Components) is measured in the compact and the comfortable density: the Kbd and the Badge
// grow with the type (taller in comfortable) and never clip their text (scrollHeight <= clientHeight), and the Panel
// header (one with only its title, in States) is --bar-lg tall in each density. Red while Kbd, Badge and the Panel header keep fixed px heights.
import { expect, test, type Locator, type Page } from '@playwright/test'
import { launchApp, setAppearance } from '../helpers/launch'
import { openSettings } from '../helpers/settings'
// ---- repository text and catalog strings (inlined in each frozen file so every task's PR stands alone) ----
import { readFileSync as pbReadFile } from 'node:fs'
import { join as pbJoin } from 'node:path'

const pbRead = (rel: string): string => pbReadFile(pbJoin(process.cwd(), rel), 'utf8').replace(/\r\n/g, '\n')
const pbCatalogs: Record<string, unknown> = {}
/** The English catalog text of `ns:key` (shared/locales/en/<ns>.json), so elements are found by what a person reads. */
function cat(ns: string, key: string, vars: Record<string, string | number> = {}): string {
  pbCatalogs[ns] ??= JSON.parse(pbRead(`shared/locales/en/${ns}.json`))
  let node: unknown = pbCatalogs[ns]
  for (const part of key.split('.')) node = (node as Record<string, unknown> | undefined)?.[part]
  if (typeof node !== 'string') throw new Error(`the en ${ns} catalog has no key ${key}`)
  return node.replace(/\{\{(\w+)\}\}/g, (_, name: string) => String(vars[name] ?? `{{${name}}}`))
}
// ---- the built app with real services (inlined so every task's PR stands alone) ----
// Every spec launches with OXESPACE_E2E_MOCK_NATIVE=0: the real main process, real terminals, real OxeQuery worker.
const REAL = { OXESPACE_E2E_MOCK_NATIVE: '0' }

/** The system colours as this page resolves them (meaningful under emulated forced colours). */
function systemColors(page: Page): Promise<{ highlight: string; highlightText: string; canvas: string; canvasText: string }> {
  return page.evaluate(() => {
    const probe = document.createElement('div')
    document.body.append(probe)
    const read = (value: string): string => { probe.style.color = value; return getComputedStyle(probe).color }
    const out = { highlight: read('Highlight'), highlightText: read('HighlightText'), canvas: read('Canvas'), canvasText: read('CanvasText') }
    probe.remove()
    return out
  })
}

/** The computed colour a token resolves to next to `near` (same mode subtree), e.g. tokenColor(badge, '--attn-fg'). */
function tokenColor(near: Locator, token: string): Promise<string> {
  return near.evaluate((element, name) => {
    const probe = document.createElement('span')
    probe.style.color = `var(${name})`
    element.parentElement!.append(probe)
    const value = getComputedStyle(probe).color
    probe.remove()
    return value
  }, token)
}

/** A px length a token resolves to on the page root (e.g. --control-lg). */
function tokenPx(page: Page, token: string): Promise<number> {
  return page.evaluate(name => {
    const probe = document.createElement('div')
    probe.style.height = `var(${name})`
    document.body.append(probe)
    const value = probe.getBoundingClientRect().height
    probe.remove()
    return value
  }, token)
}

/** WCAG contrast of two computed colours (rgb/rgba strings; alpha composited over white is not needed here). */
function contrastOf(a: string, b: string): number {
  const lum = (value: string): number => {
    const [r, g, bl] = (value.match(/[\d.]+/g) ?? ['0', '0', '0']).slice(0, 3).map(Number).map(c => c / 255).map(c => c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl
  }
  const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m)
  return (x + 0.05) / (y + 0.05)
}

/** The colour behind an element: the first ancestor (itself excluded) with an opaque background. */
function backdropOf(target: Locator): Promise<string> {
  return target.evaluate(element => {
    for (let node = element.parentElement; node; node = node.parentElement) {
      const background = getComputedStyle(node).backgroundColor
      if (background && !/rgba\(\s*\d+,\s*\d+,\s*\d+,\s*0\s*\)|transparent/.test(background)) return background
    }
    return getComputedStyle(document.body).backgroundColor
  })
}

/** Opens Settings and one of its pages by the page's name in the catalog (settings center.pages.<id>.label). */
async function openSettingsPage(page: Page, id: string): Promise<void> {
  await openSettings(page)
  const nav = page.getByRole('navigation', { name: cat('settings', 'center.categories') })
  await nav.getByRole('button', { name: new RegExp(`^${cat('settings', `center.pages.${id}.label`)}\\b`) }).first().click()
}

/** The design-system viewer, opened from the command palette as a person does. */
async function openDesignSystem(page: Page, section?: string): Promise<Locator> {
  await page.keyboard.press('Control+Shift+P')
  await page.keyboard.insertText('design system')
  await page.getByRole('option', { name: /design system viewer/i }).first().click()
  const viewer = page.getByRole('dialog', { name: 'Design system' })
  await expect(viewer).toBeVisible()
  if (section) {
    await viewer.getByRole('navigation', { name: 'Design system sections' }).getByRole('button', { name: section, exact: true }).click()
    await expect(viewer.getByRole('heading', { level: 2 }).first()).toBeVisible()
  }
  return viewer
}
test('PB-01·12 in the app: Kbd, Badge and the Panel header grow in the comfortable density and clip nothing', async () => {
  test.setTimeout(240_000)
  const { app, page } = await launchApp({ appearance: 'light', realClock: true, env: REAL })
  try {
    const sizes: Record<string, { kbd: number; badge: number }> = {}
    for (const density of ['compact', 'comfortable'] as const) {
      await setAppearance(page, 'light', density)
      const viewer = await openDesignSystem(page, 'Components')
      const kbd = viewer.locator('kbd', { hasText: /^Ctrl$/ }).first()
      const badge = viewer.locator('span', { hasText: /^Draft$/ }).first()
      const box = (target: Locator) => target.evaluate(el => ({ height: el.getBoundingClientRect().height, clips: el.scrollHeight > el.clientHeight + 0.5 }))
      const [k, b] = [await box(kbd), await box(badge)]
      expect(k.clips, `${density}: the Kbd clips its text`).toBe(false)
      expect(b.clips, `${density}: the Badge clips its text`).toBe(false)
      sizes[density] = { kbd: k.height, badge: b.height }
      // A Panel header with only its title (States › Empty › Recent conversations), so no action sets its height.
      await viewer.getByRole('navigation', { name: 'Design system sections' }).getByRole('button', { name: 'States', exact: true }).click()
      const header = viewer.getByRole('heading', { name: 'Recent conversations', level: 3 }).first().locator('xpath=..')
      await expect(header).toBeVisible()
      expect(Math.round((await header.boundingBox())!.height), `${density}: the Panel header`).toBe(Math.round(await tokenPx(page, '--bar-lg')))
      await page.keyboard.press('Escape')
    }
    expect(sizes.comfortable.kbd, 'the Kbd is taller in comfortable').toBeGreaterThan(sizes.compact.kbd)
    expect(sizes.comfortable.badge, 'the Badge is taller in comfortable').toBeGreaterThan(sizes.compact.badge)
  } finally {
    await app.close()
  }
})
