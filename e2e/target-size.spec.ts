import { expect, test, type Locator, type Page } from '@playwright/test'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { launchApp, openDemoWorkspace, resizeWindow } from './helpers/launch'
import { openView } from './helpers/oxepod'

/**
 * WCAG 2.2 SC 2.5.8 Target Size (Minimum), measured in the real renderer (roadmap F22, audit #228 P3-2). Each audited
 * surface is opened in compact and comfortable density at 1024 px wide; every visible interactive element is measured
 * and anything under 24×24 CSS px fails, unless the allowlist below names it with the reason. A checkbox or radio
 * counts with its label, which is part of its target (a click on the label toggles it). Links inside a run of text
 * are exempt by the SC (the "inline" exception). Light and dark screenshots of each surface go to
 * e2e/screenshots/target-size/<TARGET_SIZE_PHASE or 'after'>/, with measurements.json next to them.
 */
const PHASE = process.env.TARGET_SIZE_PHASE ?? 'after'
const OUT = join(process.cwd(), 'e2e/screenshots/target-size', PHASE)
/** Before the fix the baseline run records what it finds without failing. */
const RECORD_ONLY = PHASE === 'before'
const MIN = 24

/**
 * Elements allowed under 24 px. Each entry matches the measured element's description (`<tag> role "name" .class`)
 * on a surface and says why the SC does not apply. Keep it empty unless the exception is real.
 */
const ALLOWLIST: Array<{ surface: RegExp; match: RegExp; reason: string }> = []

interface Measured { description: string; width: number; height: number }

const INTERACTIVE = [
  'button', 'a[href]', '[role=button]', 'input[type=checkbox]', 'input[type=radio]', '[role=checkbox]', '[role=radio]',
  '[role=switch]', '[role=tab]', '[role=menuitem]', '[role=menuitemcheckbox]', '[role=menuitemradio]'
].join(',')

/** Every visible interactive element inside `root`, with its effective target box. */
function measure(root: Locator): Promise<Measured[]> {
  return root.evaluate((element, selector) => {
    const union = (a: DOMRect, b: DOMRect) => {
      const left = Math.min(a.left, b.left), top = Math.min(a.top, b.top)
      return { width: Math.max(a.right, b.right) - left, height: Math.max(a.bottom, b.bottom) - top }
    }
    const visible = (node: Element) => {
      if (node.closest('[aria-hidden="true"], [inert], [hidden]')) return false
      const style = getComputedStyle(node)
      return style.visibility !== 'hidden' && style.display !== 'none' && (node as HTMLElement).getClientRects().length > 0
    }
    const out: Array<{ description: string; width: number; height: number }> = []
    for (const node of Array.from(element.querySelectorAll(selector))) {
      if (!visible(node)) continue
      const rect = node.getBoundingClientRect()
      let box: { width: number; height: number } = { width: rect.width, height: rect.height }
      // A checkbox or radio is activated by its label as well; the label is part of the target.
      if (node instanceof HTMLInputElement) {
        const label = node.closest('label') ?? node.labels?.[0] ?? null
        if (label && visible(label)) box = union(rect, label.getBoundingClientRect())
      }
      // A visually hidden native input (1 px, behind a drawn control) is not a target of its own.
      if (box.width <= 2 && box.height <= 2) continue
      // Inline exception: a link inside a sentence.
      if (node.tagName === 'A' && node.parentElement && (node.parentElement.textContent ?? '').trim().length > (node.textContent ?? '').trim().length + 8) continue
      const role = node.getAttribute('role') ?? (node instanceof HTMLInputElement ? node.type : '')
      const name = (node.getAttribute('aria-label') ?? node.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 40)
      const className = typeof (node as HTMLElement).className === 'string' ? (node as HTMLElement).className.split(/\s+/).filter(Boolean).slice(0, 2).join('.') : ''
      out.push({ description: `<${node.tagName.toLowerCase()}> ${role} "${name}"${className ? ` .${className}` : ''}`, width: Math.round(box.width * 10) / 10, height: Math.round(box.height * 10) / 10 })
    }
    return out
  }, INTERACTIVE)
}

/** Choice rows (segmented controls, swatches) that grew past their own box or the surface's edge at this width. */
function overflowingRows(root: Locator): Promise<string[]> {
  return root.evaluate(element => {
    const edge = element.getBoundingClientRect()
    return Array.from(element.querySelectorAll('[role=radiogroup]')).flatMap(row => {
      const box = row.getBoundingClientRect()
      return row.scrollWidth > row.clientWidth + 1 || box.right > edge.right + 1 || box.left < edge.left - 1 ? [row.getAttribute('aria-label') ?? '?'] : []
    })
  })
}

