import { expect, test, type Page } from '@playwright/test'
import { existsSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { launchReal, mode, openRepo, quitReal, realProfile } from './real-app'

/**
 * Batch 2c on main, black box on the REAL app (no doubles), throwaway profile:
 * - #208 (B7.3) per-tool rules: the list a project sees, a deny written to `.oxespace/policy.json` keeping what was
 *   there (other rules, `organization`, CRLF), the deny enforced on an agent's tools/call from a pane, `ask` lifting
 *   it, `allow` refused on a confirm-level tool, and an unreadable policy.json refused with nothing written.
 * - #286 (F25 caveat 3) quarantine: a trusted stdio server whose config is edited is quarantined, and what the app
 *   remembers as trusted holds the env KEYS and no secret, from env, flags or a URL argument.
 * - #173 (F1) OxePod with no reachable engine: an ErrorState with a level-2 heading and "Check again", no page error.
 */
type Rule = { server: string; tool: string; decision: string; source: string; editable: boolean; allowedDecisions: string[]; confirmLevel: boolean; scope: string | null }
const oxe = <T>(page: Page, expression: string) => page.evaluate(expression) as Promise<T>

const CALL = String.raw`
const [out, tool, args] = process.argv.slice(2)
const headers = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + process.env.OXESPACE_MCP_TOKEN, 'X-OXE-Workspace-Id': process.env.OXESPACE_WORKSPACE_ID,
  'X-OXE-Execution-Id': process.env.OXESPACE_EXECUTION_ID, 'X-OXE-Execution-Token': process.env.OXESPACE_EXECUTION_TOKEN }
const body = { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: tool, arguments: JSON.parse(require('fs').readFileSync(args, 'utf8')) } }
fetch('http://127.0.0.1:' + process.env.OXESPACE_MCP_PORT + '/rpc', { method: 'POST', headers, body: JSON.stringify(body), signal: AbortSignal.timeout(8000) })
  .then(r => r.text(), e => 'error: ' + e.message).then(t => require('fs').writeFileSync(out, t.slice(0, 600)))
`

test('#208 per-tool rules: written with what was there, enforced on an agent, lifted, and refused where they must be', async () => {
  test.setTimeout(240_000)
  const profile = realProfile('b73', { OXESPACE_LOCALE: 'en-US' })
  const { repo, root } = profile
  const policyPath = join(repo, '.oxespace', 'policy.json')
  mkdirSync(join(repo, '.oxespace'), { recursive: true })
  const seeded = '{\r\n  "organization": "acme",\r\n  "rules": [\r\n    { "effect": "deny", "action": "tool.use", "resource": "mcp__other__thing" }\r\n  ]\r\n}\r\n'
  writeFileSync(policyPath, seeded)
  const script = join(root, 'call.js'); writeFileSync(script, CALL)
  const { app, page } = await launchReal(profile)
  let calls = 0
  const call = async (tool: string, args: Record<string, unknown>) => {
    const out = join(root, `out-${++calls}.txt`); const file = join(root, `args-${calls}.json`); writeFileSync(file, JSON.stringify(args))
    await page.locator('[data-testid="pane-container"] .xterm').first().click()
    await page.keyboard.type(`node "${script}" "${out}" ${tool} "${file}"`); await page.keyboard.press('Enter')
    await expect.poll(() => existsSync(out), { timeout: 20_000 }).toBe(true)
    return readFileSync(out, 'utf8')
  }
  try {
    await app.evaluate(({ dialog }) => { dialog.showMessageBox = (() => new Promise(() => undefined)) as typeof dialog.showMessageBox; dialog.showMessageBoxSync = (() => 0) as typeof dialog.showMessageBoxSync })
    await openRepo(page, repo)
    const rules = await oxe<Rule[]>(page, `window.oxe.mcpInternal.toolRules({ rootPath: ${JSON.stringify(repo)} })`)
    console.log('B73-ROWS', rules.length, JSON.stringify(rules.slice(0, 3)))
    expect(rules.length, 'the project sees its tools').toBeGreaterThan(5)
    const notify = rules.find(r => r.tool === 'oxespace_workspace_change')
    const confirm = rules.find(r => r.confirmLevel)
    expect(notify, 'oxespace_workspace_change is listed').toBeTruthy()
    expect.soft(notify!.allowedDecisions.sort(), 'a write-level tool offers all three').toEqual(['allow', 'ask', 'deny'])
    expect.soft(confirm?.allowedDecisions.sort(), 'a confirm-level tool never offers allow').toEqual(['ask', 'deny'])

    // Before: the agent can notify.
    const before = await call('oxespace_workspace_change', { action: 'notify', title: 'Build finished' })
    expect.soft(before, 'notify works before the deny').not.toMatch(/isError":true|denied|policy/i)

    // Deny: written to policy.json, keeping what was there.
    const set = (decision: string, row: Rule) => oxe<Rule[]>(page, `window.oxe.mcpInternal.setToolRule(${JSON.stringify({ rootPath: repo, server: row.server, tool: row.tool, decision })}).then(r => r, e => ({ refused: String(e && e.message) }))`)
    const afterDeny = await set('deny', notify!) as unknown as Rule[] | { refused: string }
    expect.soft(Array.isArray(afterDeny) && afterDeny.find(r => r.tool === 'oxespace_workspace_change')?.decision, 'the row now says deny').toBe('deny')
    const written = readFileSync(policyPath, 'utf8')
    console.log('B73-POLICY', JSON.stringify(written))
    expect.soft(written, 'organization kept').toContain('"organization": "acme"')
    expect.soft(written, 'the other rule kept').toContain('mcp__other__thing')
    expect.soft(written, 'the deny written for the tool').toMatch(/"deny"[\s\S]*mcp__[^"]*oxespace_workspace_change/)
    expect.soft(written.includes('\r\n') && !/[^\r]\n/.test(written), 'CRLF kept').toBe(true)
    // Enforced on the agent at its next call.
    const denied = await call('oxespace_workspace_change', { action: 'notify', title: 'Build finished' })
    console.log('B73-DENIED', denied)
    expect.soft(denied, 'the agent is refused by the deny').toMatch(/isError":true/)

    // Ask lifts it.
    await set('ask', notify!)
    expect.soft(readFileSync(policyPath, 'utf8'), 'ask removes the deny').not.toMatch(/oxespace_workspace_change/)
    const lifted = await call('oxespace_workspace_change', { action: 'notify', title: 'Build finished again' })
    expect.soft(lifted, 'notify works again').not.toMatch(/isError":true/)

    // Allow on a confirm-level tool is refused, and nothing is written.
    const textBefore = readFileSync(policyPath, 'utf8')
    if (confirm) {
      const refused = await set('allow', confirm) as unknown as { refused?: string }
      expect.soft(refused.refused, 'allow refused at confirm level').toMatch(/mcp\.toolRule\.confirmLevel/)
      expect.soft(readFileSync(policyPath, 'utf8'), 'nothing written').toBe(textBefore)
    }
    // A policy.json that is not a policy: refused, untouched.
    writeFileSync(policyPath, '{ this is not json')
    const invalid = await set('deny', notify!) as unknown as { refused?: string }
    expect.soft(invalid.refused, 'an unreadable policy is refused').toMatch(/mcp\.toolRule\.invalidPolicy/)
    expect.soft(readFileSync(policyPath, 'utf8'), 'and left as it was').toBe('{ this is not json')
    // Another project's path is not a registered project.
    const foreign = await oxe<{ refused?: string }>(page, `window.oxe.mcpInternal.setToolRule(${JSON.stringify({ rootPath: join(root, 'not-a-project'), server: notify!.server, tool: notify!.tool, decision: 'deny' })}).then(() => ({}), e => ({ refused: String(e && e.message) }))`)
    expect.soft(foreign.refused, 'an unregistered folder is refused').toBeTruthy()
    expect.soft(existsSync(join(root, 'not-a-project', '.oxespace')), 'and nothing is created there').toBe(false)
  } finally { await quitReal(app); rmSync(policyPath, { force: true }) }
})

test('#286 an edited trusted server is quarantined, and what was trusted holds no secret', async () => {
  test.setTimeout(150_000)
  const profile = realProfile('f25', { OXESPACE_LOCALE: 'en-US' })
  const { app, page } = await launchReal(profile)
  const SECRETS = ['sk-live-ENVSECRET-1234567890', 'flagsecret-abcdef123456', 'spacedsecret-987654321', 'urlpass-112233', 'qtoken-445566', 'NAMEVALSECRET-778899']
  try {
    await app.evaluate(({ dialog }) => { dialog.showMessageBox = (() => new Promise(() => undefined)) as typeof dialog.showMessageBox; dialog.showMessageBoxSync = (() => 0) as typeof dialog.showMessageBoxSync })
    const created = await oxe<{ id: string }>(page, `window.oxe.mcp.create(${JSON.stringify({
      workspaceId: null, name: 'hml-deploy', transport: 'stdio', trusted: true, enabled: false,
      config: { transport: 'stdio', command: 'node', args: ['server.js', `--token=${SECRETS[1]}`, '--api-key', SECRETS[2], `https://bob:${SECRETS[3]}@example.invalid/mcp?access_token=${SECRETS[4]}`, `DEPLOY_SECRET=${SECRETS[5]}`, '--verbose'], env: { API_KEY: SECRETS[0], REGION: 'eu' } }
    })})`)
    await oxe(page, `window.oxe.mcp.update(${JSON.stringify({ id: created.id, config: { transport: 'stdio', command: 'node', args: ['server.js', '--other'], env: { API_KEY: SECRETS[0] } } })})`)
    const list = await oxe<Array<{ id: string; trusted: boolean; guard?: { quarantine?: { trusted?: { transport: string; command: string; args: string[]; envKeys: string[] } } } }>>(page, 'window.oxe.mcp.list(null)')
    const server = list.find(s => s.id === created.id)!
    const dump = JSON.stringify(server)
    console.log('F25-SERVER', JSON.stringify(server.guard ?? null).slice(0, 1500))
    expect.soft(server.trusted, 'an edited server is no longer trusted').toBe(false)
    const trusted = server.guard?.quarantine?.trusted
    expect.soft(trusted, 'the quarantine carries what was trusted').toBeTruthy()
    expect.soft(trusted?.envKeys?.slice().sort(), 'env keys only').toEqual(['API_KEY', 'REGION'])
    expect.soft(trusted?.args?.includes('--verbose'), 'harmless args kept').toBe(true)
    expect.soft(trusted?.args?.some(a => /--token/.test(a)), 'the flag name kept').toBe(true)
    // The trusted snapshot (and the whole record the window gets, outside the current config) holds no secret.
    const guardDump = JSON.stringify(server.guard ?? {})
    for (const secret of SECRETS) expect.soft(guardDump.includes(secret), `no "${secret.slice(0, 10)}…" in what was trusted`).toBe(false)
    expect.soft(dump.length).toBeGreaterThan(0)
  } finally { await quitReal(app) }
})

test('#173 OxePod with no reachable engine: an error state with a heading and Check again', async () => {
  test.setTimeout(120_000)
  const bogus = process.platform === 'win32' ? 'npipe:////./pipe/oxespace_hml_no_engine' : 'unix:///tmp/oxespace-hml-no-engine.sock'
  const profile = realProfile('f1pod', { OXESPACE_LOCALE: 'en-US', DOCKER_HOST: bogus, CONTAINER_HOST: bogus })
  const { app, page } = await launchReal(profile)
  const errors: string[] = []
  page.on('pageerror', e => errors.push(e.message))
  try {
    await app.evaluate(({ dialog }) => { dialog.showMessageBox = (() => new Promise(() => undefined)) as typeof dialog.showMessageBox; dialog.showMessageBoxSync = (() => 0) as typeof dialog.showMessageBoxSync })
    await mode(page, 'pods')
    const heading = page.getByRole('heading', { level: 2, name: /Docker|Podman|engine|container/i }).first()
    await expect(heading, 'a level-2 heading names the problem').toBeVisible({ timeout: 20_000 })
    const again = page.getByRole('button', { name: /Check again|Checking/i }).first()
    await expect.soft(again, '"Check again" is offered').toBeVisible()
    console.log('F1-POD', JSON.stringify({ heading: await heading.innerText(), text: (await heading.locator('xpath=ancestor::*[1]').innerText().catch(() => '')).slice(0, 300) }))
    await again.click()
    await expect.soft(heading, 'still explained after checking again').toBeVisible({ timeout: 15_000 })
    expect.soft(errors, 'no page error').toEqual([])
  } finally { await quitReal(app) }
})
