// Frozen end-to-end acceptance test for 1.5.2 Polimento · Componentes base (Jira OXE-274, PB-01·15, CA-4), in the built
// app with real services (OXESPACE_E2E_MOCK_NATIVE=0) and a real PostgreSQL container. Written by the planner; the
// executor must not edit it. Two dialogs: New table in OxeQuery and, in Settings › Phone and devices, the firewall
// explanation that turning on phone access opens (Cancel closes it; nothing is turned on). Every button of each
// footer is --control-lg (32 px) tall. In a short window the body of New table overflows: it says data-overflow "end"
// and draws a 1 px line in the colour of --bd-subtle at its bottom; scrolled to the end, "end" and the bottom line go.
// Red while the footers are 28 px (md) and the body has no overflow cue.
import { expect, test, type Locator, type Page } from '@playwright/test'
import { launchApp, openDemoWorkspace, resizeWindow } from '../helpers/launch'
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
// ---- a real PostgreSQL in a container + OxeQuery in the built app (as tests/live/oxequery-live.test.ts) ----
// Podman with OXE_CONTAINER_ENGINE=podman. Without a container engine the spec is skipped and says why.
import { execFileSync as pbExec } from 'node:child_process'

const PB_ENGINE = process.env.OXE_CONTAINER_ENGINE === 'podman' ? 'podman' : 'docker'
const pbDocker = (...args: string[]): string => pbExec(PB_ENGINE, args, { encoding: 'utf8', timeout: 240_000, stdio: ['ignore', 'pipe', 'pipe'] }).trim()
const pbTry = (run: () => unknown): boolean => { try { run(); return true } catch { return false } }
/** Why this machine cannot run the spec, or null. */
function noContainerEngine(): string | null {
  return pbTry(() => pbDocker('info', '--format', '{{.ServerVersion}}')) ? null
    : `no ${PB_ENGINE} daemon on this machine: this e2e opens New table on a real PostgreSQL container (as tests/live/oxequery-live.test.ts)`
}
async function pbUntil(label: string, check: () => boolean, ms = 120_000): Promise<void> {
  const end = Date.now() + ms
  while (Date.now() < end) { if (check()) return; await new Promise(resolve => setTimeout(resolve, 1000)) }
  throw new Error(`timed out: ${label}`)
}
const stopContainer = (name: string): void => { pbTry(() => pbDocker('rm', '-f', name)) }
/** PostgreSQL 16, user app, database shop, trust auth, seeded with `sql`. */
async function startPostgres(name: string, sql = ''): Promise<void> {
  stopContainer(name)
  pbDocker('run', '-d', '--name', name, '-e', 'POSTGRES_USER=app', '-e', 'POSTGRES_DB=shop', '-e', 'POSTGRES_HOST_AUTH_METHOD=trust', '-p', '127.0.0.1::5432', process.env.OXE_LIVE_PG_IMAGE ?? 'docker.io/library/postgres:16-alpine')
  await pbUntil(`${name} accepts connections`, () => pbTry(() => pbDocker('exec', name, 'psql', '-U', 'app', '-d', 'shop', '-tAc', 'SELECT 1')))
  if (sql) pbDocker('exec', name, 'psql', '-v', 'ON_ERROR_STOP=1', '-U', 'app', '-d', 'shop', '-c', sql)
}
/** OxeQuery in the title bar's mode switch, by its mode id (whatever the switch is drawn as). */
async function openOxeQuery(page: Page): Promise<void> {
  await page.locator('[data-app-mode="data"]').first().click()
  await expect(page.locator('.oq-view')).toBeVisible({ timeout: 30_000 })
}
/** New connection › From a running container › the container › Save and open, as a person does. */
async function connectContainer(page: Page, name: string): Promise<void> {
  await openOxeQuery(page)
  await page.getByRole('button', { name: cat('oxequery', 'connections.new') }).first().click()
  const dialog = page.getByRole('dialog').last()
  await dialog.getByRole('radio', { name: cat('oxequery', 'form.sourceContainer') }).click({ timeout: 60_000 })
  const select = dialog.getByLabel(cat('oxequery', 'form.containerLabel'))
  const option = select.locator('option', { hasText: new RegExp(`^${name}\\b`) })
  await option.waitFor({ state: 'attached', timeout: 60_000 })
  await select.selectOption(await option.evaluate((el: HTMLOptionElement) => el.value))
  await dialog.getByRole('button', { name: cat('oxequery', 'form.saveOpen') }).click()
  await expect(page.getByRole('tab', { name, exact: true })).toBeVisible({ timeout: 60_000 })
}
const PG = `pb0115-pg-${process.pid}`
/** Every visible src/ui Button of a dialog footer, with its height. */
function footerHeights(dialog: Locator): Promise<Array<{ name: string; height: number }>> {
  return dialog.locator('[data-dialog-footer] [data-ui="button"]').evaluateAll(nodes => nodes.filter(node => (node as HTMLElement).getClientRects().length > 0)
    .map(node => ({ name: (node.textContent ?? '').trim(), height: Math.round(node.getBoundingClientRect().height) })))
}
/** Whether the body draws a 1 px line of `color` at its bottom: a border, an inset shadow or a pseudo-element. */
function bottomLine(body: Locator, color: string): Promise<boolean> {
  return body.evaluate((el, wanted) => {
    const s = getComputedStyle(el)
    if (s.borderBottomWidth === '1px' && s.borderBottomStyle === 'solid' && s.borderBottomColor === wanted) return true
    if (/inset/.test(s.boxShadow) && s.boxShadow.includes(wanted) && /-1px/.test(s.boxShadow)) return true
    return ['::before', '::after'].some(pseudo => {
      const p = getComputedStyle(el, pseudo)
      return p.content !== 'none' && p.display !== 'none' && (p.height === '1px' || p.borderBottomWidth === '1px' || p.borderTopWidth === '1px') &&
        [p.backgroundColor, p.borderBottomColor, p.borderTopColor].includes(wanted)
    })
  }, color)
}

