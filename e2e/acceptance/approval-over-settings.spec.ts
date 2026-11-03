import { expect, test, type Locator, type Page } from '@playwright/test'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { launchReal, openRepo, quitReal, realProfile } from './real-app'

/**
 * 1.4.1 FRONTEND (DESIGN ruling, 02/11; found by HML batch-3b) · Black box, REAL app: an approval that arrives while
 * Settings is open opens ON TOP of Settings. Done when:
 *   1. the approval is the topmost layer and Settings stays open (mounted and visible) under it;
 *   2. once answered, the focus is back on the same control in Settings, on the same page, at the same scroll;
 *   3. Esc closes only the approval, as Deny; Settings stays open.
 * RED until the FRONTEND PR lands (today the approval takes the focus and Settings closes). Non-blocking: acceptance
 * runs only on dispatch.
 *
 * The approval is real: a script started in the pane's own terminal calls the internal MCP with that pane's execution
 * credentials, as an agent in the pane would (oxespace_skills_change create, confirm level). It is denied both times,
 * so nothing is created. Two requests: the first answered with Esc, the second with the Deny button.
 */
const CALLS = String.raw`
const [out, ...delays] = process.argv.slice(2)
const headers = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + process.env.OXESPACE_MCP_TOKEN, 'X-OXE-Workspace-Id': process.env.OXESPACE_WORKSPACE_ID,
  'X-OXE-Execution-Id': process.env.OXESPACE_EXECUTION_ID, 'X-OXE-Execution-Token': process.env.OXESPACE_EXECUTION_TOKEN }
const results = []
const call = i => fetch('http://127.0.0.1:' + process.env.OXESPACE_MCP_PORT + '/rpc', { method: 'POST', headers, signal: AbortSignal.timeout(120000),
  body: JSON.stringify({ jsonrpc: '2.0', id: i, method: 'tools/call', params: { name: 'oxespace_skills_change', arguments: { action: 'create', name: 'aos-' + i, description: 'acceptance', body: 'never approved' } } }) })
  .then(r => r.text(), e => 'error: ' + e.message).then(t => { results[i] = t.slice(0, 300); require('fs').writeFileSync(out, JSON.stringify(results)) })
;(async () => { for (let i = 0; i < delays.length; i++) { await new Promise(r => setTimeout(r, Number(delays[i]))); await call(i) } })()
`
const ARMED = 600 // the approval ignores answers for 400 ms after it appears (#243)
const approval = (page: Page) => page.getByTestId('approval-dialog')
// By CSS, not by role: while the approval is up the layer under it is aria-hidden, which a role query skips even
// though the person still sees it.
const settingsDialog = (page: Page) => page.locator('[role="dialog"]:has(nav[aria-label="Settings categories"])').first()
const pending = (page: Page) => page.evaluate(() => (window as unknown as { oxe: { approvals: { list: () => Promise<Array<{ id: string }>> } } }).oxe.approvals.list().then(l => l.length))
const history = (page: Page) => page.evaluate(() => (window as unknown as { oxe: { approvals: { history: () => Promise<Array<{ id: string; by: string; outcome: string }>> } } }).oxe.approvals.history())

/** Where the person is in Settings: the focused control, the selected page and the content's scroll. */
async function place(page: Page, settings: Locator) {
  return settings.evaluate(dialog => {
    const active = document.activeElement as HTMLElement | null
    const describe = (node: HTMLElement | null) => node ? `${node.tagName.toLowerCase()}|${node.getAttribute('role') ?? ''}|${node.getAttribute('aria-label') ?? ''}|${(node.textContent ?? '').trim().slice(0, 40)}` : 'none'
    const selected = dialog.querySelector('nav [aria-current="page"], nav [aria-selected="true"], nav [data-state="active"], nav .is-active') as HTMLElement | null
    const scroller = [...dialog.querySelectorAll<HTMLElement>('*')].filter(n => n.scrollHeight > n.clientHeight + 40 && /auto|scroll/.test(getComputedStyle(n).overflowY) && !n.closest('nav'))
      .sort((a, b) => b.clientHeight - a.clientHeight)[0]
    return { focus: describe(active), focusInSettings: !!active && dialog.contains(active), page: (selected?.textContent ?? '').trim().slice(0, 40), scroll: scroller ? Math.round(scroller.scrollTop) : -1 }
  })
}

/** The approval is the topmost layer: the point at its centre belongs to it, not to Settings. */
const onTop = (page: Page) => approval(page).evaluate(node => {
  const r = node.getBoundingClientRect(); const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)
  return !!hit && node.contains(hit)
})

