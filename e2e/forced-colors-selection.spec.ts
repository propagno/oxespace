import { expect, test, type Locator, type Page } from '@playwright/test'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { scanSurface, type Violation } from './helpers/a11y'
import { launchApp, openDemoWorkspace, resizeWindow, type Appearance } from './helpers/launch'
import { openView } from './helpers/oxepod'

/**
 * Forced colors (Windows high contrast) keeps the chosen option and the state of a switch readable (roadmap F31,
 * homologation P3-6/P3-7). The browser drops every author background and shadow under forced colors, and those were
 * the only thing that told the chosen segment, the chosen engine card and an on switch apart. Each surface is opened
 * with forced colors on, over a light and a dark base, and:
 *
 * - in every radio group, the chosen option is painted in the Highlight system color and the others are not, so the
 *   difference survives the palette; a SegmentedControl option also carries a tick;
 * - a pressed toggle (the Settings scope rows) is painted the same way;
 * - the Read-only switch draws its track with a visible CanvasText line, and on and off render differently (track
 *   fill, thumb color and thumb position);
 * - a colour swatch keeps its colour, and the chosen one is ringed in Highlight;
 * - axe finds nothing on the surface (color contrast aside, see below);
 * - the F22 leftovers measure 24×24 px or more here too: the Favorite checkbox, whose label is its target (Chromium
 *   draws a native box at its own size and ignores padding), and the Settings scope rows (e2e/target-size.spec.ts
 *   measures them, and the workspace name in the Code sidebar, in both densities).
 *
 * Screenshots: e2e/screenshots/forced-colors/<surface>-<base>.png, measurements in report-<base>.json next to them.
 */
const OUT = join(process.cwd(), 'e2e/screenshots/forced-colors')
const MIN = 24

interface Paint { name: string; checked: string | null; background: string; color: string; outline: string; border: string; tick: string }
const report: Record<string, unknown> = {}

/** The system colors as this page resolves them under forced colors. */
function systemColors(page: Page): Promise<{ highlight: string; canvas: string; canvasText: string }> {
  return page.evaluate(() => {
    const probe = document.createElement('div')
    document.body.append(probe)
    const read = (value: string) => { probe.style.color = value; return getComputedStyle(probe).color }
    const out = { highlight: read('Highlight'), canvas: read('Canvas'), canvasText: read('CanvasText') }
    probe.remove()
    return out
  })
}

/** How each option of `selector` inside `root` is painted. */
function paints(root: Locator, selector: string): Promise<Paint[]> {
  return root.evaluate((element, query) => Array.from(element.querySelectorAll(query)).filter(node => (node as HTMLElement).getClientRects().length > 0).map(node => {
    const style = getComputedStyle(node)
    const before = getComputedStyle(node, '::before').content
    return {
      name: (node.getAttribute('aria-label') ?? node.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 40),
      checked: node.getAttribute('aria-checked') ?? node.getAttribute('aria-pressed'),
      background: style.backgroundColor,
      color: style.color,
      outline: `${style.outlineStyle} ${style.outlineWidth} ${style.outlineColor}`,
      border: `${style.borderTopStyle} ${style.borderTopWidth} ${style.borderTopColor}`,
      tick: before === 'none' || before === 'normal' ? '' : before
    }
  }), selector)
}

/** In each radio group of `root`, the chosen option is painted in Highlight and none of the others is. */
async function expectChoicesMarked(page: Page, surface: string, root: Locator, groups: string[]): Promise<void> {
  const { highlight } = await systemColors(page)
  for (const group of groups) {
    const radiogroup = root.getByRole('radiogroup', { name: group, exact: true })
    await expect(radiogroup, `${surface}: ${group}`).toBeVisible()
    const options = await paints(radiogroup, '[role=radio]')
    report[`${surface} ${group}`] = options
    const chosen = options.filter(option => option.checked === 'true')
    const others = options.filter(option => option.checked !== 'true')
    expect(chosen, `${surface}: ${group} has one chosen option`).toHaveLength(1)
    expect(others.length, `${surface}: ${group} has other options`).toBeGreaterThan(0)
    expect(chosen[0].background, `${surface}: ${group} chosen option is filled with Highlight`).toBe(highlight)
    for (const other of others) {
      expect(other.background, `${surface}: ${group} "${other.name}" is not filled like the chosen one`).not.toBe(highlight)
      // The options not chosen keep an edge, so the row still reads as a set of choices.
      expect(other.outline.startsWith('none') && other.border.startsWith('none'), `${surface}: ${group} "${other.name}" keeps an edge`).toBe(false)
    }
  }
}

