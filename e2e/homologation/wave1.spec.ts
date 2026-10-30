import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { mkdirSync, writeFileSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { join } from 'node:path'
import { launchApp, openDemoWorkspace, resizeWindow } from '../helpers/launch'
import { connectFromContainer, containerRow } from '../helpers/oxepod'

/**
 * Homologation of 1.4 wave 1 (F3 motion, F2 brand part 1, B3.1 OxePod split, #167 OxePost, #158 contracts), walked as
 * a user would and captured in light/dark, en/pt-BR and compact/comfortable. Not part of CI.
 * Shots and notes: e2e/screenshots/homologation/wave1. Run:
 *   npx playwright test --config playwright.tools.config.ts e2e/homologation/wave1.spec.ts
 */
const OUT = join(process.cwd(), 'e2e', 'screenshots', 'homologation', 'wave1')
mkdirSync(OUT, { recursive: true })
const notes: Record<string, unknown> = {}
test.afterAll(() => writeFileSync(join(OUT, 'notes.json'), JSON.stringify(notes, null, 2)))

type Mode = 'light' | 'dark'
type Locale = 'en-US' | 'pt-BR'
type Density = 'compact' | 'comfortable'

/** Seeds the persisted settings the way the Appearance page writes them, then reloads. */
async function seed(page: Page, appearance: Mode, density: Density, motion: 'full' | 'reduced' | 'system' = 'system') {
  await page.evaluate(([a, d, m]) => localStorage.setItem('oxe-settings', JSON.stringify({
    state: { appearance: a, density: d, motion: m, notificationsEnabled: true, visitedWorkspacesCap: 5, language: 'system', uiScale: 1, keybindingOverrides: {} },
    version: 7
  })), [appearance, density, motion] as const)
  await page.reload()
  await page.waitForLoadState('load')
}

const shot = (page: Page, name: string) => page.screenshot({ path: join(OUT, `${name}.png`) })
const page = (app: ElectronApplication) => app.windows()[0]
const pageErrors = (lines: string[]) => lines.filter(line => line.startsWith('pageerror:'))
const viewNav = (page: Page) => page.locator('nav[aria-label="Application view"], nav[aria-label="Visão do aplicativo"]')

test('splash: the boot screen before React, with the system light and dark', async () => {
  const { app } = await launchApp()
  try {
    // A second window on the same page with scripts off keeps the splash on screen; the scheme is emulated.
    const opened = app.waitForEvent('window')
    await app.evaluate(({ BrowserWindow }) => {
      const main = BrowserWindow.getAllWindows()[0]
      void new BrowserWindow({ width: 1280, height: 800, webPreferences: { javascript: false } }).loadURL(main.webContents.getURL())
    })
    const splash = await opened
    for (const colorScheme of ['light', 'dark'] as const) {
      await splash.emulateMedia({ colorScheme })
      await splash.waitForTimeout(600)
      await shot(splash, `splash-emulated-${colorScheme}`)
      notes[`splash-${colorScheme}`] = await splash.locator('.oxe-splash').evaluate(e => getComputedStyle(e).backgroundColor)
    }
    notes.favicon = await page(app).evaluate(async () => {
      const link = document.querySelector<HTMLLinkElement>('link[rel=icon]')
      return link ? `${link.href} -> ${(await fetch(link.href)).status}` : 'missing'
    })
  } finally { await app.close() }
})

const MATRIX: Array<[Mode, Locale, Density]> = [
  ['light', 'en-US', 'compact'], ['dark', 'en-US', 'compact'], ['light', 'pt-BR', 'compact'], ['dark', 'pt-BR', 'compact'],
  ['light', 'en-US', 'comfortable'], ['dark', 'pt-BR', 'comfortable']
]

for (const [mode, locale, density] of MATRIX) {
  test(`modes and design system viewer: ${mode} ${locale} ${density}`, async () => {
    test.setTimeout(240_000)
    const tag = `${mode}-${locale}-${density}`
    const { app, page, workspaceRoot, consoleErrors } = await launchApp({ locale })
    try {
      await resizeWindow(app, 1280, 860)
      await seed(page, mode, density)
      await openDemoWorkspace(page, workspaceRoot)
      const buttons = await viewNav(page).getByRole('button').allInnerTexts()
      for (const [index, label] of buttons.entries()) {
        await viewNav(page).getByRole('button').nth(index).click()
        await page.waitForTimeout(1_200)
        await shot(page, `${tag}-mode-${index + 1}-${label.trim().replace(/\W+/g, '_')}`)
      }
      // The design system viewer from the palette: Motion and States sections.
      await page.keyboard.press('Control+k')
      await expect(page.locator('[cmdk-root]')).toBeVisible()
      await page.keyboard.insertText('Design System')
      const entries = await page.locator('[cmdk-item]').allInnerTexts()
      notes[`${tag}-palette-design-system`] = entries
      await page.locator('[cmdk-item]').first().click()
      const viewer = page.getByRole('dialog').last()
      const sectionNav = viewer.getByRole('navigation', { name: /design system|sistema/i })
      await sectionNav.waitFor({ timeout: 10_000 }).catch(() => undefined)
      const sections = await sectionNav.getByRole('button').allInnerTexts()
      notes[`${tag}-viewer-sections`] = sections
      for (const [index, section] of sections.entries()) {
        await sectionNav.getByRole('button').nth(index).click()
        await page.waitForTimeout(400)
        await viewer.locator('main').screenshot({ path: join(OUT, `${tag}-ds-${index + 1}-${section.trim().replace(/\W+/g, '_')}.png`) }).catch(() => shot(page, `${tag}-ds-${index + 1}`))
      }
      notes[`${tag}-errors`] = consoleErrors
    } finally { await app.close() }
  })
}

test('motion: the Appearance page offers Reduced and it takes effect at once', async () => {
  test.setTimeout(120_000)
  const { app, page, consoleErrors } = await launchApp({ locale: 'pt-BR' })
  try {
    await resizeWindow(app, 1280, 860)
    await seed(page, 'light', 'compact', 'full')
    await page.getByRole('button', { name: /settings|configurações/i }).first().click()
    await page.locator('.settings-center').waitFor()
    await page.getByRole('group').getByRole('button', { name: /^(Aplicativo|Application)$/ }).first().click()
    await page.getByRole('navigation').getByRole('button', { name: /^(Aparência|Appearance)/ }).first().click()
    await shot(page, 'motion-settings-pt-BR')
    await page.getByText('Reduzido', { exact: true }).first().click()
    notes.motionAfterReduced = await page.evaluate(() => ({
      dataMotion: document.documentElement.dataset.motion,
      shift: getComputedStyle(document.documentElement).getPropertyValue('--motion-shift').trim(),
      longAnimations: document.getAnimations().filter(a => Number(a.effect?.getComputedTiming().duration ?? 0) >= 1)
        .map(a => ('animationName' in a ? (a as CSSAnimation).animationName : 'transition'))
    }))
    await shot(page, 'motion-settings-pt-BR-reduced')
    notes.motionErrors = consoleErrors
  } finally { await app.close() }
})

let server: Server
let base = ''
test.beforeAll(async () => {
  server = createServer((req, res) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ ok: true, path: req.url })) })
  await new Promise<void>(done => server.listen(0, '127.0.0.1', done))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})
