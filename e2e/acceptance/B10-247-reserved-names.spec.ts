import { expect, test } from '@playwright/test'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { launchReal, openRepo, quitReal, realProfile } from './real-app'

/**
 * B10 · #247 (S1) · An agent cannot speak as the system or the app in a desktop notification: OS, vendor, admin and app
 * names, spelled out, split, accented or with look-alike letters, are refused with `reserved-name`; ordinary titles go
 * out. REAL app, black box: a script in the pane calls the internal MCP with the pane's own execution credentials, as an
 * agent in that pane would (oxespace_workspace_change notify, a write-level tool, so no approval is raised).
 * The allowed titles stay under NOTIFY_PER_MINUTE (6); refusals are not counted.
 */
const REFUSED = [
  'Windows Security', 'W i n-d.o w s', 'Micro soft update', 'Git Hub alert', 'GNOME Keyring', 'polkit authentication', 'KDE Wallet',
  'Ubuntu', 'macOS Update', 'System Administrator', 'Sistema operacional', 'Administração do sistema', 'Administrador', 'Aplicação',
  'root access', 'sudo password', 'Security scanner', 'Segurança', '$ystem Admin', 'W1ndows Update', 'Sys tem notice', 'Ad min panel',
  'OXESp4ce', 'OXESpace', 'OxeBot', 'OX E', 'Oxente OXESpace'
]
const ALLOWED = ['Build finished', 'Linuxbrew updated', 'Oxente, the tests passed', 'Code reviewer done']

const ASKS = String.raw`
const [out, list] = process.argv.slice(2)
const headers = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + process.env.OXESPACE_MCP_TOKEN, 'X-OXE-Workspace-Id': process.env.OXESPACE_WORKSPACE_ID,
  'X-OXE-Execution-Id': process.env.OXESPACE_EXECUTION_ID, 'X-OXE-Execution-Token': process.env.OXESPACE_EXECUTION_TOKEN }
;(async () => {
  const items = JSON.parse(require('fs').readFileSync(list, 'utf8'))
  const results = {}
  let id = 0
  for (const item of items) {
    const body = { jsonrpc: '2.0', id: id++, method: 'tools/call', params: { name: 'oxespace_workspace_change', arguments: { action: 'notify', title: item.title, body: item.body || '' } } }
    const answer = await fetch('http://127.0.0.1:' + process.env.OXESPACE_MCP_PORT + '/rpc', { method: 'POST', headers, body: JSON.stringify(body) }).then(r => r.json(), e => ({ error: e.message }))
    results[item.key] = JSON.stringify(answer).slice(0, 400)
  }
  require('fs').writeFileSync(out, JSON.stringify(results))
})()
`

test('B10/#247 real app: a notification cannot use OS, vendor, admin or app names; ordinary titles go out', async () => {
  test.setTimeout(180_000)
  const profile = realProfile('b10names', { OXESPACE_LOCALE: 'en-US' })
  const script = join(profile.root, 'asks.js'); writeFileSync(script, ASKS)
  const list = join(profile.root, 'list.json')
  const items = [
    ...REFUSED.map(title => ({ key: `title:${title}`, title })),
    // A notice may not speak as the system anywhere in its text, the body included.
    { key: 'body:Windows Security', title: 'Heads up', body: 'Windows Security needs your password again' },
    ...ALLOWED.map(title => ({ key: `title:${title}`, title }))
  ]
  writeFileSync(list, JSON.stringify(items))
  const out = join(profile.root, 'out.json')
  const { app, page } = await launchReal(profile)
  try {
    await app.evaluate(({ dialog }) => { dialog.showMessageBox = (() => new Promise(() => undefined)) as typeof dialog.showMessageBox; dialog.showMessageBoxSync = (() => 0) as typeof dialog.showMessageBoxSync })
    await openRepo(page, profile.repo)
    await page.locator('[data-testid="pane-container"] .xterm').first().click()
    await page.keyboard.type(`node "${script}" "${out}" "${list}"`); await page.keyboard.press('Enter')
    await expect.poll(() => existsSync(out), { timeout: 60_000 }).toBe(true)
    const results = JSON.parse(readFileSync(out, 'utf8')) as Record<string, string>
    console.log('B10-NAMES', JSON.stringify(results).slice(0, 4000))
    const refusedOk = (r: string) => /reserved-name|belongs to the app|cannot use the name/i.test(r)
    for (const title of REFUSED) expect.soft(refusedOk(results[`title:${title}`] ?? ''), `refused: "${title}" → ${results[`title:${title}`]}`).toBe(true)
    expect.soft(refusedOk(results['body:Windows Security'] ?? ''), `refused in the body → ${results['body:Windows Security']}`).toBe(true)
    for (const title of ALLOWED) {
      const r = results[`title:${title}`] ?? ''
      expect.soft(!refusedOk(r) && !/isError":true|"error"/.test(r), `allowed: "${title}" → ${r}`).toBe(true)
    }
  } finally { await quitReal(app) }
})
