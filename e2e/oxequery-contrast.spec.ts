import { _electron as electron, expect, test, type Page } from '@playwright/test'
import { mkdirSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { connectFromContainer, openView } from './helpers/oxepod'

/**
 * Text in OxeQuery must be readable in both modes: WCAG AA asks 4.5:1 for normal text and 3:1 for large text.
 * The check reads the colors the browser actually computed, so a token that is fine on one surface and weak on
 * another is caught where it is used.
 */
const AUDIT = `(() => {
  const parse = (value) => {
    let match = /^rgba?\\(([^)]+)\\)$/.exec(value)
    if (match) { const parts = match[1].split(/[ ,\\/]+/).filter(Boolean).map(Number); return { r: parts[0], g: parts[1], b: parts[2], a: parts.length > 3 ? parts[3] : 1 } }
    match = /^color\\(srgb ([^)]+)\\)$/.exec(value)
    if (match) { const parts = match[1].split(/[ \\/]+/).filter(Boolean).map(Number); return { r: parts[0] * 255, g: parts[1] * 255, b: parts[2] * 255, a: parts.length > 3 ? parts[3] : 1 } }
    return null
  }
  const over = (top, under) => ({ r: top.r * top.a + under.r * (1 - top.a), g: top.g * top.a + under.g * (1 - top.a), b: top.b * top.a + under.b * (1 - top.a), a: 1 })
  const luminance = (c) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4) }; return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b) }
  const backdrop = (element) => {
    const stack = []
    for (let node = element; node; node = node.parentElement) { const color = parse(getComputedStyle(node).backgroundColor); if (color && color.a > 0) { stack.push(color); if (color.a === 1) break } }
    let base = { r: 255, g: 255, b: 255, a: 1 }
    for (const color of stack.reverse()) base = over(color, base)
    return base
  }
  const failures = []
  const roots = [...document.querySelectorAll('.oq-view, [role="dialog"], .oq-sidebar, .pod-host:not([aria-hidden="true"]), aside[aria-label="OxePod sidebar"]')]
  const seen = new Set()
  for (const root of roots) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const text = (node.textContent || '').trim()
      const element = node.parentElement
      if (!text || !element || seen.has(element)) continue
      const style = getComputedStyle(element)
      const box = element.getBoundingClientRect()
      if (style.visibility === 'hidden' || style.display === 'none' || Number(style.opacity) === 0 || box.width === 0 || box.height === 0) continue
      if (element.closest('[disabled], [aria-disabled="true"], .monaco-editor, svg')) continue
      seen.add(element)
      const fg = parse(style.color)
      if (!fg) continue
      const bg = backdrop(element)
      const ink = over(fg, bg)
      const a = luminance(ink), b = luminance(bg)
      const ratio = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
      const size = parseFloat(style.fontSize)
      const large = size >= 24 || (size >= 18.66 && Number(style.fontWeight) >= 700)
      if (ratio < (large ? 3 : 4.5)) failures.push({ text: text.slice(0, 40), ratio: Math.round(ratio * 100) / 100, color: style.color, background: 'rgb(' + Math.round(bg.r) + ',' + Math.round(bg.g) + ',' + Math.round(bg.b) + ')', tag: element.tagName.toLowerCase() + '.' + String(element.className).slice(0, 30) })
    }
  }
  return failures
})()`

async function setMode(page: Page, mode: 'light' | 'dark'): Promise<void> {
  await page.evaluate(value => { document.documentElement.dataset.mode = value }, mode)
  await page.waitForTimeout(200)
}

test('OxeQuery text is readable in light and dark mode', async () => {
  test.setTimeout(180_000)
  const root = mkdtempSync(join(tmpdir(), 'oxespace-oxequery-contrast-'))
  const repo = join(root, 'repo'); mkdirSync(repo)
  const app = await electron.launch({ args: [join(process.cwd(), 'e2e/electron-main.cjs')], env: {
    ...process.env, OXESPACE_DISABLE_SINGLE_INSTANCE: '1', OXESPACE_E2E_MOCK_NATIVE: '1', OXESPACE_DB_PATH: join(root, 'app.sqlite3')
  } })
  try {
    const page = await app.firstWindow()
    await app.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows()[0].setSize(1280, 820) })
    await page.waitForLoadState('domcontentloaded')
    await page.getByTestId('btn-new-workspace').click()
    await page.getByTestId('wizard-dir-input').fill(repo)
    await page.getByTestId('wizard-layout-card-1').click()
    await page.getByTestId('wizard-launch-btn').click()
    await page.getByRole('navigation', { name: 'Application view' }).getByRole('button', { name: 'OxeQuery' }).click()
    await connectFromContainer(page, 'pg-dev')
    await page.getByRole('treeitem', { name: 'users', exact: true }).click({ position: { x: 12, y: 8 } })
    await expect(page.getByRole('gridcell', { name: 'alice', exact: true })).toBeVisible()

    const report: Record<string, unknown[]> = {}
    for (const mode of ['light', 'dark'] as const) {
      await setMode(page, mode)
      report[`${mode} workbench`] = await page.evaluate(AUDIT) as unknown[]
      await page.getByRole('button', { name: 'Server: databases and roles' }).click()
      await page.getByRole('dialog', { name: /Server of/ }).waitFor()
      report[`${mode} server dialog`] = await page.evaluate(AUDIT) as unknown[]
      await page.keyboard.press('Escape')
      await openView(page, 'OxePod')
      report[`${mode} containers`] = await page.evaluate(AUDIT) as unknown[]
      await openView(page, 'OxeQuery')
      await page.getByRole('tab', { name: 'pg-dev' }).click()
    }
    const failing = Object.fromEntries(Object.entries(report).filter(([, list]) => list.length > 0))
    expect(failing, JSON.stringify(failing, null, 1)).toEqual({})
  } finally { await app.close() }
})
