// Frozen end-to-end acceptance test for 1.5.2 Polimento · Componentes base (Jira OXE-195, PB-01·4, CA-3), in the built
// app with real services (OXESPACE_E2E_MOCK_NATIVE=0) and emulated forced colours. Written by the planner; the executor
// must not edit it. A turn finishes in a pane: a stand-in agent, a node script typed in the pane's own terminal, posts
// the lifecycle hooks a real agent sends (UserPromptSubmit, then Stop) to the app's hook receiver with that pane's
// execution credentials (electron/main/services/agent-hooks/server.ts). No paid account is used. The sidebar row's
// StatusSignal turns done ("Concluído"); in forced colours its check must stand apart from its disc. Red while both
// are forced to the same CanvasText. Needs the OxeCode sidebar rows of #854 (BRD-01, StatusSignal in PaneSessionRow).
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
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
const HOOKS = String.raw`
const post = payload => fetch('http://127.0.0.1:' + process.env.OXESPACE_AGENT_HOOK_PORT + '/hook', { method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ executionId: process.env.OXESPACE_EXECUTION_ID, token: process.env.OXESPACE_EXECUTION_TOKEN, workspaceId: process.env.OXESPACE_WORKSPACE_ID, agent: 'claude-code', payload }) })
;(async () => {
  await post({ hook_event_name: 'UserPromptSubmit', session_id: 'pb0104', cwd: process.cwd() })
  await new Promise(r => setTimeout(r, 1500))
  await post({ hook_event_name: 'Stop', session_id: 'pb0104', cwd: process.cwd() })
  console.log('pb0104 hooks sent')
})()
`

test('PB-01·4 in the app: in forced colours a finished pane shows the check of its done signal', async () => {
  test.setTimeout(240_000)
  const { app, page, workspaceRoot } = await launchApp({ appearance: 'light', realClock: true, env: REAL })
  try {
    await openDemoWorkspace(page, workspaceRoot)
    const script = join(workspaceRoot, 'pb0104-hooks.cjs')
    writeFileSync(script, HOOKS)
    await page.locator('[data-app-mode="code"]').first().click()
    await page.locator('[data-testid="pane-container"] .xterm').first().click()
    await page.keyboard.type(`node "${script}"`)
    await page.keyboard.press('Enter')
    const done = page.locator('[data-ui="status-signal"][data-state="done"]').first()
    await expect(done, 'the pane row shows the done signal').toBeVisible({ timeout: 90_000 })
    await page.emulateMedia({ forcedColors: 'active' })
    const paint = await done.evaluate(el => {
      const disc = el.querySelector('circle')!, mark = el.querySelector('path')!
      return { disc: getComputedStyle(disc).fill, mark: getComputedStyle(mark).stroke, adjust: getComputedStyle(el).getPropertyValue('forced-color-adjust') }
    })
    const colors = await systemColors(page)
    expect(paint.adjust.trim()).toBe('none')
    expect(paint.mark, 'the check is drawn in Canvas').toBe(colors.canvas)
    expect(paint.mark, 'and stands apart from the disc').not.toBe(paint.disc)
    expect(paint.disc, 'done is Highlight').toBe(colors.highlight)
  } finally {
    await app.close()
  }
})