async function setMode(page: Page, value: 'light' | 'dark'): Promise<void> {
  await page.evaluate(next => { document.documentElement.dataset.mode = next }, value)
  await page.waitForTimeout(250)
}

const report: Record<string, { measured: number; small: Measured[]; allowed: Array<Measured & { reason: string }>; overflow: string[] }> = {}

async function check(page: Page, surface: string, root: Locator): Promise<void> {
  await expect(root).toBeVisible()
  await page.waitForTimeout(300)
  const measured = await measure(root)
  const under = measured.filter(item => item.width < MIN - 0.01 || item.height < MIN - 0.01)
  const allowed = under.flatMap(item => {
    const entry = ALLOWLIST.find(rule => rule.surface.test(surface) && rule.match.test(item.description))
    return entry ? [{ ...item, reason: entry.reason }] : []
  })
  const small = under.filter(item => !allowed.some(other => other.description === item.description))
  report[surface] = { measured: measured.length, small, allowed, overflow: await overflowingRows(root) }
  for (const mode of ['light', 'dark'] as const) {
    await setMode(page, mode)
    await page.screenshot({ path: join(OUT, `${surface}-${mode}.png`) })
  }
  await setMode(page, 'light')
  writeFileSync(join(OUT, 'measurements.json'), JSON.stringify(report, null, 2))
  if (RECORD_ONLY) return
  expect(measured.length, `${surface}: nothing measured`).toBeGreaterThan(0)
  expect(small, `${surface}: targets under ${MIN}×${MIN} px`).toEqual([])
  expect(report[surface].overflow, `${surface}: choice rows past their edge`).toEqual([])
}

const settingsDialog = (page: Page) => page.getByRole('dialog', { name: 'Settings', exact: true })

async function openSettings(page: Page, category: 'Appearance' | 'Updates'): Promise<Locator> {
  const settings = settingsDialog(page)
  if (!await settings.isVisible()) await page.getByRole('button', { name: 'Open settings', exact: true }).click()
  await settings.getByRole('group', { name: 'Settings scope' }).getByRole('button', { name: 'Application', exact: true }).click()
  await settings.getByRole('navigation', { name: 'Settings categories' }).getByRole('button', { name: new RegExp(`^${category}`) }).click()
  await expect(settings.getByRole('heading', { name: category, exact: true }).first()).toBeVisible()
  return settings
}

async function setDensity(page: Page, density: 'Compact' | 'Comfortable'): Promise<void> {
  const settings = await openSettings(page, 'Appearance')
  await settings.getByRole('radiogroup', { name: 'Density' }).getByRole('radio', { name: density }).click()
  await expect.poll(() => page.evaluate(() => document.documentElement.dataset.density)).toBe(density.toLowerCase())
}

test('audited surfaces have targets of at least 24×24 px in both densities', async () => {
  test.setTimeout(240_000)
  mkdirSync(OUT, { recursive: true })
  const { app, page, workspaceRoot } = await launchApp()
  try {
    await resizeWindow(app, 1024, 800)
    await openDemoWorkspace(page, workspaceRoot)
    for (const density of ['Compact', 'Comfortable'] as const) {
      const tag = density.toLowerCase()
      await setDensity(page, density)
      await check(page, `${tag}-settings-appearance`, settingsDialog(page))
      await check(page, `${tag}-settings-updates`, await openSettings(page, 'Updates'))
      await page.keyboard.press('Escape')
      await expect(settingsDialog(page)).toHaveCount(0)

      await openView(page, 'pods')
      const pod = page.getByRole('complementary', { name: /OxePod/ })
      await expect(pod.getByRole('radiogroup', { name: 'Container engine' })).toBeVisible()
      await check(page, `${tag}-oxepod-sidebar`, pod)

      await openView(page, 'data')
      await page.getByRole('button', { name: 'New connection' }).first().click()
      const form = page.getByRole('dialog', { name: 'New connection' })
      await expect(form.getByRole('radiogroup', { name: 'Environment' })).toBeVisible()
      await check(page, `${tag}-oxequery-new-connection`, form)
      await page.keyboard.press('Escape')
      await expect(form).toHaveCount(0)
      await openView(page, 'code')
    }
  } finally {
    await app.close()
  }
})