test('PB-01·15 in the app: dialog footers are 32 px and New table marks its bottom edge only while there is more below', async () => {
  const reason = noContainerEngine()
  test.skip(reason !== null, reason ?? '')
  test.setTimeout(360_000)
  await startPostgres(PG, 'CREATE TABLE users (id int PRIMARY KEY);')
  const { app, page, workspaceRoot } = await launchApp({ appearance: 'light', realClock: true, env: REAL })
  try {
    await resizeWindow(app, 1440, 900)
    await openDemoWorkspace(page, workspaceRoot)
    const large = Math.round(await tokenPx(page, '--control-lg'))
    expect(large).toBe(32)

    // Settings › Phone and devices › the firewall explanation (a hand-built footer).
    await openSettingsPage(page, 'devices')
    await page.getByRole('switch', { name: cat('settings', 'devices.gateway.label') }).click()
    const firewall = page.getByRole('dialog', { name: cat('settings', 'devices.firewall.title') })
    await expect(firewall).toBeVisible()
    const settingsButtons = await footerHeights(firewall)
    expect(settingsButtons.length).toBeGreaterThan(0)
    for (const button of settingsButtons) expect(button.height, `Settings dialog: ${button.name}`).toBe(large)
    await page.keyboard.press('Escape')
    await expect(firewall).toBeHidden()
    await page.keyboard.press('Escape')

    // OxeQuery › New table.
    await connectContainer(page, PG)
    await page.evaluate(async name => {
      const oxe = (window as unknown as { oxe: { oxeQuery: { call: (op: string, input: unknown) => Promise<{ ok: boolean; value: Array<Record<string, unknown>> }> } } }).oxe
      const found = (await oxe.oxeQuery.call('connections.list', {})).value.find(item => item.name === name)!
      await oxe.oxeQuery.call('connections.save', { ...found, readOnly: false })
    }, PG)
    await page.reload(); await openOxeQuery(page)
    await page.getByRole('button', { name: new RegExp(`^${PG}`) }).first().click()
    await page.getByRole('button', { name: cat('oxequery', 'tree.newTableIn', { schema: 'public' }) }).click()
    const dialog = page.getByRole('dialog', { name: cat('oxequery', 'tree.newTableIn', { schema: 'public' }) })
    await expect(dialog).toBeVisible()
    const tableButtons = await footerHeights(dialog)
    expect(tableButtons.length).toBeGreaterThan(0)
    for (const button of tableButtons) expect(button.height, `New table: ${button.name}`).toBe(large)

    const body = dialog.locator('[data-dialog-body]')
    const subtle = await tokenColor(body, '--bd-subtle')
    await resizeWindow(app, 1100, 420)
    await expect.poll(() => body.evaluate(el => el.scrollHeight > el.clientHeight + 1), { message: 'the short window makes the body overflow', timeout: 10_000 }).toBe(true)
    await expect.poll(() => body.getAttribute('data-overflow'), { timeout: 5_000 }).toMatch(/\bend\b/)
    expect(await bottomLine(body, subtle), 'a 1 px --bd-subtle line at the bottom while there is more below').toBe(true)
    await body.evaluate(el => { el.scrollTop = el.scrollHeight })
    await expect.poll(async () => (await body.getAttribute('data-overflow')) ?? '', { timeout: 5_000 }).not.toMatch(/\bend\b/)
    expect(await bottomLine(body, subtle), 'no bottom line once at the end').toBe(false)
  } finally {
    await app.close()
    stopContainer(PG)
  }
})
