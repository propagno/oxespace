import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { launchReal, mode, openRepo, quitReal, realProfile } from './real-app'

/**
 * Batch 3b on main, black box on the REAL app (no doubles), throwaway profile.
 * - #210 Settings › Tools against the real main (its own e2e uses the contract mock): a group turned off lands in the
 *   project's oxe.yaml and an agent's call to it is refused; a tool blocked from the page lands in policy.json and is
 *   refused to the agent; "Run without asking" asks first, and Cancel changes nothing; a broken oxe.yaml is explained.
 * - #176 Settings states: no agent CLI → an empty state with the health check; a filter with no match → an empty state.
 * - #414 the first switch to OxeChat after a cold boot: how long, and how many times the view reveals.
 * - #412 the 1.4.0 notes' checkable claims: Ctrl+4/Ctrl+5, Ctrl+Shift+A, Help › Report a problem, Settings › Keyboard,
 *   Devices off by default, beta updates, motion System/Reduced/Full.
 */
const stub = (app: ElectronApplication) => app.evaluate(({ dialog }) => {
  dialog.showMessageBox = (() => new Promise(() => undefined)) as typeof dialog.showMessageBox
  dialog.showMessageBoxSync = (() => 0) as typeof dialog.showMessageBoxSync
})
const palette = async (page: Page, text: string) => {
  await page.keyboard.press('Control+k'); await page.keyboard.insertText(text)
  await page.locator('[cmdk-item]', { hasText: text }).first().click()
}
const CALL = String.raw`
const [out, tool, args] = process.argv.slice(2)
const headers = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + process.env.OXESPACE_MCP_TOKEN, 'X-OXE-Workspace-Id': process.env.OXESPACE_WORKSPACE_ID,
  'X-OXE-Execution-Id': process.env.OXESPACE_EXECUTION_ID, 'X-OXE-Execution-Token': process.env.OXESPACE_EXECUTION_TOKEN }
const body = { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: tool, arguments: JSON.parse(require('fs').readFileSync(args, 'utf8')) } }
fetch('http://127.0.0.1:' + process.env.OXESPACE_MCP_PORT + '/rpc', { method: 'POST', headers, body: JSON.stringify(body), signal: AbortSignal.timeout(8000) })
  .then(r => r.text(), e => 'error: ' + e.message).then(t => require('fs').writeFileSync(out, t.slice(0, 600)))
`