/** A SegmentedControl option carries a tick while chosen, a mark that does not depend on color at all. */
async function expectTick(root: Locator, group: string): Promise<void> {
  const options = await paints(root.getByRole('radiogroup', { name: group, exact: true }), '[role=radio]')
  expect(options.filter(option => option.checked === 'true').every(option => option.tick.includes('✓')), `${group}: chosen option has a tick`).toBe(true)
  expect(options.filter(option => option.checked !== 'true').every(option => option.tick === ''), `${group}: other options have no tick`).toBe(true)
}

interface SwitchPaint { track: string; trackBorder: string; thumb: string; thumbTransform: string }
function switchPaint(control: Locator): Promise<SwitchPaint> {
  return control.evaluate(node => {
    const style = getComputedStyle(node)
    const thumb = getComputedStyle(node, '::after')
    return { track: style.backgroundColor, trackBorder: `${style.borderTopStyle} ${style.borderTopWidth} ${style.borderTopColor}`, thumb: thumb.backgroundColor, thumbTransform: thumb.transform }
  })
}

/** Both states of a switch are drawn with lines that survive the palette and differ in more than one way. */
async function expectSwitchReadable(page: Page, surface: string, control: Locator): Promise<void> {
  const { canvasText, highlight } = await systemColors(page)
  const before = await switchPaint(control)
  const wasOn = await control.getAttribute('aria-checked') === 'true'
  await control.click()
  await expect(control).toHaveAttribute('aria-checked', String(!wasOn))
  // The track and thumb ease into the new state; read them once they have settled.
  await page.waitForTimeout(400)
  const after = await switchPaint(control)
  const [off, on] = wasOn ? [after, before] : [before, after]
  report[`${surface} switch`] = { off, on }
  for (const [state, paint] of [['off', off], ['on', on]] as const) {
    expect(paint.trackBorder, `${surface}: switch ${state} has a visible track line`).toMatch(/^solid [1-9]/)
    expect(paint.trackBorder, `${surface}: switch ${state} track line is not transparent`).not.toMatch(/rgba\(0, 0, 0, 0\)$/)
    expect(paint.thumb, `${surface}: switch ${state} thumb is drawn`).not.toBe('rgba(0, 0, 0, 0)')
  }
  expect(off.trackBorder.endsWith(canvasText), `${surface}: switch off track line is CanvasText`).toBe(true)
  expect(on.track, `${surface}: switch on is filled with Highlight`).toBe(highlight)
  expect(off.track, `${surface}: switch off is not`).not.toBe(highlight)
  expect(on.thumb, `${surface}: thumb color changes`).not.toBe(off.thumb)
  expect(on.thumbTransform, `${surface}: thumb moves`).not.toBe(off.thumbTransform)
  // Leave it as it was.
  await control.click()
  await expect(control).toHaveAttribute('aria-checked', String(wasOn))
}

/** The target of `control`: its own box, joined with its label's when the label toggles it. */
function target(control: Locator): Promise<{ width: number; height: number }> {
  return control.evaluate(node => {
    let rect = node.getBoundingClientRect()
    const label = node instanceof HTMLInputElement ? node.closest('label') : null
    if (label) {
      const outer = label.getBoundingClientRect()
      const left = Math.min(rect.left, outer.left), top = Math.min(rect.top, outer.top)
      rect = new DOMRect(left, top, Math.max(rect.right, outer.right) - left, Math.max(rect.bottom, outer.bottom) - top)
    }
    return { width: Math.round(rect.width * 10) / 10, height: Math.round(rect.height * 10) / 10 }
  })
}

