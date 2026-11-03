import { test, type ElectronApplication, type Locator, type Page } from '@playwright/test'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { freezeClock, launchApp, openDemoWorkspace, resizeWindow, type Appearance } from '../helpers/launch'
import { modeButton } from '../helpers/modes'
import { runPaletteCommand } from '../helpers/panels'
import { installThreadFixtures, openThreadWithState, registerThreadProject, setThreadState } from '../helpers/thread-fixtures'

/**
 * DESIGN AUDIT 1.5 (T65): screenshots for docs/design/audit-1.5.md. AUDIT ONLY, NOT A BASELINE, and never merged:
 * remove this file before the docs PR leaves draft.
 *
 * It runs inside the "Visual baselines" workflow so the PNGs land in that run's artifact (under
 * __screenshots__/<platform>/audit-1.5/). It uses plain page.screenshot, never toHaveScreenshot, and records a surface it
 * could not reach in step-failures.json instead of failing, so the real baselines still verify and upload.
 * The two verify passes of that workflow skip it (the marker file from the first pass is there).
 */
const PLATFORM = process.platform === 'win32' ? 'win32' : 'linux'
const OUT = join(process.cwd(), 'e2e', 'visual', '__screenshots__', PLATFORM, 'audit-1.5')
const DONE = join(OUT, '.done')
const THEMES: Appearance[] = ['light', 'dark']
const SIZES = [[1440, 900], [900, 620]] as const

const enabled = process.env.GITHUB_WORKFLOW === 'Visual baselines' || process.env.OXESPACE_AUDIT_1_5 === '1'

type Ctx = { app: ElectronApplication; page: Page; dir: string; failures: string[]; facts: unknown[] }

async function facts(page: Page): Promise<unknown> {
  return page.evaluate(() => {
    const ctx = document.createElement('canvas').getContext('2d', { willReadFrequently: true })!
    const rgb = (v: string): number[] => { if (!v || v === 'transparent') return [0, 0, 0, 0]; ctx.clearRect(0, 0, 1, 1); ctx.fillStyle = '#000'; ctx.fillStyle = v; ctx.fillRect(0, 0, 1, 1); const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data; return [r, g, b, a / 255] }
    const lum = (c: number[]) => c.slice(0, 3).map(x => x / 255).map(x => x <= .04045 ? x / 12.92 : ((x + .055) / 1.055) ** 2.4).reduce((s, x, i) => s + x * [.2126, .7152, .0722][i], 0)
    const visible = (el: Element) => { const r = el.getBoundingClientRect(), s = getComputedStyle(el); return r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < innerHeight && r.right > 0 && r.left < innerWidth && s.visibility !== 'hidden' && s.display !== 'none' && s.opacity !== '0' }
    const contrast: unknown[] = [], small: unknown[] = [], fontSizes: Record<string, number> = {}, radii: Record<string, number> = {}
    for (const el of document.querySelectorAll('body *')) {
      if (!visible(el)) continue
      const s = getComputedStyle(el)
      if (s.borderRadius !== '0px') radii[s.borderRadius] = (radii[s.borderRadius] ?? 0) + 1
      if ([...el.childNodes].some(n => n.nodeType === 3 && n.textContent?.trim())) {
        fontSizes[s.fontSize] = (fontSizes[s.fontSize] ?? 0) + 1
        const fg = rgb(s.color); let node: Element | null = el, bg: number[] = []
        while (node) { const c = rgb(getComputedStyle(node).backgroundColor); if (c[3] === 1) { bg = c; break } if (c[3] > 0) break; node = node.parentElement }
        if (bg.length && fg[3] === 1) { const a = lum(fg), b = lum(bg), ratio = (Math.max(a, b) + .05) / (Math.min(a, b) + .05), px = parseFloat(s.fontSize); if (ratio < (px >= 24 || (px >= 18.66 && +s.fontWeight >= 700) ? 3 : 4.5)) contrast.push({ text: el.textContent?.trim().slice(0, 40), ratio: Math.round(ratio * 100) / 100, cls: String((el as HTMLElement).className).slice(0, 60) }) }
      }
      if (el.matches('button,a[href],input,select,textarea,[role="button"],[role="tab"],[role="menuitem"]')) { const r = el.getBoundingClientRect(); if (r.width < 24 || r.height < 24) small.push({ name: el.getAttribute('aria-label') || el.textContent?.trim().slice(0, 30), w: Math.round(r.width), h: Math.round(r.height) }) }
    }
    const dialog = document.querySelector('[role="dialog"],[role="alertdialog"]')
    const focus = document.activeElement
    return { contrast: contrast.slice(0, 15), small: small.slice(0, 15), fontSizes, radii, overflowX: document.documentElement.scrollWidth > innerWidth,
      dialog: dialog ? { label: dialog.getAttribute('aria-label') || dialog.querySelector('h1,h2,h3')?.textContent, w: Math.round(dialog.getBoundingClientRect().width), h: Math.round(dialog.getBoundingClientRect().height) } : null,
      focus: focus ? `${focus.tagName.toLowerCase()} ${focus.getAttribute('aria-label') || focus.textContent?.trim().slice(0, 30) || ''}` : null }
  })
}

