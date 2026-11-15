// Frozen end-to-end acceptance test for 1.5.2 Polimento · Componentes base (Jira OXE-197, PB-01·6, CA-1 to CA-3), in the
// built app with real services (OXESPACE_E2E_MOCK_NATIVE=0). Written by the planner; the executor must not edit it.
// The OxeCode sidebar and the workspace beside it are split by the sidebar's edge Splitter (src/ui, `edge`). Its grab
// area is 24 px centred on the line: 10 px on either side of the line still grabs it (somewhere along the line where
// no control sits), and a drag that starts 10 px from the line resizes the sidebar. A control that touches the band
// keeps its own click (CA-2): the point of the control inside the band hits the control. Red while the edge grabs
// only a 4 px strip inside the sidebar.
import { expect, test, type Locator, type Page } from '@playwright/test'
import { launchApp, layoutAtWidth, openDemoWorkspace } from '../helpers/launch'
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
test('PB-01·6 in the app: the sidebar splitter grabs 10 px from its line, resizes from there, and leaves nearby buttons their click', async () => {
  test.setTimeout(180_000)
  const { app, page, workspaceRoot } = await launchApp({ appearance: 'light', realClock: true, env: REAL })
  try {
    await layoutAtWidth(app, page, 1440, 900)
    await openDemoWorkspace(page, workspaceRoot)
    await page.locator('[data-app-mode="code"]').first().click()
    const splitter = page.getByRole('separator', { name: cat('code', 'sidebar.width') }).first()
    await expect(splitter).toBeAttached()
    const geometry = await splitter.evaluate(el => {
      const sidebar = ((el as HTMLElement).offsetParent ?? el.parentElement) as HTMLElement
      const box = sidebar.getBoundingClientRect()
      const line = Math.round(box.right)
      const isMine = (x: number, y: number): boolean => document.elementFromPoint(x, y)?.closest('[role="separator"]') === el
      let grabY = -1
      for (let y = Math.round(box.top) + 48; y < box.bottom - 48 && grabY < 0; y += 6) if (isMine(line - 10, y) && isMine(line + 10, y)) grabY = y
      const controls = [...document.querySelectorAll<HTMLElement>('button, [role="button"], a[href], input, select, [role="tab"]')]
        .filter(node => node !== el && node.getClientRects().length > 0)
        .map(node => ({ node, rect: node.getBoundingClientRect() }))
        .filter(({ rect }) => rect.width > 0 && rect.height > 0 && rect.right > line - 12 && rect.left < line + 12)
      const stolen = controls.filter(({ node, rect }) => {
        const x = Math.min(Math.max(line, rect.left + 1), rect.right - 1)
        const y = rect.top + rect.height / 2
        const hit = document.elementFromPoint(x, y)
        return !(hit && node.contains(hit))
      }).map(({ node }) => (node.getAttribute('aria-label') ?? node.textContent ?? node.tagName).trim().slice(0, 60))
      return { line, grabY, width: Math.round(box.width), stolen }
    })
    expect(geometry.grabY, '10 px on both sides of the line grabs the splitter somewhere along it').toBeGreaterThan(0)
    expect(geometry.stolen, 'controls touching the grab band keep their click').toEqual([])
    await page.mouse.move(geometry.line + 10, geometry.grabY)
    await page.mouse.down()
    await page.mouse.move(geometry.line + 70, geometry.grabY, { steps: 6 })
    await page.mouse.up()
    const after = await splitter.evaluate(el => Math.round((((el as HTMLElement).offsetParent ?? el.parentElement) as HTMLElement).getBoundingClientRect().width))
    expect(after - geometry.width, 'a drag started 10 px from the line widens the sidebar').toBeGreaterThanOrEqual(30)
  } finally {
    await app.close()
  }
})