/**
 * Color contrast is left to the scans without forced colors (e2e/visual/a11y-surfaces.spec.ts). Under emulated forced colors axe
 * still reads the author text color it would replace: over a dark base it reports #e8f1ea on #ffffff while the
 * computed color is CanvasText (black) on Canvas and the screenshot shows black text. Every other rule runs.
 */
const NOT_UNDER_FORCED_COLORS = new Set(['color-contrast'])

const violations: Violation[] = []
async function scan(page: Page, surface: string): Promise<void> {
  const found = (await scanSurface(page, `forced-colors ${surface}`)).filter(item => !NOT_UNDER_FORCED_COLORS.has(item.rule))
  violations.push(...found)
  expect(found.map(item => `${item.rule}: ${item.nodes.join(', ')}`), `${surface}: axe in forced colors`).toEqual([])
}

async function shoot(page: Page, surface: string, base: Appearance): Promise<void> {
  await page.waitForTimeout(250)
  await page.screenshot({ path: join(OUT, `${surface}-${base}.png`) })
}

const settingsDialog = (page: Page) => page.getByRole('dialog', { name: 'Settings', exact: true })

for (const base of ['light', 'dark'] as const) {
  test(`forced colors keep the chosen option and the switch state readable (${base} base)`, async () => {
    test.setTimeout(240_000)
    mkdirSync(OUT, { recursive: true })
    for (const key of Object.keys(report)) delete report[key]
    violations.length = 0
    const { app, page, workspaceRoot, consoleErrors } = await launchApp({ appearance: base })
    try {
      await resizeWindow(app, 1280, 860)
      await openDemoWorkspace(page, workspaceRoot)
      await page.emulateMedia({ forcedColors: 'active' })
      expect(await page.evaluate(() => matchMedia('(forced-colors: active)').matches)).toBe(true)

      // Settings › Appearance: the mode cards (hand-made radios), Density (SegmentedControl) and the scope rows (pressed toggles).
      await page.getByRole('button', { name: 'Open settings', exact: true }).click()
      const settings = settingsDialog(page)
      const scope = settings.getByRole('group', { name: 'Settings scope' })
      await scope.getByRole('button', { name: 'Application', exact: true }).click()
      await settings.getByRole('navigation', { name: 'Settings categories' }).getByRole('button', { name: /^Appearance/ }).click()
      await expect(settings.getByRole('heading', { name: 'Appearance', exact: true }).first()).toBeVisible()
      const groups = await settings.getByRole('radiogroup').evaluateAll(nodes => nodes.map(node => node.getAttribute('aria-label') ?? document.getElementById(node.getAttribute('aria-labelledby') ?? '')?.textContent?.trim() ?? ''))
      report[`settings radiogroups (${base})`] = groups
      expect(groups).toContain('Density')
      await expectChoicesMarked(page, 'settings-appearance', settings, groups.filter(Boolean))
      await expectTick(settings, 'Density')
      const { highlight } = await systemColors(page)
      const rows = await paints(scope, 'button')
      report[`settings scope (${base})`] = rows
      expect(rows.find(row => row.checked === 'true')?.background, 'scope: the pressed row is filled with Highlight').toBe(highlight)
      for (const row of rows.filter(item => item.checked !== 'true')) expect(row.background, `scope: "${row.name}" is not`).not.toBe(highlight)
      // The side nav's current page (aria-current) is marked the same way (homologation of #271).
      const pages = await settings.getByRole('navigation', { name: 'Settings categories' }).evaluate(element => Array.from(element.querySelectorAll('button'))
        .filter(node => node.getClientRects().length > 0)
        .map(node => ({ current: node.getAttribute('aria-current'), background: getComputedStyle(node).backgroundColor })))
      report[`settings nav (${base})`] = pages
      expect(pages.find(page => page.current === 'page')?.background, 'settings nav: the current page is filled with Highlight').toBe(highlight)
      for (const other of pages.filter(page => page.current !== 'page')) expect(other.background, 'settings nav: other pages are not').not.toBe(highlight)
      for (const button of await scope.getByRole('button').all()) {
        const size = await target(button)
        report[`scope target ${await button.textContent()} (${base})`] = size
        expect(size.height, `scope row "${await button.textContent()}" is ${MIN} px tall at least`).toBeGreaterThanOrEqual(MIN)
        expect(size.width).toBeGreaterThanOrEqual(MIN)
      }
      await shoot(page, 'settings-appearance', base)
      await scan(page, 'settings-appearance')
      await page.keyboard.press('Escape')
      await expect(settings).toHaveCount(0)

      // OxePod: Docker / Podman.
      await openView(page, 'OxePod')
      const pod = page.getByRole('complementary', { name: /OxePod/ })
      await expectChoicesMarked(page, 'oxepod', pod, ['Container engine'])
      await expectTick(pod, 'Container engine')
      await shoot(page, 'oxepod', base)
      await scan(page, 'oxepod')

      // OxeQuery › New connection: engine cards, Host/URL, environment, the Read-only switch and Favorite.
      await openView(page, 'OxeQuery')
      await page.getByRole('button', { name: 'New connection' }).first().click()
      const form = page.getByRole('dialog', { name: 'New connection' })
      await expect(form.getByRole('radiogroup', { name: 'Environment' })).toBeVisible()
      await expectChoicesMarked(page, 'new-connection', form, ['Engine', 'Connect by', 'Environment'])
      await expectTick(form, 'Connect by')
      await expectTick(form, 'Environment')
      // A colour swatch keeps its colour; the chosen one is ringed in Highlight.
      const swatches = await paints(form.getByRole('radiogroup', { name: 'Color', exact: true }), '[role=radio]')
      report[`new-connection Color (${base})`] = swatches
      const { highlight: ring } = await systemColors(page)
      expect(swatches.filter(item => item.checked === 'true').map(item => item.background), 'Color: the chosen swatch is ringed').toEqual([ring])
      expect(swatches.filter(item => item.checked !== 'true').every(item => item.background !== ring), 'Color: the others are not').toBe(true)
      await shoot(page, 'new-connection', base)
      // Production: the danger tone keeps the same mark.
      await form.getByRole('radiogroup', { name: 'Environment' }).getByRole('radio', { name: 'Production' }).click()
      await expectChoicesMarked(page, 'new-connection-production', form, ['Environment'])
      const readOnly = form.getByRole('switch', { name: 'Read-only' })
      await readOnly.scrollIntoViewIfNeeded()
      await expectSwitchReadable(page, 'new-connection', readOnly)
      await shoot(page, 'new-connection-production', base)
      const favorite = form.getByRole('checkbox', { name: 'Favorite' })
      const favoriteTarget = await target(favorite)
      report[`favorite target (${base})`] = favoriteTarget
      expect(favoriteTarget.width, 'Favorite target width').toBeGreaterThanOrEqual(MIN)
      expect(favoriteTarget.height, 'Favorite target height').toBeGreaterThanOrEqual(MIN)
      await scan(page, 'new-connection')
      await page.keyboard.press('Escape')
      await expect(form).toHaveCount(0)

      // OxeQuery › New database: PostgreSQL / MongoDB, now a SegmentedControl.
      await page.getByRole('button', { name: 'New local database' }).click()
      const wizard = page.getByRole('dialog', { name: 'New database' })
      await expectChoicesMarked(page, 'new-database', wizard, ['Engine'])
      await expectTick(wizard, 'Engine')
      await wizard.getByRole('radiogroup', { name: 'Engine' }).getByRole('radio', { name: 'MongoDB' }).click()
      await expect(wizard.getByRole('radio', { name: 'MongoDB' })).toHaveAttribute('aria-checked', 'true')
      await expectChoicesMarked(page, 'new-database-mongodb', wizard, ['Engine'])
      await shoot(page, 'new-database', base)
      await scan(page, 'new-database')
      await page.keyboard.press('Escape')
      await expect(wizard).toHaveCount(0)
      expect(consoleErrors).toEqual([])
    } finally {
      writeFileSync(join(OUT, `report-${base}.json`), JSON.stringify({ report, violations }, null, 2))
      await app.close()
    }
  })
}
