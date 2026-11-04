import { _electron as electron, expect, test, type ElectronApplication, type Page, type TestInfo } from '@playwright/test'
import { rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { launchReal, mode, openRepo, quitReal, realProfile } from './real-app'
import { writeFutureDatabase } from './future-db'

/**
 * HML · 1.5.0 F1, black box on the REAL app (no doubles): what has landed on main from F1, in the corners the item's
 * own specs don't walk.
 *
 * - A36 (T87): the startup failure screen in pt-BR, in the dark theme, at 900 × 620 and by keyboard only, for a newer
 *   database and for a file that isn't a database at all.
 * - C4 tokens (A1, A2, UT): the dark accent and the selected fill are the 1.5 values, a selected row reads AA in both
 *   themes, the focus ring is visible, and nothing overflows sideways at 900 × 620 in OxeCode, OxeChat and Settings,
 *   in en and pt-BR.
 *
 * Screenshots go to test-results (the acceptance workflow uploads it) for the HML visual pass.
 * No agent, no account: the profile's agent folders are empty, and nothing here sends a message.
 */

async function setWindow(app: ElectronApplication, width: number, height: number): Promise<void> {
  await app.evaluate(({ BrowserWindow }, size) => {
    const win = BrowserWindow.getAllWindows()[0]
    win.setMinimumSize(1, 1); win.setSize(size.width, size.height)
  }, { width, height })
}

async function shot(page: Page, info: TestInfo, name: string): Promise<void> {
  await page.waitForTimeout(300)
  await page.screenshot({ path: info.outputPath(`${name}.png`) })
}

/** Pixels the page scrolls sideways (0 means no horizontal overflow). */
const sidewaysOverflow = (page: Page) => page.evaluate(() => Math.max(0, document.documentElement.scrollWidth - document.documentElement.clientWidth, document.body.scrollWidth - document.body.clientWidth))

/** What the focused element is, and whether a focus indicator is drawn on it. */
const focused = (page: Page) => page.evaluate(() => {
  const el = document.activeElement as HTMLElement | null
  if (!el || el === document.body) return { name: '(body)', visible: false }
  const style = getComputedStyle(el)
  const ring = (style.outlineStyle !== 'none' && parseFloat(style.outlineWidth) > 0) || (style.boxShadow && style.boxShadow !== 'none')
  return { name: `${el.tagName.toLowerCase()} ${(el.getAttribute('aria-label') || el.textContent || '').trim().slice(0, 60)}`, visible: Boolean(ring) }
})

function luminance(rgb: string): number {
  const [r, g, b] = (rgb.match(/[\d.]+/g) ?? ['0', '0', '0']).slice(0, 3).map(Number).map(v => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4 })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}
const contrast = (a: string, b: string) => { const [x, y] = [luminance(a), luminance(b)].sort((m, n) => n - m); return (x + 0.05) / (y + 0.05) }

/** Text color and the first opaque background behind an element. */
const colorsOf = (page: Page, selector: string) => page.evaluate((sel) => {
  const el = document.querySelector(sel) as HTMLElement | null
  if (!el) return null
  const fg = getComputedStyle(el).color
  let node: HTMLElement | null = el; let bg = 'rgba(0, 0, 0, 0)'
  while (node) { const c = getComputedStyle(node).backgroundColor; if (c && !/rgba\(.*,\s*0\)$/.test(c) && c !== 'transparent') { bg = c; break } node = node.parentElement }
  return { fg, bg }
}, selector)

