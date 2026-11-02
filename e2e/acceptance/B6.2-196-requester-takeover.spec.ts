import { expect, test, type Page } from '@playwright/test'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { launchReal, quitReal, realProfile } from './real-app'

/**
 * B6.2 · #196 · A live requester cannot be taken over. REAL app, black box: two panes of one workspace, each calling the
 * internal MCP with its own execution credentials. Pane A delegates a task (oxespace_delegate_task); pane B, a live
 * session of the same checkout, tries oxespace_delegation_control cancel/approve/retry on A's task and is refused
 * (delegation.requester.live) while A runs; A's task is unchanged and A still controls it.
 * CI only: no agent CLI is installed there, so the delegated worker can't start (no paid run); the task record is enough.
 */
const CALL = String.raw`
const [out, tool, args] = process.argv.slice(2)
const headers = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + process.env.OXESPACE_MCP_TOKEN, 'X-OXE-Workspace-Id': process.env.OXESPACE_WORKSPACE_ID,
  'X-OXE-Execution-Id': process.env.OXESPACE_EXECUTION_ID, 'X-OXE-Execution-Token': process.env.OXESPACE_EXECUTION_TOKEN }
const body = { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: tool, arguments: JSON.parse(require('fs').readFileSync(args, 'utf8')) } }
fetch('http://127.0.0.1:' + process.env.OXESPACE_MCP_PORT + '/rpc', { method: 'POST', headers, body: JSON.stringify(body), signal: AbortSignal.timeout(25000) })
  .then(r => r.text(), e => 'error: ' + e.message).then(t => require('fs').writeFileSync(out, t.slice(0, 1500)))
`
const oxe = <T>(page: Page, expression: string) => page.evaluate(expression) as Promise<T>

test('B6.2/#196: another live pane cannot take over a delegation; the requester still controls it', async () => {
  test.skip(process.env.GITHUB_ACTIONS !== 'true', 'CI only: no agent CLI may start a worker here')
  test.setTimeout(240_000)
  const profile = realProfile('b62', { OXESPACE_LOCALE: 'en-US' })
  const script = join(profile.root, 'call.js'); writeFileSync(script, CALL)
  const { app, page } = await launchReal(profile)
  const out: Record<string, unknown> = {}
  let n = 0
  const panes = page.locator('[data-testid="pane-container"]')
  const call = async (pane: number, tool: string, args: Record<string, unknown>) => {
    const file = join(profile.root, `a-${++n}.json`), res = join(profile.root, `r-${n}.txt`); writeFileSync(file, JSON.stringify(args))
    await panes.nth(pane).locator('.xterm').click()
    await page.keyboard.type(`node "${script}" "${res}" ${tool} "${file}"`); await page.keyboard.press('Enter')
    await expect.poll(() => existsSync(res), { timeout: 40_000 }).toBe(true)
    return readFileSync(res, 'utf8')
  }
  // Approvals the delegation raises (confirm level) are allowed for pane A's own create and answered after each call.
  const allowAll = () => oxe(page, `window.oxe.approvals.list().then(l => Promise.all(l.map(r => window.oxe.approvals.ack({ id: r.id, generation: r.generation, visible: true, focused: true })
    .then(() => new Promise(res => setTimeout(res, 2200))).then(() => window.oxe.approvals.respond({ id: r.id, generation: r.generation, optionId: (r.options.find(o => o.intent === 'allow') || r.options[0]).id })).catch(() => null))))`)
  try {
    await app.evaluate(({ dialog }) => {
      dialog.showMessageBox = (() => new Promise(() => undefined)) as typeof dialog.showMessageBox
      dialog.showMessageBoxSync = (() => 0) as typeof dialog.showMessageBoxSync
    })
    await page.getByTestId('btn-new-workspace').first().click()
    await page.getByTestId('wizard-dir-input').fill(profile.repo)
    await page.getByTestId('wizard-layout-card-2').click()
    await page.getByTestId('wizard-launch-btn').click()
    await expect(panes).toHaveCount(2, { timeout: 20_000 })
    await page.waitForTimeout(2_000)
    const profiles = await oxe<Array<{ agentProfileId: string; provider: string; isBuiltin: boolean }>>(page, 'window.oxe.agent.list()')
    const agentProfileId = (profiles.find(p => p.provider === 'claude' && p.isBuiltin) ?? profiles[0])?.agentProfileId
    out.profiles = profiles.map(p => `${p.provider}:${p.isBuiltin}`)
    expect(agentProfileId, 'an agent profile exists').toBeTruthy()

    // Pane A delegates. The call may wait on the person's approval: answer it while it waits.
    const created = call(0, 'oxespace_delegate_task', { key: 'hml-b62', agentProfileId, objective: 'HML takeover check', handoff: 'Nothing to do; this task only exists to be controlled.', acceptance: 'None.', schemaVersion: 2, surface: 'terminal', mode: 'analysis', branchIntent: { strategy: 'generated' } })
    for (let i = 0; i < 6; i++) { await page.waitForTimeout(2_500); await allowAll() }
    out.create = await created
    const taskId = /"taskId\\?":\\?"([^"\\]+)/.exec(String(out.create))?.[1] ?? /"id\\?":\\?"([^"\\]+)/.exec(String(out.create))?.[1]
    out.taskId = taskId
    expect(taskId, `pane A's task was created → ${String(out.create).slice(0, 400)}`).toBeTruthy()
    out.statusBefore = await call(0, 'oxespace_delegation_status', { taskId })

    // Pane B, live, tries to act on A's task.
    for (const action of ['cancel', 'approve', 'retry'] as const) {
      const r = await call(1, 'oxespace_delegation_control', { taskId, action })
      out[`b-${action}`] = r.slice(0, 400)
      expect.soft(r, `pane B ${action} is refused`).toMatch(/isError":true|delegation\.requester\.live|Only the origin/)
    }
    out.statusAfter = await call(0, 'oxespace_delegation_status', { taskId })
    expect.soft(String(out.statusAfter), 'A\'s task is not cancelled by B').not.toMatch(/"state\\?":\\?"cancel/)

    // A itself still controls it.
    const aCancel = call(0, 'oxespace_delegation_control', { taskId, action: 'cancel' })
    for (let i = 0; i < 3; i++) { await page.waitForTimeout(2_500); await allowAll() }
    out.aCancel = (await aCancel).slice(0, 400)
    expect.soft(String(out.aCancel), 'the requester can still cancel').not.toMatch(/delegation\.requester\.live|Only the origin/)
  } finally {
    console.log('B62', JSON.stringify(out).slice(0, 5000))
    await quitReal(app)
  }
})
