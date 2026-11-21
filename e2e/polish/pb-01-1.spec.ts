// Frozen end-to-end acceptance test for 1.5.2 Polimento · Componentes base (Jira OXE-192, PB-01·1, CA-4), in the built
// app with real services (OXESPACE_E2E_MOCK_NATIVE=0) and emulated forced colours. Written by the planner; the executor
// must not edit it. Red while the Language select draws its arrow as a background image, which forced colours drop.
import { expect, test, type Locator, type Page } from '@playwright/test'
import { launchApp, openDemoWorkspace } from '../helpers/launch'
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
test('PB-01·1 in the app: in forced colours the Language select in Settings › Appearance shows its chevron', async () => {
  test.setTimeout(180_000)
  const { app, page, workspaceRoot } = await launchApp({ appearance: 'light', realClock: true, env: REAL })
  try {
    await openDemoWorkspace(page, workspaceRoot)
    await page.emulateMedia({ forcedColors: 'active' })
    await openSettingsPage(page, 'appearance')
    const select = page.getByTestId('settings-language')
    await expect(select).toBeVisible()
    expect(await select.evaluate(el => getComputedStyle(el).backgroundImage), 'no background-image arrow').toBe('none')
    const chevron = select.locator('xpath=..').locator(':scope > svg')
    await expect(chevron, 'an svg chevron beside the select').toHaveCount(1)
    await expect(chevron).toBeVisible()
    const box = (await chevron.boundingBox())!
    expect(Math.round(box.width)).toBe(12)
    const paint = await chevron.evaluate(el => {
      const svg = getComputedStyle(el)
      const line = el.querySelector('path, polyline, line')
      return { stroke: line ? getComputedStyle(line).stroke : svg.stroke, color: svg.color, events: svg.pointerEvents, display: svg.display, visibility: svg.visibility }
    })
    const colors = await systemColors(page)
    const field = await select.evaluate(el => getComputedStyle(el).backgroundColor)
    expect(paint.display).not.toBe('none')
    expect(paint.visibility).toBe('visible')
    expect(paint.events).toBe('none')
    expect(paint.stroke, 'the chevron is drawn in the text colour').toBe(paint.color)
    expect(paint.stroke, 'and it differs from the field behind it').not.toBe(field)
    expect([colors.canvasText, await select.evaluate(el => getComputedStyle(el).color)]).toContain(paint.stroke)
  } finally {
    await app.close()
  }
})
