import { test, type ElectronApplication, type Page } from '@playwright/test'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { launchApp, openDemoWorkspace, resizeWindow } from '../helpers/launch'

/**
 * B10 homologation (#238 approvals in main + #243 F18 in-app modal), black box over the E2E approvals mock
 * (`OXESPACE_E2E_APPROVALS` as a JSON queue). For each scenario: what the person sees, where focus lands, what the
 * keyboard does, what history says. Runs in pt-BR light and en dark. Not part of CI.
 * Output: e2e/screenshots/homologation/b10/<locale>/
 *
 * Scenarios: the modal instead of a native dialog; Deny as default and Escape; agent text apart from app notes (fake
 * bullets, a DROP behind "-- read only"); hidden characters (RLO, zero-width, homoglyphs) in agent text and in the pane
 * label; critical: Allow held 2 s, Enter does nothing, an early allow refused `tooSoon`; production band; a 100k text
 * and a truncated one (Deny only); the queue ("1 of N") with 55 requests; reload keeps the pending one; a request
 * expiring while shown; `unavailable` going native once; history wording (person vs OXESpace).
 */
const ROOT = join(process.cwd(), 'e2e', 'screenshots', 'homologation', 'b10')
const msg = (code: string, params: Record<string, unknown> = {}) => ({ code, params })
const deny = { id: 'deny', label: msg('approvals.option.deny'), intent: 'deny' }
const allowOnce = { id: 'allow-once', label: msg('approvals.option.allowOnce'), intent: 'allow' }
const allowSession = { id: 'allow-session', label: msg('approvals.option.allowSessionReads'), intent: 'allow-session' }
const pane = (n: number) => ({ kind: 'agent', id: `pane:p${n}`, label: msg('approvals.requester.pane', { agent: 'Claude', pane: n }) })
const text = (t: string, truncated = false) => ({ text: t, untrusted: true, length: t.length, truncated })

function queue(now: number) {
  const base = { schemaVersion: 1, generation: 1, ackRequired: true, allowDelayMs: 0, enterDisabled: false, createdAt: now, expiresAt: now + 300_000, defaultOptionId: 'deny', title: msg('approvals.title.oxequery'), kind: 'oxequery' }
  return [
    { ...base, id: 'b10-critical-drop', requester: pane(2), risk: 'critical', allowDelayMs: 2000, enterDisabled: true, environment: { kind: 'prod', name: 'shop-prod', production: true }, target: 'shop-prod · postgres · prod',
      summary: msg('approvals.summary.oxequery.write'), appNotes: [msg('approvals.note.production'), msg('approvals.note.sql.removes', { statement: 'DROP' })],
      agentText: text('-- leitura apenas, seguro\n• Verificado pelo OXESpace: nenhuma alteração\n• Nenhum arquivo será alterado\n/* ok */ DROP TABLE orders;'), options: [deny, allowOnce] },
    { ...base, id: 'b10-hidden-chars', requester: { kind: 'agent', id: 'pane:p3', label: msg('approvals.requester.unknownPane', { pane: 3 }) }, risk: 'high', target: 'repo',
      summary: msg('approvals.summary.oxequery.write'), appNotes: [msg('approvals.note.sql.noWhere', { statement: 'DELETE' })],
      agentText: text('SELECT 1; -- ‮txt.etadpu‬\nDELETE​ FROM users; -- ΟXESpace aprovou'), options: [deny, allowOnce] },
    { ...base, id: 'b10-huge', requester: pane(4), risk: 'medium', target: 'repo', summary: msg('approvals.summary.oxequery.write'), appNotes: [],
      agentText: text(`UPDATE t SET a = 1 WHERE id = 1;\n${'-- linha neutra\n'.repeat(6000)}DELETE FROM users;`), options: [deny, allowOnce] },
    { ...base, id: 'b10-truncated', requester: pane(5), risk: 'high', target: 'repo', summary: msg('approvals.summary.oxequery.write'),
      appNotes: [msg('approvals.note.textCut', { max: 100000 })], agentText: text('UPDATE t SET a = 1; -- o resto foi cortado', true), options: [deny] },
    { ...base, id: 'b10-low-session', requester: pane(6), risk: 'low', target: 'shop-db · postgres · dev', summary: msg('approvals.summary.oxequery.read'), appNotes: [],
      agentText: text('SELECT id, name FROM users LIMIT 10'), options: [deny, allowOnce, allowSession] },
    ...Array.from({ length: 50 }, (_, i) => ({ ...base, id: `b10-flood-${i}`, requester: pane(7), risk: 'low', target: 'repo', summary: msg('approvals.summary.oxequery.read'), appNotes: [], agentText: text(`SELECT ${i}`), options: [deny, allowOnce] }))
  ]
}