test.afterAll(() => { server?.closeAllConnections(); server?.close() })

for (const locale of ['pt-BR', 'en-US'] as const) {
  test(`OxePod alone, OxeQuery via OxePod, OxePost send: ${locale}`, async () => {
    test.setTimeout(240_000)
    const { app, page, workspaceRoot, consoleErrors } = await launchApp({ locale })
    const pt = locale === 'pt-BR'
    try {
      await resizeWindow(app, 1280, 860)
      await seed(page, pt ? 'dark' : 'light', 'compact')
      await openDemoWorkspace(page, workspaceRoot)
      // OxePod on its own: OxeQuery never loaded.
      await page.keyboard.press('Control+4')
      await expect(containerRow(page, 'pg-dev')).toBeVisible({ timeout: 15_000 })
      notes[`${locale}-oxequery-host-while-pod`] = await page.locator('.oxequery-host, [class*="oxequery-host"]').count()
      await shot(page, `${locale}-oxepod-alone`)
      await containerRow(page, 'pg-dev').click()
      await page.waitForTimeout(600)
      await shot(page, `${locale}-oxepod-pg-dev`)
      // OxeQuery connects to the database container through OxePod.
      await connectFromContainer(page, 'pg-dev', pt ? { connect: /no OxeQuery$/, save: 'Salvar e abrir' } : undefined)
      await page.waitForTimeout(800)
      await shot(page, `${locale}-oxequery-from-pod`)
      // OxePost: open and send.
      await page.keyboard.press('Control+5')
      await page.waitForTimeout(1_200)
      await shot(page, `${locale}-oxepost-open`)
      const url = page.getByRole('textbox', { name: /url/i }).first()
      if (await url.isVisible().catch(() => false)) {
        await url.fill(`${base}/ping`)
        await page.keyboard.press('Control+Enter')
        await page.waitForTimeout(1_500)
      } else {
        notes[`${locale}-oxepost-no-url-box`] = true
      }
      await shot(page, `${locale}-oxepost-sent`)
      notes[`${locale}-pod-query-post-errors`] = consoleErrors
      expect(pageErrors(consoleErrors)).toEqual([])
    } finally { await app.close() }
  })
}

test('thread: why the sidebar says project directories could not load', async () => {
  const { app, page, workspaceRoot } = await launchApp()
  try {
    await openDemoWorkspace(page, workspaceRoot)
    notes.threadProjects = await page.evaluate(async () => {
      try { return await (window as unknown as { oxe: { thread: { projects: () => Promise<unknown> } } }).oxe.thread.projects() } catch (error) { return `error: ${(error as Error).message}` }
    })
  } finally { await app.close() }
})

test('contracts #158: what the window gets from app.about and app.connectivity', async () => {
  const { app, page } = await launchApp()
  try {
    notes.contracts = await page.evaluate(async () => {
      const api = (window as unknown as { oxe: { app: Record<string, () => Promise<unknown>> } }).oxe.app
      const call = async (name: string) => { try { return await api[name]() } catch (error) { return `error: ${(error as Error).message}` } }
      return { about: await call('about'), connectivity: await call('connectivity') }
    })
    notes.aboutInUi = await page.getByText(/^(About|Sobre)\b/).count()
  } finally { await app.close() }
})