const rootVar = (page: Page, name: string) => page.evaluate((n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim().toLowerCase(), name)

test.describe('A36 startup failure screen, beyond the default case', () => {
  for (const locale of ['pt-BR', 'en-US']) {
    test(`newer database · ${locale} · dark · 900x620 · keyboard only`, async ({}, info) => {
      test.setTimeout(150_000)
      const profile = realProfile(`hml-a36-${locale}`, { OXESPACE_LOCALE: locale })
      writeFutureDatabase(profile.db, 999)
      const app = await electron.launch({ args: [join(process.cwd(), 'e2e', 'electron-main.cjs')], env: profile.env, colorScheme: 'dark' })
      try {
        const page = await app.firstWindow()
        await setWindow(app, 900, 620)
        const screen = page.getByTestId('startup-failure')
        await expect(screen).toBeVisible({ timeout: 30_000 })
        const heading = await screen.getByRole('heading').first().innerText()
        info.annotations.push({ type: 'heading', description: heading })
        if (locale === 'pt-BR') expect.soft(heading, 'the heading is translated').not.toBe('This data comes from a newer OXESpace')
        expect.soft(await sidewaysOverflow(page), 'nothing overflows sideways at 900 × 620').toBe(0)
        const buttons = await screen.getByRole('button').allInnerTexts()
        info.annotations.push({ type: 'buttons', description: buttons.join(' | ') })
        expect.soft(buttons.length, 'the three ways out are there').toBeGreaterThanOrEqual(3)
        // Keyboard only: where focus starts, and every stop on the way through the screen.
        const stops = [await focused(page)]
        for (let i = 0; i < 6; i++) { await page.keyboard.press('Tab'); stops.push(await focused(page)) }
        info.annotations.push({ type: 'tab stops', description: stops.map(s => `${s.name}${s.visible ? '' : ' [NO RING]'}`).join(' → ') })
        for (const stop of stops.slice(1)) expect.soft(stop.visible, `focus is visible on ${stop.name}`).toBe(true)
        // Esc must not dismiss the blocking screen.
        await page.keyboard.press('Escape')
        await expect.soft(screen, 'Esc leaves the blocking screen up').toBeVisible()
        // Details folds open by keyboard.
        const details = screen.getByText(locale === 'pt-BR' ? /Detalhes|Details/ : 'Details', { exact: false }).first()
        await details.focus().catch(() => undefined); await page.keyboard.press('Enter')
        await shot(page, info, `a36-newer-${locale}-dark-900`)
        await expect.soft(page.getByTestId('btn-new-workspace'), 'the normal app did not mount behind it').toHaveCount(0)
      } finally {
        await quitReal(app)
        rmSync(profile.root, { recursive: true, force: true })
      }
    })
  }

  test('a file that is not a database shows the failure screen, not an empty app', async ({}, info) => {
    test.setTimeout(150_000)
    const profile = realProfile('hml-a36-garbage')
    writeFileSync(profile.db, Buffer.from('this is not a database, it is a text file a person saved here by mistake\n'.repeat(80)))
    const app = await electron.launch({ args: [join(process.cwd(), 'e2e', 'electron-main.cjs')], env: profile.env })
    try {
      const page = await app.firstWindow()
      const screen = page.getByTestId('startup-failure')
      const shown = await screen.waitFor({ state: 'visible', timeout: 30_000 }).then(() => true, () => false)
      info.annotations.push({ type: 'garbage-db', description: shown ? `failure screen, code=${await screen.getAttribute('data-code')}, heading=${await screen.getByRole('heading').first().innerText()}` : 'NO failure screen' })
      await shot(page, info, 'a36-garbage-db')
      expect(shown, 'a file that is not a database shows the failure screen').toBe(true)
      await expect.soft(page.getByTestId('btn-new-workspace')).toHaveCount(0)
      await expect.soft(page.getByText('Could not load conversations')).toHaveCount(0)
    } finally {
      await quitReal(app)
      rmSync(profile.root, { recursive: true, force: true })
    }
  })
})

test.describe('A8 workspace color, stored (#605)', () => {
  type Ws = { id: string; name: string; color?: number | null }
  const api = <T>(page: Page, fn: 'list' | 'updateSettings', arg?: unknown) => page.evaluate(async ([f, a]) => {
    const ws = (window as unknown as { oxe: { workspace: Record<string, (x?: unknown) => Promise<unknown>> } }).oxe.workspace
    try { return { ok: true, value: await ws[f as string](a) } } catch (error) { return { ok: false, value: String(error instanceof Error ? error.message : error) } }
  }, [fn, arg] as const) as Promise<{ ok: boolean; value: T | string }>

  test('a color is kept, bad values are refused, and it survives a restart', async ({}, info) => {
    test.setTimeout(180_000)
    const profile = realProfile('hml-a8')
    const notes: string[] = []
    let { app, page } = await launchReal(profile)
    try {
      await openRepo(page, profile.repo)
      const listed = await api<Ws[]>(page, 'list')
      const ws = (listed.value as Ws[])[0]
      notes.push(`new workspace color: ${JSON.stringify(ws.color)} (nothing chosen yet)`)
      expect.soft(ws.color ?? null, 'a new workspace has no stored color').toBeNull()

      const set3 = await api<Ws>(page, 'updateSettings', { workspaceId: ws.id, color: 3 })
      notes.push(`set 3 → ${set3.ok ? JSON.stringify((set3.value as Ws).color) : set3.value}`)
      expect.soft(set3.ok && (set3.value as Ws).color, 'color 3 is stored').toBe(3)

      for (const bad of [0, 9, -1, 3.5, '3', 'red', true]) {
        const r = await api<Ws>(page, 'updateSettings', { workspaceId: ws.id, color: bad })
        notes.push(`set ${JSON.stringify(bad)} → ${r.ok ? 'ACCEPTED ' + JSON.stringify((r.value as Ws).color) : 'refused: ' + String(r.value).slice(0, 120)}`)
        expect.soft(r.ok, `color ${JSON.stringify(bad)} is refused`).toBe(false)
      }
      const after = ((await api<Ws[]>(page, 'list')).value as Ws[]).find(w => w.id === ws.id)
      expect.soft(after?.color, 'a refused value leaves the stored color as it was').toBe(3)

      // A name change alone leaves the color alone (undefined = leave as is).
      const renamed = await api<Ws>(page, 'updateSettings', { workspaceId: ws.id, name: 'renamed by HML' })
      notes.push(`rename only → color ${renamed.ok ? JSON.stringify((renamed.value as Ws).color) : renamed.value}`)
      expect.soft(renamed.ok && (renamed.value as Ws).color, 'a rename keeps the color').toBe(3)

      // Restart on the same profile.
      await quitReal(app)
      ;({ app, page } = await launchReal(profile))
      const again = ((await api<Ws[]>(page, 'list')).value as Ws[]).find(w => w.id === ws.id)
      notes.push(`after restart: ${JSON.stringify(again?.color)}`)
      expect.soft(again?.color, 'the color survives a restart').toBe(3)

      const cleared = await api<Ws>(page, 'updateSettings', { workspaceId: ws.id, color: null })
      notes.push(`clear → ${cleared.ok ? JSON.stringify((cleared.value as Ws).color) : cleared.value}`)
      expect.soft(cleared.ok && (cleared.value as Ws).color, 'null clears the color').toBeNull()
      const dataWs = await page.evaluate(() => [...new Set([...document.querySelectorAll('[data-ws]')].map(e => e.getAttribute('data-ws')))])
      notes.push(`data-ws on the page: ${JSON.stringify(dataWs)} (the surfaces come with #610)`)
      // Unknown workspace id.
      const ghost = await api<Ws>(page, 'updateSettings', { workspaceId: 'no-such-workspace', color: 2 })
      notes.push(`unknown workspace → ${ghost.ok ? 'ACCEPTED' : 'refused: ' + String(ghost.value).slice(0, 120)}`)
      expect.soft(ghost.ok, 'an unknown workspace id is refused').toBe(false)
    } finally {
      info.annotations.push({ type: 'a8', description: notes.join('\n') })
      writeFileSync(info.outputPath('a8-report.txt'), notes.join('\n'))
      await quitReal(app)
      rmSync(profile.root, { recursive: true, force: true })
    }
  })
})

test.describe('C4 tokens on the real app', () => {
  for (const locale of ['en-US', 'pt-BR']) {
    test(`themes, selected row, focus and 900x620 · ${locale}`, async ({}, info) => {
      test.setTimeout(180_000)
      const profile = realProfile(`hml-c4-${locale}`, { OXESPACE_LOCALE: locale })
      const { app, page } = await launchReal(profile)
      try {
        await setWindow(app, 900, 620)
        await openRepo(page, profile.repo)
        const report: string[] = []
        for (const theme of ['light', 'dark'] as const) {
          // Theme by the app's own switch, as a person would: the sidebar's light/dark button.
          const current = await page.evaluate(() => document.documentElement.dataset.theme ?? '')
          if (current !== theme) {
            const toggle = page.getByRole('button', { name: theme === 'dark' ? /dark|escuro/i : /light|claro/i }).first()
            await toggle.click().catch(async () => { await page.emulateMedia({ colorScheme: theme }) })
            await page.waitForTimeout(400)
          }
          const accent = await rootVar(page, '--accent'); const selected = await rootVar(page, '--fill-selected')
          report.push(`${theme}: data-theme=${await page.evaluate(() => document.documentElement.dataset.theme ?? '')} --accent=${accent} --fill-selected=${selected}`)
          if (theme === 'dark') {
            expect.soft(accent, 'dark accent is caatinga').toBe('#49a072')
            expect.soft(selected, 'dark selected fill is visible').toBe('#122c1e')
          }
          for (const m of ['code', 'thread'] as const) {
            await mode(page, m); await page.waitForTimeout(800)
            const overflow = await sidewaysOverflow(page)
            report.push(`${theme} ${m}: sideways overflow ${overflow}px`)
            expect.soft(overflow, `${m} (${theme}) has no sideways overflow at 900 × 620`).toBe(0)
            // The selected row in the sidebar: AA text on its fill.
            const sel = await colorsOf(page, '[aria-current="true"], [aria-selected="true"], [aria-pressed="true"][data-selected], .is-selected, [data-selected="true"]')
            if (sel) { const ratio = contrast(sel.fg, sel.bg); report.push(`${theme} ${m}: selected row ${sel.fg} on ${sel.bg} = ${ratio.toFixed(2)}:1`); expect.soft(ratio, `selected row text is AA (${theme}, ${m})`).toBeGreaterThanOrEqual(4.5) }
            await shot(page, info, `c4-${locale}-${theme}-${m}-900`)
          }
          // Keyboard: the first stops from the top of the window show a ring.
          await mode(page, 'code'); await page.waitForTimeout(400)
          await page.locator('body').click({ position: { x: 5, y: 5 } }).catch(() => undefined)
          const stops: string[] = []
          for (let i = 0; i < 8; i++) { await page.keyboard.press('Tab'); const f = await focused(page); stops.push(`${f.name}${f.visible ? '' : ' [NO RING]'}`); expect.soft(f.visible, `focus ring on ${f.name} (${theme})`).toBe(true) }
          report.push(`${theme} tab stops: ${stops.join(' → ')}`)
          // Settings at 900 × 620.
          await page.keyboard.press('Control+,'); await page.waitForTimeout(1000)
          const overflow = await sidewaysOverflow(page)
          report.push(`${theme} settings: sideways overflow ${overflow}px`)
          expect.soft(overflow, `Settings (${theme}) has no sideways overflow at 900 × 620`).toBe(0)
          await shot(page, info, `c4-${locale}-${theme}-settings-900`)
          await page.keyboard.press('Escape'); await page.waitForTimeout(400)
        }
        if (locale === 'pt-BR') {
          const label = (await page.getByTestId('btn-new-workspace').first().innerText().catch(() => '')).trim()
          report.push(`pt-BR New workspace label: "${label}"`)
          expect.soft(label, 'the New workspace button is translated').not.toMatch(/^New workspace$/)
        }
        info.annotations.push({ type: 'report', description: report.join('\n') })
        writeFileSync(info.outputPath('report.txt'), report.join('\n'))
      } finally {
        await quitReal(app)
        rmSync(profile.root, { recursive: true, force: true })
      }
    })
  }
})