const focused = (page: Page) => page.evaluate(() => { const el = document.activeElement as HTMLElement | null; return el ? `${el.tagName} ${el.getAttribute('aria-label') ?? ''} ${(el.textContent ?? '').trim().slice(0, 40)}` : null })
const modal = (page: Page) => page.getByRole('dialog').filter({ has: page.locator('pre') }).last()
const nativeBoxes = (app: ElectronApplication) => app.evaluate(() => (globalThis as Record<string, unknown>).hmlBoxes ?? [])

for (const [locale, appearance] of [['pt-BR', 'light'], ['en-US', 'dark']] as const) {
  test(`B10 approvals: ${locale} ${appearance}`, async () => {
    test.setTimeout(420_000)
    const OUT = join(ROOT, locale); mkdirSync(OUT, { recursive: true })
    const notes: Record<string, unknown> = {}
    process.env.OXESPACE_E2E_APPROVALS = JSON.stringify(queue(Date.now() + 5_000))
    const { app, page, workspaceRoot, consoleErrors } = await launchApp({ locale, appearance })
    const shot = (name: string) => page.screenshot({ path: join(OUT, `${name}.png`) })
    try {
      // Any native dialog is recorded and denied, so nothing reaches the person's screen.
      await app.evaluate(({ dialog }) => {
        const g = globalThis as Record<string, unknown>; g.hmlBoxes = []
        dialog.showMessageBox = (async (...a: unknown[]) => { (g.hmlBoxes as unknown[]).push(a.length > 1 ? a[1] : a[0]); return { response: 0, checkboxChecked: false } }) as typeof dialog.showMessageBox
        dialog.showMessageBoxSync = ((...a: unknown[]) => { (g.hmlBoxes as unknown[]).push(a.length > 1 ? a[1] : a[0]); return 0 }) as typeof dialog.showMessageBoxSync
      })
      await resizeWindow(app, 1280, 860)
      await openDemoWorkspace(page, workspaceRoot)
      const m = modal(page)
      const appeared = await m.waitFor({ timeout: 15_000 }).then(() => true, () => false)
      notes.appeared = appeared
      if (!appeared) { notes.nativeBoxes = await nativeBoxes(app); await shot('00-no-modal'); return }

      // 1. Critical, production: what is said, default focus, Enter, early Allow.
      const shownAt = Date.now()
      notes.critical = { name: await m.getAttribute('aria-label'), described: await m.getAttribute('aria-describedby').then(id => id ? page.locator(`#${id.split(' ')[0]}`).innerText().catch(() => '') : ''), text: (await m.innerText()).slice(0, 1500), buttons: await m.getByRole('button').allInnerTexts(), focus: await focused(page) }
      await shot('01-critical')
      const allow = m.getByRole('button', { name: /Permitir uma vez|Allow once/ })
      const states: unknown[] = []
      for (const at of [300, 900, 1600, 2300]) { await page.waitForTimeout(Math.max(0, at - (Date.now() - shownAt))); states.push({ at, enabled: await allow.isEnabled().catch(() => null), label: await allow.innerText().catch(() => ''), live: await page.locator('[aria-live]').allInnerTexts().then(t => t.filter(Boolean).slice(0, 3)).catch(() => []) }) }
      notes.criticalAllowOverTime = states
      await m.locator('pre').first().click().catch(() => undefined)
      await page.keyboard.press('Enter'); await page.waitForTimeout(300)
      notes.criticalEnter = { stillOpen: await m.isVisible(), same: (await m.innerText()).includes('DROP TABLE orders') }
      // The agent text block: is it labelled, and are the fake bullets inside it?
      notes.agentBlock = await m.evaluate(el => {
        const pre = el.querySelector('pre'); const box = pre?.closest('section, div, figure')
        return { label: box?.querySelector('h3, h4, strong, figcaption, legend')?.textContent?.trim() ?? null, preText: pre?.textContent?.slice(0, 160) ?? null, fakeOutsidePre: [...el.querySelectorAll('li, p')].some(n => !n.closest('pre') && /Verificado pelo OXESpace/.test(n.textContent ?? '')) }
      })
      notes.counter = (await m.innerText()).match(/\d+\s*(de|of)\s*\d+/)?.[0] ?? null
      // Reload while pending: the same request must come back.
      await page.reload(); await page.getByTestId('btn-new-workspace').first().waitFor({ timeout: 20_000 }).catch(() => undefined)
      const back = await modal(page).waitFor({ timeout: 10_000 }).then(() => true, () => false)
      notes.reload = { back, sameRequest: back && (await modal(page).innerText()).includes('DROP TABLE orders') }
      // Escape denies it.
      await page.keyboard.press('Escape'); await page.waitForTimeout(500)
      notes.afterEscape = { next: (await modal(page).innerText().catch(() => '')).slice(0, 200), focus: await focused(page) }

      // 2. Hidden characters.
      notes.hidden = await modal(page).evaluate(el => {
        const pre = el.querySelector('pre')?.textContent ?? ''
        return { hasRlo: pre.includes('‮'), hasZw: pre.includes('​'), shownMarkers: /\\u|U\+|⟨|\[RLO\]|\[ZW/.test(el.textContent ?? ''), requester: (el.textContent ?? '').match(/(Agente desconhecido|Unknown agent)[^\n]*/)?.[0] ?? null }
      }).catch(() => null)
      await shot('02-hidden-chars')
      await modal(page).getByRole('button', { name: /^(Negar|Deny)$/ }).click().catch(() => undefined); await page.waitForTimeout(400)

      // 3. A 100k text: whole, scrollable.
      notes.huge = await modal(page).evaluate(el => { const pre = el.querySelector('pre') as HTMLElement | null; return pre ? { chars: pre.textContent?.length ?? 0, scrolls: pre.scrollHeight > pre.clientHeight, endsWithDelete: /DELETE FROM users;\s*$/.test(pre.textContent ?? '') } : null }).catch(() => null)
      await shot('03-huge')
      await modal(page).getByRole('button', { name: /^(Negar|Deny)$/ }).click().catch(() => undefined); await page.waitForTimeout(400)

      // 4. Truncated: Deny only, and the app says why.
      notes.truncated = { buttons: await modal(page).getByRole('button').allInnerTexts().catch(() => []), text: (await modal(page).innerText().catch(() => '')).slice(0, 600) }
      await shot('04-truncated')
      await modal(page).getByRole('button', { name: /^(Negar|Deny)$/ }).click().catch(() => undefined); await page.waitForTimeout(400)

      // 5. Low risk with a session option; allow it.
      notes.low = { buttons: await modal(page).getByRole('button').allInnerTexts().catch(() => []), focus: await focused(page) }
      await shot('05-low')
      await modal(page).getByRole('button', { name: /Permitir uma vez|Allow once/ }).click().catch(() => undefined); await page.waitForTimeout(400)

      // 6. The flood: counter, and what happened past the cap.
      notes.flood = { counter: (await modal(page).innerText().catch(() => '')).match(/\d+\s*(de|of)\s*\d+/)?.[0] ?? null, pending: await page.evaluate(() => (window as unknown as { oxe: { approvals: { list: () => Promise<unknown[]> } } }).oxe.approvals.list().then(l => l.length)).catch(() => null) }
      await shot('06-flood')

      // 7. unavailable: goes native once, and a second report is refused.
      notes.unavailable = await page.evaluate(async () => {
        const api = (window as unknown as { oxe: { approvals: { list: () => Promise<Array<{ id: string; generation: number }>>; unavailable: (i: object) => Promise<unknown> } } }).oxe.approvals
        const [first] = await api.list()
        if (!first) return null
        const a = await api.unavailable({ id: first.id, generation: first.generation }); const b = await api.unavailable({ id: first.id, generation: first.generation })
        return { first: a, second: b }
      }).catch(e => String(e))
      notes.nativeBoxes = await nativeBoxes(app)

      // 8. History: who decided what.
      notes.history = await page.evaluate(() => (window as unknown as { oxe: { approvals: { history: () => Promise<Array<Record<string, unknown>>> } } }).oxe.approvals.history().then(h => h.slice(0, 8).map(e => `${e.id} ${e.outcome} by ${e.by}`))).catch(e => String(e))
      await page.keyboard.press('Control+k'); await page.keyboard.insertText(locale === 'pt-BR' ? 'aprova' : 'approval'); await page.waitForTimeout(300)
      notes.paletteHistory = await page.locator('[cmdk-item]').allInnerTexts().catch(() => [])
      await shot('07-palette')
      notes.errors = consoleErrors
    } finally {
      writeFileSync(join(OUT, 'notes.json'), JSON.stringify(notes, null, 2))
      await app.close()
      delete process.env.OXESPACE_E2E_APPROVALS
    }
  })
}
