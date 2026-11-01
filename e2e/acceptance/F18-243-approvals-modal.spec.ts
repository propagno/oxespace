import { expect, test, type Page } from '@playwright/test'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { launchApp, resizeWindow } from '../helpers/launch'
import { launchReal, quitReal, realProfile } from './real-app'

/**
 * F18 · #243 (S1) · The Mandacaru approvals modal over B10 (shared/types/approvals.ts).
 * Acceptance: a queue the person walks through in order; a history of this session's decisions; at critical risk the
 * allow waits 2 s and Enter does nothing; a cut (truncated) text can only be denied; past APPROVAL_QUEUE_MAX (50) a new
 * request is refused and logged; a request whose origin goes away is cancelled; never a native dialog.
 *
 * Part 1 drives the B10 e2e double (OXESPACE_E2E_APPROVALS) for what the screen must do with given requests.
 * Part 2 is the REAL app: real confirm-level requests raised from inside two panes, each with its own execution
 * credentials, exactly as an agent in that pane would call the internal MCP (oxespace_skills_change create, never
 * approved, so nothing is created). 25 + 26 requests stay under the 30/min per-pane rate and fill the queue past 50.
 */
const msg = (code: string, params: Record<string, unknown> = {}) => ({ code, params })
const deny = { id: 'deny', label: msg('approvals.option.deny'), intent: 'deny' }
const allow = { id: 'allow-once', label: msg('approvals.option.allowOnce'), intent: 'allow' }
const pane = { kind: 'agent', id: 'pane:p2', label: msg('approvals.requester.pane', { agent: 'Claude', pane: 2 }) }
const HUGE = 'x'.repeat(100_000)

function queue(now: number) {
  const base = { schemaVersion: 1, generation: 1, ackRequired: false, createdAt: now, expiresAt: now + 300_000, defaultOptionId: 'deny', kind: 'oxequery', requester: pane, title: msg('approvals.title.oxequery'), summary: msg('approvals.summary.oxequery.write'), appNotes: [] }
  return [
    { ...base, id: 'f18-critical', risk: 'critical', allowDelayMs: 2_000, enterDisabled: true, appNotes: [msg('approvals.note.sql.removes', { statement: 'DROP' })], agentText: { text: 'DROP TABLE orders;', untrusted: true, length: 18, truncated: false }, options: [deny, allow] },
    { ...base, createdAt: now + 1, id: 'f18-medium', risk: 'medium', allowDelayMs: 0, enterDisabled: false, agentText: { text: 'UPDATE t SET a = 1 WHERE id = 1;', untrusted: true, length: 32, truncated: false }, options: [deny, allow] },
    { ...base, createdAt: now + 2, id: 'f18-cut', risk: 'low', allowDelayMs: 0, enterDisabled: false, summary: msg('approvals.summary.oxequery.read'), agentText: { text: HUGE, untrusted: true, length: 150_000, truncated: true }, options: [deny] }
  ]
}
const pending = (page: Page) => page.evaluate(() => (window as unknown as { oxe: { approvals: { list: () => Promise<Array<{ id: string }>> } } }).oxe.approvals.list().then(l => l.map(r => r.id)))
// The approval window. It stands over the whole app (a modal), so a spec reaches the rest only once it is answered.
const modal = (page: Page) => page.getByTestId('approval-dialog')
/** The window ignores answers for 400 ms after a request appears (#243's ARM_MS); wait past it before answering. */
const ARMED = 600