test('approval over Settings: on top, Settings stays, focus and place come back, Esc denies only the approval', async () => {
  test.setTimeout(240_000)
  const profile = realProfile('aos', { OXESPACE_LOCALE: 'en-US' })
  const script = join(profile.root, 'calls.js'); writeFileSync(script, CALLS)
  const results = join(profile.root, 'calls.json')
  const { app, page } = await launchReal(profile)
  const out: Record<string, unknown> = {}
  try {
    await app.evaluate(({ dialog }) => {
      const g = globalThis as Record<string, unknown>; g.nativeAsked = 0
      dialog.showMessageBox = (() => { g.nativeAsked = (g.nativeAsked as number) + 1; return new Promise(() => undefined) }) as typeof dialog.showMessageBox
      dialog.showMessageBoxSync = (() => { g.nativeAsked = (g.nativeAsked as number) + 1; return 0 }) as typeof dialog.showMessageBoxSync
    })
    await openRepo(page, profile.repo)
    await page.locator('[data-testid="pane-container"] .xterm').first().click()
    // First request 15 s from now, the second 10 s after the first is answered.
    await page.keyboard.type(`node "${script}" "${results}" 15000 10000`); await page.keyboard.press('Enter')
    await page.waitForTimeout(1_000)

    // The person is deep in Settings: a page down the list, scrolled, with the focus on its entry.
    await page.keyboard.press('Control+k'); await page.keyboard.insertText('Settings')
    await page.locator('[cmdk-item]', { hasText: 'Settings' }).first().click()
    const settings = settingsDialog(page)
    await expect(settings).toBeVisible({ timeout: 10_000 })
    const entry = settings.getByRole('navigation', { name: 'Settings categories' }).getByRole('button', { name: /^Keyboard/ })
    await entry.click()
    await settings.evaluate(dialog => {
      const scroller = [...dialog.querySelectorAll<HTMLElement>('*')].filter(n => n.scrollHeight > n.clientHeight + 40 && /auto|scroll/.test(getComputedStyle(n).overflowY) && !n.closest('nav'))
        .sort((a, b) => b.clientHeight - a.clientHeight)[0]
      if (scroller) scroller.scrollTop = 240
    })
    await entry.focus()
    const before = await place(page, settings)
    out.before = before
    expect(before.focusInSettings, 'setup: the focus is on a control in Settings').toBe(true)

    for (const [round, answer] of [['esc', 'Escape'], ['deny', 'button']] as const) {
      await expect(approval(page), `${round}: the approval arrives`).toBeVisible({ timeout: 30_000 })
      await page.waitForTimeout(ARMED)
      // How Settings is kept while the approval is up: mounted, and if hidden, by what.
      const kept = await page.evaluate(() => {
        const nav = document.querySelector('nav[aria-label="Settings categories"]')
        const dialog = nav?.closest('[role="dialog"]') as HTMLElement | null
        if (!dialog) return { mounted: false }
        const chain: string[] = []
        for (let node: HTMLElement | null = dialog; node && node !== document.body; node = node.parentElement) {
          const s = getComputedStyle(node)
          if (s.display === 'none' || s.visibility !== 'visible' || Number(s.opacity) === 0 || node.hidden || node.hasAttribute('inert')) chain.push(`${node.tagName.toLowerCase()}.${String(node.className).slice(0, 40)} display=${s.display} visibility=${s.visibility} opacity=${s.opacity} hidden=${node.hidden} inert=${node.hasAttribute('inert')}`)
        }
        const r = dialog.getBoundingClientRect()
        return { mounted: true, rect: [Math.round(r.width), Math.round(r.height)], hiddenBy: chain.slice(0, 4) }
      })
      out[`${round}-kept`] = kept
      expect.soft(kept.mounted, `${round}: Settings stays mounted under the approval`).toBe(true)
      const layered = { settingsVisible: await settings.isVisible(), approvalOnTop: await onTop(page) }
      out[`${round}-layered`] = layered
      expect.soft(layered.settingsVisible, `${round}: Settings stays open under the approval`).toBe(true)
      expect.soft(layered.approvalOnTop, `${round}: the approval is the topmost layer`).toBe(true)
      const decided = new Set((await history(page)).map(h => h.id))
      if (answer === 'Escape') await page.keyboard.press('Escape')
      else await approval(page).getByRole('button', { name: /^Deny$/ }).click()
      await expect.soft(approval(page), `${round}: the approval closes`).toHaveCount(0, { timeout: 5_000 })
      await page.waitForTimeout(500)
      const after = await place(page, settings).catch(() => ({ focus: 'Settings is gone', focusInSettings: false, page: '', scroll: -1 }))
      out[`${round}-after`] = after
      expect.soft(await settings.isVisible(), `${round}: Settings is still open after the answer`).toBe(true)
      expect.soft(after.focus, `${round}: the focus is back on the same control`).toBe(before.focus)
      expect.soft(after.page, `${round}: the same Settings page`).toBe(before.page)
      expect.soft(after.scroll, `${round}: the same scroll`).toBe(before.scroll)
      const latest = (await history(page)).filter(h => !decided.has(h.id))
      out[`${round}-decision`] = latest
      expect.soft(latest.length, `${round}: one decision recorded`).toBe(1)
      expect.soft(latest[0]?.outcome ?? '', `${round}: answered as Deny`).toMatch(/deny|declin/i)
    }
    expect.soft(await pending(page), 'nothing left pending').toBe(0)
    await expect.poll(() => existsSync(results), { timeout: 15_000 }).toBe(true)
    const answers = JSON.parse(readFileSync(results, 'utf8')) as string[]
    out.agentSaw = answers
    expect.soft(answers.every(text => !/"isError"\s*:\s*false/.test(text) || /deni|declin/i.test(text)), 'the agent was refused both times').toBe(true)
    expect.soft(await app.evaluate(() => (globalThis as Record<string, unknown>).nativeAsked), 'no native dialog').toBe(0)
  } finally {
    console.log('AOS', JSON.stringify(out))
    await quitReal(app)
  }
})