async function surface(c: Ctx, name: string, open: () => Promise<unknown>, close = true): Promise<void> {
  try {
    await open()
    await c.page.waitForTimeout(500)
    await c.page.screenshot({ path: join(c.dir, `${name}.png`) })
    c.facts.push({ name, ...(await facts(c.page)) as object })
  } catch (error) {
    c.failures.push(`${name}: ${(error as Error).message.split('\n')[0]}`)
  } finally {
    if (close) for (let i = 0; i < 3; i++) await c.page.keyboard.press('Escape').catch(() => undefined)
    await c.page.waitForTimeout(200)
  }
}

const click = (l: Locator) => () => l.first().click({ timeout: 4000 })
const palette = (page: Page, title: string) => () => runPaletteCommand(page, title)

for (const theme of THEMES) {
  for (const [w, h] of SIZES) {
    test(`design audit 1.5 — ${theme} ${w}x${h}`, async () => {
      test.skip(!enabled, 'audit only; runs in the Visual baselines workflow')
      test.skip(existsSync(DONE), 'already captured in this run (verify pass)')
      test.setTimeout(12 * 60_000)
      const dir = join(OUT, `${theme}-${w}x${h}`)
      mkdirSync(dir, { recursive: true })
      const failures: string[] = [], collected: unknown[] = []
      const { app, page, workspaceRoot } = await launchApp({ appearance: theme })
      const c: Ctx = { app, page, dir, failures, facts: collected }
      try {
        await page.evaluate(() => localStorage.setItem('oxe.thread.viewMode', 'verbose'))
        await page.reload(); await page.waitForLoadState('load')
        await freezeClock(page)
        await resizeWindow(app, w, h)
        await page.waitForTimeout(800)

        // Onboarding and chrome before any workspace.
        await surface(c, '000-first-run-empty', async () => undefined, false)
        await surface(c, '001-new-workspace', click(page.getByTestId('btn-new-workspace')))
        await surface(c, '002-settings-from-empty', click(page.getByRole('button', { name: 'Open settings', exact: true })))

        await installThreadFixtures(app, workspaceRoot)
        await openDemoWorkspace(page, workspaceRoot)
        await page.waitForTimeout(1200)

        // OxeCode chrome: title bar menus, rail, sidebar, palette, global dialogs.
        await surface(c, '010-code-workspace', async () => undefined, false)
        for (const m of ['File', 'Edit', 'View', 'Tools', 'Help']) await surface(c, `011-menu-${m.toLowerCase()}`, click(page.locator('button', { hasText: new RegExp(`^${m}$`) })))
        await surface(c, '012-palette', () => page.keyboard.press('Control+k'))
        await surface(c, '013-sidebar-workspace-menu', click(page.getByTestId('sidebar-workspace-item')), true)
        await surface(c, '014-sidebar-workspace-context', () => page.getByTestId('sidebar-workspace-item').first().click({ button: 'right' }))
        await surface(c, '015-pane-more', click(page.getByTestId('btn-terminal-more')))
        await surface(c, '016-team', () => page.keyboard.press('Control+Shift+T'))
        await surface(c, '017-about', palette(page, 'About'))
        await surface(c, '018-shortcuts', palette(page, 'Keyboard shortcuts'))
        await surface(c, '019-usage', palette(page, 'Usage'))
        await surface(c, '020-report-problem', palette(page, 'Report a problem'))
        await surface(c, '021-workspace-settings', palette(page, 'Workspace settings'))
        await surface(c, '022-mcp', palette(page, 'MCP servers'))
        await surface(c, '023-skills', palette(page, 'Skills'))
        await surface(c, '024-scripts', palette(page, 'Scripts'))
        await surface(c, '025-approval-history', palette(page, 'Approval history'))
        await surface(c, '026-activity', click(page.getByRole('button', { name: /background activity/i })))

        // Settings: every page in both scopes.
        await surface(c, '030-settings', click(page.getByRole('button', { name: 'Open settings', exact: true })), false)
        const settings = page.getByRole('dialog', { name: 'Settings', exact: true })
        for (const scope of ['Application', 'Workspace']) {
          try {
            await settings.getByRole('group', { name: 'Settings scope' }).getByRole('button', { name: scope, exact: true }).click({ timeout: 3000 })
            const nav = settings.getByRole('navigation', { name: 'Settings categories' }).getByRole('button')
            const n = await nav.count()
            for (let i = 0; i < n; i++) {
              const label = (await nav.nth(i).innerText()).split('\n')[0].trim().toLowerCase().replace(/[^a-z0-9]+/g, '-')
              await surface(c, `031-settings-${scope.toLowerCase()}-${String(i).padStart(2, '0')}-${label}`, () => nav.nth(i).click(), false)
            }
          } catch (error) { failures.push(`settings ${scope}: ${(error as Error).message.split('\n')[0]}`) }
        }
        for (let i = 0; i < 3; i++) await page.keyboard.press('Escape')

        // OxeChat.
        await registerThreadProject(app, page, workspaceRoot)
        await openThreadWithState(app, page, workspaceRoot, 'conversation')
        await page.waitForTimeout(800)
        await surface(c, '040-chat-conversation', async () => undefined, false)
        await surface(c, '041-chat-header-more', click(page.getByRole('button', { name: 'More actions', exact: true })))
        await surface(c, '042-chat-conversation-actions', click(page.getByRole('button', { name: 'Conversation actions', exact: true })))
        await surface(c, '043-chat-rename', async () => { await page.getByRole('button', { name: 'Conversation actions', exact: true }).first().click(); await page.getByRole('menuitem', { name: /Rename/ }).click() })
        await surface(c, '044-chat-delete-confirm', async () => { await page.getByRole('button', { name: 'Conversation actions', exact: true }).first().click(); await page.getByRole('menuitem', { name: /Delete/ }).click() })
        await surface(c, '045-chat-model', click(page.locator('.thread-config-trigger').first()))
        await surface(c, '046-chat-permissions', click(page.locator('.thread-config-trigger.is-permissions')))
        await surface(c, '047-chat-composer-add', click(page.getByRole('button', { name: /^Add/ })))
        await surface(c, '048-chat-commands', click(page.getByRole('button', { name: /commands/i })))
        await surface(c, '049-chat-usage-ring', click(page.locator('.thread-usage-ring, [class*="usage-ring"]')))
        await surface(c, '050-chat-side-chat', async () => { await page.locator('textarea[data-thread-composer]').first().click(); await page.keyboard.press('Control+.') }, false)
        await page.keyboard.press('Control+.').catch(() => undefined)
        await surface(c, '051-chat-details', async () => { await page.getByRole('button', { name: 'More actions', exact: true }).first().click(); await page.getByRole('menuitem', { name: /details/i }).click() }, false)
        await page.keyboard.press('Escape')
        await surface(c, '052-chat-accounts', click(page.getByRole('button', { name: /Agent accounts|Provider accounts/ })))
        await surface(c, '053-chat-new-conversation', click(page.getByRole('button', { name: /New conversation/ })))
        await surface(c, '054-chat-sidebar-menu', () => page.locator('.thread-sidebar [role="listitem"], .thread-sidebar li').first().click({ button: 'right' }))
        for (const state of ['approval', 'question', 'auth-failure', 'empty'] as const) {
          await surface(c, `055-chat-state-${state}`, async () => { await setThreadState(app, workspaceRoot, state as never); await page.waitForTimeout(800) }, false)
        }

        // OxeQuery, OxePod, OxePost entry screens and their dialogs.
        await surface(c, '060-query', click(modeButton(page, 'data')), false)
        await surface(c, '061-query-new-connection', click(page.getByRole('button', { name: /New connection|Add connection/ })))
        await surface(c, '062-query-preferences', click(page.getByRole('button', { name: /Preferences|OxeQuery settings/ })))
        await surface(c, '063-query-import', click(page.getByRole('button', { name: /^Import/ })))
        await surface(c, '070-pod', click(modeButton(page, 'pods')), false)
        await surface(c, '080-post', click(modeButton(page, 'post')), false)
        await surface(c, '081-post-environments', click(page.getByRole('button', { name: /Environments/ })))
        await surface(c, '082-post-import', click(page.getByRole('button', { name: /^Import/ })))
        await surface(c, '083-post-new-request', click(page.getByRole('button', { name: /New request/ })), false)
      } catch (error) {
        // Never fail the workflow: the real baselines must still verify and upload.
        failures.push(`STOPPED: ${(error as Error).message.split('\n')[0]}`)
      } finally {
        writeFileSync(join(dir, 'step-failures.json'), JSON.stringify(failures, null, 2))
        writeFileSync(join(dir, 'facts.json'), JSON.stringify(collected, null, 2))
        await app.close().catch(() => undefined)
      }
    })
  }
}

test.afterAll(() => { if (enabled && existsSync(OUT)) writeFileSync(DONE, new Date().toISOString()) })
