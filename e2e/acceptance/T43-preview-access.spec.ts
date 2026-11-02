import { expect, test } from '@playwright/test'
import { createServer } from 'node:http'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { togglePanel } from '../helpers/panels'
import { launchReal, openRepo, quitReal, realProfile } from './real-app'

/**
 * T43 · #418 (G1/G6) · Main decides agent access to the preview. REAL app, black box: a local page in the workspace's
 * Browser panel, and an agent in the pane calling oxespace_preview_interact with the pane's own credentials.
 * - No access at first; the person grants it (toggle + consent) and the agent reads the page.
 * - The person turns it off: the agent is refused, and stays refused after the tab list changes (a new tab, back to the
 *   first): the window's re-sends no longer turn it back on.
 * - The window alone (setAccess without the person's grant) cannot turn it on.
 * - The agent's tab actions (tabs, newTab) need main's access too.
 * - Granting again lets the agent in.
 */
const CALL = String.raw`
const [out, args] = process.argv.slice(2)
const headers = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + process.env.OXESPACE_MCP_TOKEN, 'X-OXE-Workspace-Id': process.env.OXESPACE_WORKSPACE_ID,
  'X-OXE-Execution-Id': process.env.OXESPACE_EXECUTION_ID, 'X-OXE-Execution-Token': process.env.OXESPACE_EXECUTION_TOKEN }
const body = { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'oxespace_preview_interact', arguments: JSON.parse(require('fs').readFileSync(args, 'utf8')) } }
fetch('http://127.0.0.1:' + process.env.OXESPACE_MCP_PORT + '/rpc', { method: 'POST', headers, body: JSON.stringify(body), signal: AbortSignal.timeout(10000) })
  .then(r => r.text(), e => 'error: ' + e.message).then(t => require('fs').writeFileSync(out, t.slice(0, 700)))
`

test('T43 real app: the person grants and revokes; tab changes and the window alone never turn agent access back on', async () => {
  test.setTimeout(240_000)
  const server = createServer((_req, res) => { res.setHeader('Content-Type', 'text/html'); res.end('<!doctype html><html><body><h1>T43 guide page</h1><input id="name" value="PRIVATE"></body></html>') })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address(); const url = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}/`
  const profile = realProfile('t43', { OXESPACE_LOCALE: 'en-US' })
  const script = join(profile.root, 'call.js'); writeFileSync(script, CALL)
  const { app, page } = await launchReal(profile)
  let n = 0
  const agent = async (args: Record<string, unknown>) => {
    const out = join(profile.root, `out-${++n}.txt`), file = join(profile.root, `args-${n}.json`); writeFileSync(file, JSON.stringify(args))
    await page.locator('[data-testid="pane-container"] .xterm').first().click()
    await page.keyboard.type(`node "${script}" "${out}" "${file}"`); await page.keyboard.press('Enter')
    await expect.poll(() => existsSync(out), { timeout: 25_000 }).toBe(true)
    return readFileSync(out, 'utf8')
  }
  const refused = (r: string) => /isError":true|enable Agent documentation access|access/i.test(r) && !/T43 guide page/.test(r)
  const log: Record<string, string> = {}
  try {
    await app.evaluate(({ dialog }) => {
      dialog.showMessageBox = (() => new Promise(() => undefined)) as typeof dialog.showMessageBox
      dialog.showMessageBoxSync = (() => 0) as typeof dialog.showMessageBoxSync
    })
    await openRepo(page, profile.repo)
    await togglePanel(page, 'Browser')
    await page.locator('.web-preview-address-input').fill(url); await page.locator('.web-preview-address-input').press('Enter')
    await expect(page.getByTestId('browser-preview-native')).toBeVisible({ timeout: 15_000 })
    await page.waitForTimeout(1_500)

    log.before = await agent({ action: 'inspect' })
    expect.soft(refused(log.before), `no access before the grant → ${log.before}`).toBe(true)

    const toggle = page.getByLabel('Agent documentation access')
    await toggle.click(); await page.getByRole('button', { name: 'Allow access' }).click()
    await page.waitForTimeout(800)
    log.granted = await agent({ action: 'inspect' })
    expect.soft(log.granted, 'after the grant the agent reads the page').toContain('T43 guide page')
    expect.soft(log.granted, '… with the input masked').not.toContain('PRIVATE')

    // The person turns it off.
    await toggle.uncheck(); await page.waitForTimeout(800)
    log.revoked = await agent({ action: 'inspect' })
    expect.soft(refused(log.revoked), `refused after the revoke → ${log.revoked}`).toBe(true)
    log.tabsRevoked = await agent({ action: 'tabs' })
    expect.soft(refused(log.tabsRevoked), `tab actions need access too → ${log.tabsRevoked}`).toBe(true)
    log.newTabRevoked = await agent({ action: 'newTab', url })
    expect.soft(refused(log.newTabRevoked), `newTab refused too → ${log.newTabRevoked}`).toBe(true)

    // The tab list changes in the window: a new tab, then back to the first one.
    await page.locator('.web-preview-new-tab').first().click()
    await page.waitForTimeout(800)
    await page.locator('.web-preview-address-input').fill(url); await page.locator('.web-preview-address-input').press('Enter')
    await page.waitForTimeout(1_200)
    await page.locator('.web-preview-tabs').locator('button[aria-current], button').first().click().catch(() => undefined)
    await page.waitForTimeout(1_200)
    log.afterTabs = await agent({ action: 'inspect' })
    expect.soft(refused(log.afterTabs), `still refused after the tab changes → ${log.afterTabs}`).toBe(true)
    log.toggleAfterTabs = String(await toggle.isChecked().catch(() => 'n/a'))
    expect.soft(log.toggleAfterTabs, 'the toggle shows off').toBe('false')

    // The window alone: setAccess on, without the person's grant, for every tab the panel knows.
    const owner = await page.locator('.web-preview-panel').getAttribute('data-browser-owner')
    const tabIds = await page.locator('[data-tab-id]').evaluateAll(list => list.map(e => e.getAttribute('data-tab-id')).filter(Boolean))
    log.windowAlone = JSON.stringify(await page.evaluate(`Promise.all(${JSON.stringify(tabIds.length ? tabIds : ['tab-1'])}.map(tabId => window.oxe.browserPreview.setAccess({ ownerKey: ${JSON.stringify(owner)}, tabId, agentAccess: true, allowExternal: false }).then(r => r, e => ({ error: String(e && e.message) }))))`))
    log.afterWindowAlone = await agent({ action: 'inspect' })
    expect.soft(refused(log.afterWindowAlone), `the window alone cannot grant → ${log.afterWindowAlone}`).toBe(true)

    // The person grants again.
    await toggle.click(); await page.getByRole('button', { name: 'Allow access' }).click()
    await page.waitForTimeout(800)
    log.regranted = await agent({ action: 'inspect' })
    expect.soft(log.regranted, 'granting again lets the agent in').toContain('T43 guide page')
  } finally {
    console.log('T43', JSON.stringify(Object.fromEntries(Object.entries(log).map(([k, v]) => [k, v.slice(0, 260)]))))
    await quitReal(app); server.close()
  }
})