test('F18/#243: queue in order, critical pacing, a cut text only denies, history, no native dialog', async () => {
  test.setTimeout(120_000)
  // Shown as soon as the window loads, before anything else takes the keyboard: the person sees it first.
  process.env.OXESPACE_E2E_APPROVALS = JSON.stringify(queue(Date.now()))
  const { app, page } = await launchApp({ locale: 'en-US' })
  try {
    await app.evaluate(({ dialog }) => {
      const g = globalThis as Record<string, unknown>; g.nativeAsked = 0
      dialog.showMessageBox = (async () => { g.nativeAsked = (g.nativeAsked as number) + 1; return { response: 0, checkboxChecked: false } }) as typeof dialog.showMessageBox
    })
    await resizeWindow(app, 1280, 860)
    await expect(modal(page)).toBeVisible({ timeout: 15_000 })

    // Queue: oldest first, with its place shown.
    await expect.soft(modal(page).getByText(/\b1\s*(of|de)\s*3\b/), 'the queue position is shown').toBeVisible()
    await expect.soft(modal(page).locator('pre').first()).toContainText('DROP TABLE orders;')
    // Critical: Deny (the default) has the focus, Allow waits 2 s and says so, Enter does nothing, on any button.
    const allowButton = modal(page).getByRole('button', { name: /Allow/ })
    const denyButton = modal(page).getByRole('button', { name: /^Deny$/ })
    await expect.soft(denyButton, 'the default (Deny) has the focus').toBeFocused()
    await expect.soft(allowButton, 'allow is not available at once at critical risk').toBeDisabled()
    await expect.soft(modal(page).getByTestId('approval-hold'), 'the wait is shown').toBeVisible()
    await page.waitForTimeout(ARMED)
    await denyButton.focus()
    await page.keyboard.press('Enter')
    await page.waitForTimeout(300)
    expect.soft(await pending(page), 'Enter on Deny answered nothing at critical').toContain('f18-critical')
    await expect.soft(allowButton, 'allow is available after 2 s').toBeEnabled({ timeout: 4_000 })
    await allowButton.focus()
    await page.keyboard.press('Enter')
    await page.waitForTimeout(300)
    expect.soft(await pending(page), 'Enter on Allow answered nothing at critical').toContain('f18-critical')
    await denyButton.click()

    // Next in the queue.
    await expect.soft(modal(page).getByText(/\b(2\s*(of|de)\s*3|1\s*(of|de)\s*2)\b/), 'the next, with the queue left').toBeVisible({ timeout: 5_000 })
    await page.waitForTimeout(ARMED)
    await denyButton.click()

    // A cut text: said so, and only Deny is offered.
    await expect.soft(modal(page).getByText(/cut|truncat|shortened|first 100|only part of it/i).first(), 'the cut is announced').toBeVisible({ timeout: 5_000 })
    expect.soft(await allowButton.count(), 'a cut text can only be denied').toBe(0)
    await page.waitForTimeout(ARMED)
    await denyButton.click()
    await expect(modal(page)).toHaveCount(0, { timeout: 5_000 })
    expect.soft(await pending(page), 'nothing left').toEqual([])

    // History of this session's decisions, in the app, from the command palette.
    await page.keyboard.press('Control+k')
    await page.keyboard.insertText('Approval history')
    await page.locator('[cmdk-item]', { hasText: /approval history/i }).first().click()
    const history = page.getByTestId('approval-history')
    await expect.soft(history, 'the history opens').toBeVisible({ timeout: 5_000 })
    await expect.soft(history.getByTestId('approval-history-row'), 'three decisions listed').toHaveCount(3)
    await expect.soft(history.getByText(/Denied/i), 'all three denied').toHaveCount(3)
    expect.soft(await app.evaluate(() => (globalThis as Record<string, unknown>).nativeAsked), 'no native dialog').toBe(0)
  } finally { delete process.env.OXESPACE_E2E_APPROVALS; await app.close() }
})

const ASKS = String.raw`
const [count, prefix, out, startAfter] = process.argv.slice(2)
const headers = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + process.env.OXESPACE_MCP_TOKEN, 'X-OXE-Workspace-Id': process.env.OXESPACE_WORKSPACE_ID,
  'X-OXE-Execution-Id': process.env.OXESPACE_EXECUTION_ID, 'X-OXE-Execution-Token': process.env.OXESPACE_EXECUTION_TOKEN }
;(async () => {
  await new Promise(resolve => setTimeout(resolve, Number(startAfter || 0)))
  const results = []
  for (let i = 0; i < Number(count); i++) {
    const body = { jsonrpc: '2.0', id: i, method: 'tools/call', params: { name: 'oxespace_skills_change', arguments: { action: 'create', name: 'acc-' + prefix + '-' + i, description: 'acceptance', body: 'never approved' } } }
    // Fired without waiting: a request that waits on the person must not hold the next one back.
    results.push(fetch('http://127.0.0.1:' + process.env.OXESPACE_MCP_PORT + '/rpc', { method: 'POST', headers, body: JSON.stringify(body), signal: AbortSignal.timeout(8000) })
      .then(r => r.json(), e => ({ error: e.name === 'TimeoutError' ? 'still waiting on the person' : e.message })).then(r => JSON.stringify(r).slice(0, 300)))
  }
  results.splice(0, results.length, ...(await Promise.all(results)))
  require('fs').writeFileSync(out, JSON.stringify(results))
})()
`

