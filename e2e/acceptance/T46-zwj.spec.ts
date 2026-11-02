import { expect, test, type Page } from '@playwright/test'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { launchApp, resizeWindow } from '../helpers/launch'
import { launchReal, openRepo, quitReal, realProfile } from './real-app'

/**
 * T46 · #436 · A zero-width joiner (U+200D) is left unmarked only inside a recommended emoji sequence.
 * - The approval modal (B10 e2e double): 👩‍💻, 👨‍👩‍👧 and 🏳️‍🌈 show no marker; 🔥‍🔥, ©‍®, a ZWJ inside DROP‍TABLE, at the
 *   start and at the end each show ⟨U+200D⟩, also when a real emoji sequence sits in the same text.
 * - Reserved names (REAL app, an agent's notify from the pane): a ZWJ cannot sneak an app name past the check
 *   ("Win‍dows Security", "OXE‍Space"), and an emoji sequence in an ordinary title still goes out.
 */
const Z = '‍'
const CASES: Array<{ id: string; text: string; marks: number }> = [
  { id: 'tech', text: `deploy by 👩${Z}💻 done`, marks: 0 },
  { id: 'family', text: `the 👨${Z}👩${Z}👧 photos`, marks: 0 },
  { id: 'flag', text: `pride 🏳️${Z}🌈 banner`, marks: 0 },
  { id: 'fire', text: `🔥${Z}🔥 hot`, marks: 1 },
  { id: 'copy', text: `©${Z}® notice`, marks: 1 },
  { id: 'drop', text: `👩${Z}💻 says DROP${Z}TABLE orders`, marks: 1 },
  { id: 'edges', text: `${Z}start and end${Z}`, marks: 2 }
]
const msg = (code: string, params: Record<string, unknown> = {}) => ({ code, params })
const deny = { id: 'deny', label: msg('approvals.option.deny'), intent: 'deny' }
const pane = { kind: 'agent', id: 'pane:p2', label: msg('approvals.requester.pane', { agent: 'Claude', pane: 2 }) }
const pending = (page: Page) => page.evaluate(() => (window as unknown as { oxe: { approvals: { list: () => Promise<Array<{ id: string }>> } } }).oxe.approvals.list().then(l => l.map(r => r.id)))

test('T46 approval modal: a ZWJ is unmarked only inside a recommended emoji sequence', async () => {
  test.setTimeout(150_000)
  const now = Date.now()
  process.env.OXESPACE_E2E_APPROVALS = JSON.stringify(CASES.map((c, i) => ({
    schemaVersion: 1, id: `t46-${c.id}`, generation: 1, ackRequired: false, createdAt: now + i, expiresAt: now + 300_000, defaultOptionId: 'deny', kind: 'action',
    requester: pane, risk: 'low', allowDelayMs: 0, enterDisabled: false, title: msg('approvals.title.agent'), summary: msg('approvals.summary.mcpConfirm', { tool: 't', action: 'a', target: 'x' }),
    appNotes: [], agentText: { text: c.text, untrusted: true, length: [...c.text].length, truncated: false }, options: [deny]
  })))
  const { app, page } = await launchApp({ locale: 'en-US' })
  const seen: Record<string, number> = {}
  try {
    await resizeWindow(app, 1280, 860)
    const modal = page.getByTestId('approval-dialog')
    for (let i = 0; i < CASES.length; i++) {
      await expect(modal).toBeVisible({ timeout: 15_000 })
      await page.waitForTimeout(300)

      const id = (await pending(page))[0]
      const markers = await modal.locator('pre [data-hidden-char]').evaluateAll(list => list.map(e => e.getAttribute('data-hidden-char')))
      seen[id] = markers.length
      const expected = CASES.find(x => `t46-${x.id}` === id)
      expect.soft(markers.length, `${id}: ${JSON.stringify(expected?.text)} → ${JSON.stringify(markers)}`).toBe(expected?.marks ?? -1)
      if (markers.length) expect.soft(markers.every(m => /200D/i.test(m ?? '')), `${id}: the marker names U+200D`).toBe(true)
      await page.waitForTimeout(600)
      await modal.getByRole('button', { name: /^Deny$/ }).click()
      await page.waitForTimeout(400)
    }
  } finally {
    console.log('T46-MODAL', JSON.stringify(seen))
    delete process.env.OXESPACE_E2E_APPROVALS; await app.close()
  }
})

const ASKS = String.raw`
const [out, list] = process.argv.slice(2)
const headers = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + process.env.OXESPACE_MCP_TOKEN, 'X-OXE-Workspace-Id': process.env.OXESPACE_WORKSPACE_ID,
  'X-OXE-Execution-Id': process.env.OXESPACE_EXECUTION_ID, 'X-OXE-Execution-Token': process.env.OXESPACE_EXECUTION_TOKEN }
;(async () => {
  const items = JSON.parse(require('fs').readFileSync(list, 'utf8')); const results = {}; let id = 0
  for (const item of items) {
    const body = { jsonrpc: '2.0', id: id++, method: 'tools/call', params: { name: 'oxespace_workspace_change', arguments: { action: 'notify', title: item.title } } }
    results[item.key] = await fetch('http://127.0.0.1:' + process.env.OXESPACE_MCP_PORT + '/rpc', { method: 'POST', headers, body: JSON.stringify(body) }).then(r => r.text(), e => 'error: ' + e.message)
  }
  require('fs').writeFileSync(out, JSON.stringify(results))
})()
`

test('T46 reserved names: a ZWJ does not hide an app name, and an emoji title still goes out', async () => {
  test.setTimeout(150_000)
  const profile = realProfile('t46', { OXESPACE_LOCALE: 'en-US' })
  const script = join(profile.root, 'asks.js'); writeFileSync(script, ASKS)
  const list = join(profile.root, 'list.json'), out = join(profile.root, 'out.json')
  const items = [
    { key: 'ok-tech', title: `👩${Z}💻 Build finished` },
    { key: 'ok-fire', title: `🔥${Z}🔥 tests passed` },
    { key: 'no-windows', title: `Win${Z}dows Security` },
    { key: 'no-oxespace', title: `OXE${Z}Space update` },
    { key: 'no-system', title: `${Z}System Administrator` }
  ]
  writeFileSync(list, JSON.stringify(items))
  const { app, page } = await launchReal(profile)
  try {
    await app.evaluate(({ dialog }) => {
      dialog.showMessageBox = (() => new Promise(() => undefined)) as typeof dialog.showMessageBox
      dialog.showMessageBoxSync = (() => 0) as typeof dialog.showMessageBoxSync
    })
    await openRepo(page, profile.repo)
    await page.locator('[data-testid="pane-container"] .xterm').first().click()
    await page.keyboard.type(`node "${script}" "${out}" "${list}"`); await page.keyboard.press('Enter')
    await expect.poll(() => existsSync(out), { timeout: 40_000 }).toBe(true)
    const results = JSON.parse(readFileSync(out, 'utf8')) as Record<string, string>
    console.log('T46-NAMES', JSON.stringify(Object.fromEntries(Object.entries(results).map(([k, v]) => [k, v.slice(0, 220)]))))
    const refused = (r: string) => /reserved-name|belongs to the app/.test(r)
    expect.soft(refused(results['ok-tech']), 'an emoji sequence title goes out').toBe(false)
    expect.soft(refused(results['ok-fire']), 'a ZWJ between emoji is not an app name').toBe(false)
    for (const key of ['no-windows', 'no-oxespace', 'no-system']) expect.soft(refused(results[key]), `${key} refused → ${results[key]}`).toBe(true)
  } finally { await quitReal(app) }
})