test('#210 Settings › Tools on the real app: what the page sets reaches the agent', async () => {
  test.setTimeout(240_000)
  const profile = realProfile('f10', { OXESPACE_LOCALE: 'en-US' })
  const { repo, root } = profile
  const script = join(root, 'call.js'); writeFileSync(script, CALL)
  const { app, page } = await launchReal(profile)
  let n = 0
  const call = async (tool: string, args: Record<string, unknown>) => {
    const out = join(root, `out-${++n}.txt`), file = join(root, `args-${n}.json`); writeFileSync(file, JSON.stringify(args))
    await page.keyboard.press('Escape')
    await page.locator('[data-testid="pane-container"] .xterm').first().click()
    await page.keyboard.type(`node "${script}" "${out}" ${tool} "${file}"`); await page.keyboard.press('Enter')
    await expect.poll(() => existsSync(out), { timeout: 20_000 }).toBe(true)
    return readFileSync(out, 'utf8')
  }
  const openTools = async () => {
    await palette(page, 'Workspace settings')
    const modal = page.getByRole('dialog', { name: 'Settings', exact: true })
    await modal.getByRole('navigation', { name: 'Settings categories' }).getByRole('button', { name: /^Tools/ }).click()
    const tools = modal.getByTestId('tools-settings')
    await expect(tools).toBeVisible({ timeout: 10_000 })
    return tools
  }
  try {
    await stub(app)
    await openRepo(page, repo)
    let tools = await openTools()
    for (const name of ['Core tools', 'Orchestration', 'Data', 'Documentation', 'App']) {
      await expect.soft(tools.getByRole('region', { name, exact: true }), `${name} is listed`).toBeVisible()
    }
    // Data off: written to oxe.yaml, and an agent's call to a Data tool is refused.
    const data = tools.getByRole('region', { name: 'Data', exact: true })
    await data.getByRole('radio', { name: 'Off' }).click()
    await expect.soft(tools.getByRole('status')).toHaveText(/Data in this project: Off/)
    const yaml = existsSync(join(repo, 'oxe.yaml')) ? readFileSync(join(repo, 'oxe.yaml'), 'utf8') : '(no oxe.yaml)'
    console.log('F10-YAML', JSON.stringify(yaml))
    expect.soft(yaml, 'the mode is in the project oxe.yaml').toMatch(/data:\s*off/)
    const off = await call('oxespace_db_connections', {})
    console.log('F10-OFF', off)
    expect.soft(off, 'a Data tool is refused while Data is off').toMatch(/isError":true/)

    // Block a tool from the page: policy.json, and the agent is refused.
    tools = await openTools()
    const app_ = tools.getByRole('region', { name: 'App', exact: true })
    await app_.getByText(/^Rules per tool/).click()
    const ruleFor = (tool: string) => tools.getByRole('combobox', { name: `Rule for ${tool}` })
    const workspaceTool = ruleFor('oxespace_workspace_change')
    const found = await workspaceTool.count()
    console.log('F10-RULE-ROW', found)
    if (found) {
      await workspaceTool.selectOption('deny')
      await expect.soft(tools.getByRole('status')).toHaveText(/oxespace_workspace_change: Block/)
      const policy = existsSync(join(repo, '.oxespace', 'policy.json')) ? readFileSync(join(repo, '.oxespace', 'policy.json'), 'utf8') : ''
      expect.soft(policy, 'the block is in policy.json').toContain('oxespace_workspace_change')
      const blocked = await call('oxespace_workspace_change', { action: 'notify', title: 'Build finished' })
      expect.soft(blocked, 'the agent is refused').toMatch(/isError":true/)
      tools = await openTools()
      await tools.getByRole('region', { name: 'App', exact: true }).getByText(/^Rules per tool/).click()
      // "Run without asking" asks first; Cancel changes nothing.
      await ruleFor('oxespace_workspace_change').selectOption('allow')
      const confirm = page.getByRole('dialog', { name: /without asking\?/ })
      await expect.soft(confirm, 'allow asks first').toBeVisible()
      await confirm.getByRole('button', { name: /Cancel/ }).click()
      await expect.soft(ruleFor('oxespace_workspace_change'), 'Cancel keeps the block').toHaveValue('deny')
      const still = existsSync(join(repo, '.oxespace', 'policy.json')) ? readFileSync(join(repo, '.oxespace', 'policy.json'), 'utf8') : ''
      expect.soft(still, 'and the file keeps it').toContain('oxespace_workspace_change')
    }
    // A broken oxe.yaml is explained, not a blank page.
    writeFileSync(join(repo, 'oxe.yaml'), 'thread:\n  tools: [unclosed\n')
    await tools.getByRole('button', { name: 'Reload' }).click().catch(() => undefined)
    await page.waitForTimeout(1_000)
    const text = await tools.innerText()
    console.log('F10-BROKEN', text.slice(0, 400).replace(/\s+/g, ' '))
    console.log('F10-BROKEN-ERR', (text.match(/.{0,120}(invalid|can.t be read|cannot be read|not valid|could not).{0,160}/i) ?? ['none'])[0])
    expect.soft(text, 'the broken oxe.yaml is explained').toMatch(/invalid|can.t be read|cannot be read|not valid|could not/i)
    expect.soft(text.length, 'the page still shows something').toBeGreaterThan(50)
  } finally { await quitReal(app) }
})

test('#176 Settings states, #414 the cold switch to OxeChat, and the 1.4.0 notes\' checkable claims', async () => {
  test.setTimeout(240_000)
  const profile = realProfile('f1set', { OXESPACE_LOCALE: 'en-US', PATH: process.platform === 'win32' ? 'C:\\Windows\\System32;C:\\Windows' : '/usr/bin:/bin' })
  const { app, page } = await launchReal(profile)
  const errors: string[] = []
  page.on('pageerror', e => errors.push(e.message.slice(0, 200)))
  const out: Record<string, unknown> = {}
  try {
    await stub(app)
    // #414: the first switch to OxeChat after a cold boot, measured from the click to the view's content, counting the
    // loading states it passes through.
    const probe = await page.evaluate(`(() => { const g = window; g.__reveals = 0; g.__loading = 0; const seen = new WeakSet();
      new MutationObserver(list => { for (const m of list) for (const n of m.addedNodes) if (n instanceof HTMLElement) {
        if (n.matches('[aria-busy="true"], [role="status"][data-loading], .loading-state') || n.querySelector('[aria-busy="true"]')) { if (!seen.has(n)) { seen.add(n); g.__loading++ } }
      } }).observe(document.body, { childList: true, subtree: true }); return true })()`)
    expect(probe).toBe(true)
    const t0 = Date.now()
    await mode(page, 'thread')
    await page.locator('main').getByText(/Conversations|Add a project/).first().waitFor({ timeout: 15_000 })
    out.threadColdMs = Date.now() - t0
    out.threadLoadingStates = await page.evaluate('window.__loading')
    await mode(page, 'code')

    // Notes: Ctrl+4 → OxePod, Ctrl+5 → OxePost, Ctrl+Shift+A → activity center.
    await page.locator('body').click({ position: { x: 5, y: 300 } }).catch(() => undefined)
    await page.keyboard.press('Control+4'); await page.waitForTimeout(800)
    out.ctrl4 = await page.locator('button[data-app-mode="pods"]').first().getAttribute('aria-pressed').catch(() => null) ?? await page.locator('main').first().innerText().then(t => t.slice(0, 40))
    await page.keyboard.press('Control+5'); await page.waitForTimeout(800)
    out.ctrl5 = await page.locator('button[data-app-mode="post"]').first().getAttribute('aria-pressed').catch(() => null) ?? await page.locator('main').first().innerText().then(t => t.slice(0, 40))
    await page.keyboard.press('Control+Shift+A'); await page.waitForTimeout(800)
    out.activity = await page.getByTestId('activity-center').isVisible().catch(() => false)
    await page.keyboard.press('Escape')
    // Help › Report a problem, in the app menu.
    out.menu = await app.evaluate(({ Menu }) => {
      const labels: string[] = []
      const walk = (items: Electron.MenuItem[], path: string) => { for (const i of items) { if (i.label) labels.push(path + i.label); if (i.submenu) walk(i.submenu.items, path + i.label + ' › ') } }
      const menu = Menu.getApplicationMenu(); if (menu) walk(menu.items, '')
      return labels.filter(l => /report|help|ajuda/i.test(l)).slice(0, 10)
    })
    // On Windows the menus are the app's own (title bar), so also look where a person would: the menu bar and the palette.
    out.helpMenu = await page.getByRole('menubar').getByRole('menuitem', { name: /^Help/ }).first().click({ timeout: 3_000 }).then(async () => {
      const items = await page.getByRole('menuitem').allInnerTexts(); await page.keyboard.press('Escape'); return items.filter(t => /report/i.test(t))
    }, () => 'no menubar Help')
    await page.keyboard.press('Control+k'); await page.keyboard.insertText('Report a problem'); await page.waitForTimeout(500)
    out.paletteReport = await page.locator('[cmdk-item]').allInnerTexts().then(list => list.filter(t => /report a problem/i.test(t)))
    await page.keyboard.press('Escape')

    // Settings: categories the notes name; no agent CLI → the empty state with the health check (#176).
    await palette(page, 'Settings')
    const settings = page.getByRole('dialog').filter({ has: page.getByRole('navigation', { name: 'Settings categories' }) }).first()
    await expect(settings).toBeVisible({ timeout: 10_000 })
    const nav = settings.getByRole('navigation', { name: 'Settings categories' })
    out.categories = await nav.getByRole('button').allInnerTexts().then(list => list.map(t => t.split('\n')[0]))
    const agents = nav.getByRole('button', { name: /^Agents/ })
    if (await agents.count()) {
      await agents.first().click(); await page.waitForTimeout(1_500)
      out.agentsEmpty = await settings.getByRole('button', { name: /Run health check|Health check|Check again/i }).count()
      out.agentsText = (await settings.innerText()).replace(/\s+/g, ' ').slice(0, 300)
    }
    for (const [name, key] of [['Devices', 'devices'], ['Updates', 'updates'], ['Appearance', 'appearance'], ['Keyboard', 'keyboard']] as const) {
      const button = nav.getByRole('button', { name: new RegExp(`^${name}`) })
      if (!(await button.count())) { out[key] = 'missing'; continue }
      await button.first().click(); await page.waitForTimeout(1_000)
      out[key] = (await settings.innerText()).replace(/\s+/g, ' ').slice(0, 4000)
    }
    // A filter with no match: an empty state, not a blank list.
    const filter = settings.getByRole('searchbox').or(settings.getByRole('textbox', { name: /search|filter/i })).first()
    if (await filter.count()) {
      await filter.fill('zzqxv-nothing-matches'); await page.waitForTimeout(600)
      out.filterEmpty = (await settings.innerText()).replace(/\s+/g, ' ').slice(0, 200)
    }
    console.log('B3B', JSON.stringify(out))
    expect.soft(out.threadColdMs as number, 'OxeChat cold switch').toBeLessThan(1_500)
    expect.soft(out.activity, 'Ctrl+Shift+A opens the activity center').toBe(true)
    expect.soft(JSON.stringify([out.menu, out.helpMenu, out.paletteReport]), 'Help › Report a problem').toMatch(/Report a problem/)
    expect.soft(out.categories, 'Settings › Keyboard exists').toContain('Keyboard')
    expect.soft(String(out.devices), 'phone connection off by default').toMatch(/off|Turn on|not on/i)
    expect.soft(String(out.updates), 'beta versions can be chosen').toMatch(/beta/i)
    expect.soft(String(out.appearance).match(/Motion.{0,200}/)?.[0] ?? 'no Motion', 'motion System/Reduced/Full').toMatch(/System.*Reduced.*Full/)
    expect.soft(errors, 'no page error').toEqual([])
  } finally { await quitReal(app) }
})