test('F18/#243 real app: past 50 a request is refused and logged; a closed pane withdraws its requests', async () => {
  test.setTimeout(240_000)
  const profile = realProfile('f18q', { OXESPACE_LOCALE: 'en-US' })
  const script = join(profile.root, 'asks.js'); writeFileSync(script, ASKS)
  const { app, page } = await launchReal(profile)
  try {
    // Never a system dialog on the runner's screen. The native fallback is replaced by a counter that never answers, as a
    // person who has not clicked yet: a request that falls back stays pending, so the queue limit is measured honestly.
    await app.evaluate(({ dialog }) => {
      const g = globalThis as Record<string, unknown>; g.nativeAsked = 0; g.nativeLog = []
      const note = (args: unknown[]) => {
        g.nativeAsked = (g.nativeAsked as number) + 1
        const options = args.find(a => !!a && typeof a === 'object' && 'message' in (a as object)) as { title?: string; message?: string } | undefined
        ;(g.nativeLog as string[]).push(`${Date.now()} ${options?.title ?? ''} | ${String(options?.message ?? '').slice(0, 80)}`)
      }
      dialog.showMessageBox = ((...args: unknown[]) => { note(args); return new Promise(() => undefined) }) as typeof dialog.showMessageBox
      dialog.showMessageBoxSync = ((...args: unknown[]) => { note(args); return 0 }) as typeof dialog.showMessageBoxSync
    })
    await page.getByTestId('btn-new-workspace').first().click()
    await page.getByTestId('wizard-dir-input').fill(profile.repo)
    await page.getByTestId('wizard-layout-card-2').click()
    await page.getByTestId('wizard-launch-btn').click()
    const panes = page.locator('[data-testid="pane-container"]')
    await expect(panes).toHaveCount(2, { timeout: 20_000 })
    // The approval modal stands over the whole app once the first request arrives, so both panes start their script
    // before any request: the second pane waits 10 s, then asks after the first pane's 25 are on screen.
    const start = async (index: number, count: number, prefix: string, startAfter: number) => {
      await panes.nth(index).locator('.xterm').click()
      await page.keyboard.type(`node "${script}" ${count} ${prefix} "${join(profile.root, `${prefix}.json`)}" ${startAfter}`); await page.keyboard.press('Enter')
    }
    const results = async (prefix: string) => {
      const out = join(profile.root, `${prefix}.json`)
      await expect.poll(() => existsSync(out), { timeout: 45_000 }).toBe(true)
      return JSON.parse(readFileSync(out, 'utf8')) as string[]
    }
    const secondPaneId = await panes.nth(1).getAttribute('data-pane-id')
    await start(1, 26, 'b', 10_000)
    await start(0, 25, 'a', 0)
    const native = () => app.evaluate(() => (globalThis as Record<string, unknown>).nativeAsked as number)
    const nativeLog = () => app.evaluate(() => (globalThis as Record<string, unknown>).nativeLog as string[])
    const timeline: string[] = []
    const mark = async (what: string) => { timeline.push(`${Date.now()} ${what}: native=${await native()} pending=${(await pending(page)).length} panes=${await panes.count()}`) }
    const a = await results('a')
    await mark('after a')
    const b = await results('b')
    await mark('after b')
    test.info().annotations.push({ type: 'answers', description: JSON.stringify({ a0: a[0], b25: b[25] }).slice(0, 500) })
    // Fired concurrently, so which of the 51 arrives last is not fixed: exactly one is refused, the other 50 wait.
    const all = [...a, ...b]
    const waiting = all.filter(r => /pending|Waiting for the person|still waiting/i.test(r))
    const refused = all.filter(r => /queue|full/i.test(r))
    expect.soft(waiting.length, 'fifty wait for the person').toBe(50)
    expect.soft(refused.length, 'one is refused: the queue is full').toBe(1)
    expect.soft((await pending(page)).length, 'fifty pending').toBe(50)
    await expect.soft(modal(page).getByText(/\b1\s*(of|de)\s*50\b/), 'the queue shows 50').toBeVisible({ timeout: 10_000 })
    const history = () => page.evaluate(() => (window as unknown as { oxe: { approvals: { history: () => Promise<Array<{ by: string; reason?: { code: string } }>> } } }).oxe.approvals.history())
    expect.soft((await history()).filter(h => h.by === 'refused' && /queueFull/.test(h.reason?.code ?? '')).length, 'the refusal is logged').toBe(1)

    // While the modal is up the pane's own menu is out of reach (the modal takes the pointer), so the second pane is
    // closed the way its menu does it: the app's own closePane. Its 25 requests are withdrawn, the first pane's stay.
    expect.soft(await panes.nth(1).getByRole('button', { name: /More pane actions|Mais ações do painel/ }).click({ timeout: 2_000 }).then(() => 'reached', () => 'blocked'),
      'the modal keeps the rest of the app out of reach').toBe('blocked')
    expect(secondPaneId).toBeTruthy()
    await mark('before close')
    const closed = await page.evaluate(`window.oxe.workspace.closePane(${JSON.stringify(secondPaneId)}).then(w => w && w.panes ? w.panes.map(p => p.id) : w, e => 'error: ' + e.message)`)
    test.info().annotations.push({ type: 'closePane', description: JSON.stringify(closed).slice(0, 300) })
    await page.waitForTimeout(3_000)
    await mark('after close')
    await expect.configure({ soft: true }).poll(async () => (await pending(page)).length, { timeout: 10_000, message: 'the closed pane\'s requests are withdrawn' }).toBe(25)
    expect.soft((await history()).filter(h => h.by === 'cancelled').length, 'each withdrawn request is logged as cancelled').toBe(25)
    await mark('end')
    const byCounts: Record<string, number> = {}
    for (const h of await history()) byCounts[h.by] = (byCounts[h.by] ?? 0) + 1
    console.log('F18-DIAG', JSON.stringify({ timeline, byCounts, native: (await nativeLog()).slice(0, 6), secondPaneId, closed }))
    expect.soft(await native(), 'no native dialog while the window is open').toBe(0)
  } finally { await quitReal(app) }
})
