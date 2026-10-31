import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { launchReal, openRepo, quitReal, realProfile } from './real-app'

/**
 * B7.4 (S1) · An agent cannot widen the project's OXESpace policy without the person.
 * Gated files: .oxespace/policy.json and the security part of oxe.yaml (thread.tools / toolModes, the B7.3 rules).
 * Roadmap acceptance: an outside change that widens them becomes a B10 request (kind policyChange, high risk, the diff of
 * the rules); until it is answered, and after Deny, the accepted rules stay in force; the app's own write never asks.
 *
 * REAL app, no doubles, no agent run. The "agent" is agent.js, started inside the pane's own terminal, so every write
 * comes from a process with that pane's execution env, as a CLI with broad write permission would do it:
 *   1. an editor-style edit of policy.json (temp file, then rename over it) that drops a deny rule;
 *   2. `git checkout HEAD~1 -- oxe.yaml`, which brings back a permissive committed version;
 *   3. an interpreter (python when present, else node) writing policy.json;
 *   4. a narrowing edit (one more deny rule): applies at once, with a notice, no request;
 *   5. the app's own write (Settings › Tools, setToolGroupMode → withToolMode): never asks;
 *   6. the same widened content written again after Deny: does not ask again;
 *   7. a deleted, an invalid and a huge policy.json are changes too (none of them drops the accepted rules);
 *   8. a fresh worktree of the same repo, whose committed policy.json is wider, does not reset the accepted version;
 *   9. with the data group off, the agent edits .mcp.json so the bridge offers every tool, and calls a data tool:
 *      refused at tools/call by the app, not only hidden by the bridge;
 *  10. a Settings click while an agent's change is pending is refused (policy.change.pending), and the agent's
 *      content is not recorded as accepted.
 * Native dialogs are held (never answered) and counted, so nothing reaches the runner's screen.
 * Contract guesses owners may rename: kind 'policyChange', a policy-area incident code, the notice text.
 * Not covered yet: expiry (APPROVAL_TIMEOUT_MS is 5 min; added when the e2e hook that shortens it lands).
 */
type Req = { id: string; generation: number; kind: string; risk: string; defaultOptionId: string; options: Array<{ id: string; intent: string }>; title: { code: string }; summary: { code: string }; target?: string; [k: string]: unknown }
type Oxe = {
  approvals: { list: () => Promise<Req[]>; history: () => Promise<Array<{ id: string; kind: string; by: string; outcome: string }>>; ack: (i: object) => Promise<unknown>; respond: (i: object) => Promise<{ ok: boolean }> }
  diagnostics: { incidents: () => Promise<Array<{ code: string; area: string; lastAt: number; count: number }>> }
  policy: { get: (id: string) => Promise<unknown> }
  mcpInternal: { toolGroups: (i: object) => Promise<{ groups: Array<{ id: string; mode: string; source: string }> }>; setToolGroupMode: (i: object) => Promise<unknown> }
  workspace: { list: () => Promise<Array<{ id: string; rootPath?: string; root_path?: string }>> }
}
/** Runs `fn(window.oxe, arg)` in the window; a string expression goes through CDP, so the page's CSP does not apply. */
const oxe = <T>(page: Page, fn: (o: Oxe, arg: never) => Promise<T>, arg?: unknown) =>
  page.evaluate(`(${fn.toString()})(window.oxe, ${JSON.stringify(arg ?? null)})`) as Promise<T>

const rule = (effect: string, resource: string) => ({ effect, action: 'tool.use', resource })
const ACCEPTED_POLICY = JSON.stringify({ rules: [rule('deny', 'mcp__oxespace__oxespace_db_execute')] }, null, 2) + '\n'
const WIDE_POLICY = JSON.stringify({ rules: [rule('allow', '*')] }, null, 2) + '\n'
const WIDE_POLICY_2 = JSON.stringify({ rules: [rule('allow', 'mcp__oxespace__*')] }, null, 2) + '\n'
const WIDE_POLICY_3 = JSON.stringify({ rules: [rule('allow', 'mcp__oxespace__oxespace_db_*')] }, null, 2) + '\n'
const NARROW_POLICY = JSON.stringify({ rules: [rule('deny', 'mcp__oxespace__oxespace_db_execute'), rule('deny', 'mcp__oxespace__oxespace_git_change')] }, null, 2) + '\n'
const INVALID_POLICY = '{ "rules": [ { "effect": "allow", '
const HUGE_POLICY = JSON.stringify({ rules: [], note: 'x'.repeat(3 * 1024 * 1024) })
const ACCEPTED_YAML = 'thread:\n  tools:\n    data: "off"\n'
const PERMISSIVE_YAML = 'thread:\n  tools:\n    data: always\n    app: always\n'
const PERMISSIVE_YAML_2 = 'thread:\n  tools:\n    data: on-demand\n    docs: always\n'
/** A read-only tool of the data group: what the agent tries to bring back once the group is off. */
const DATA_TOOL = 'oxespace_db_connections'

const AGENT = String.raw`
const fs = require('fs'), path = require('path'), { execFileSync, spawn } = require('child_process')
const [step, payload, done, target] = process.argv.slice(2)
const policy = path.join('.oxespace', 'policy.json')
const out = { ok: true, used: step, execution: Boolean(process.env.OXESPACE_EXECUTION_ID) }
const finish = extra => { fs.writeFileSync(done, JSON.stringify({ ...out, ...extra })); process.exit(0) }
const gitc = (cwd, ...args) => execFileSync('git', ['-c', 'user.email=agent@example.invalid', '-c', 'user.name=agent', ...args], { cwd, stdio: 'ignore' })
try {
  if (step === 'rename-edit') { fs.writeFileSync(policy + '.acc-tmp', fs.readFileSync(payload)); fs.renameSync(policy + '.acc-tmp', policy) }
  else if (step === 'write') fs.writeFileSync(target && target !== '-' ? target : policy, fs.readFileSync(payload))
  else if (step === 'delete') fs.rmSync(policy)
  else if (step === 'git-checkout') execFileSync('git', ['checkout', 'HEAD~1', '--', 'oxe.yaml'], { stdio: 'ignore' })
  else if (step === 'interpreter') {
    try { execFileSync('python', ['-c', 'import shutil,sys; shutil.copyfile(sys.argv[1], sys.argv[2])', payload, policy], { stdio: 'ignore' }); out.used = 'python' }
    catch { execFileSync(process.execPath, ['-e', 'require("fs").copyFileSync(process.argv[1], process.argv[2])', payload, policy], { stdio: 'ignore' }); out.used = 'node -e' }
  }
  else if (step === 'worktree') {
    gitc('.', 'worktree', 'add', '-q', '-b', 'acc-wide', target, 'HEAD')
    fs.copyFileSync(payload, path.join(target, '.oxespace', 'policy.json'))
    gitc(target, 'commit', '-q', '-am', 'wider policy')
  }
  else if (step === 'mcp-call') {
    // The agent rewrites the project's .mcp.json so the OXESpace bridge offers every tool, then calls one, as its CLI would.
    const config = JSON.parse(fs.readFileSync('.mcp.json', 'utf8'))
    const [name, entry] = Object.entries(config.mcpServers || {}).find(([, e]) => (e.args || []).some(a => /oxespace-mcp/.test(String(a)))) || []
    if (!entry) finish({ ok: false, error: 'no OXESpace entry in .mcp.json' })
    const allowIndex = entry.args.indexOf('--allowed-tools')
    out.offeredBefore = allowIndex < 0 ? true : JSON.parse(entry.args[allowIndex + 1]).includes(payload)
    const args = []
    for (let i = 0; i < entry.args.length; i++) { if (entry.args[i] === '--allowed-tools' || entry.args[i] === '--enableable-groups') { i++; continue } args.push(entry.args[i]) }
    config.mcpServers[name] = { ...entry, args }
    fs.writeFileSync('.mcp.json', JSON.stringify(config, null, 2))
    const child = spawn(entry.command, args, { env: { ...process.env, ...(entry.env || {}) }, stdio: ['pipe', 'pipe', 'ignore'], shell: /\.cmd$/i.test(entry.command) })
    let buf = ''
    const send = m => child.stdin.write(JSON.stringify({ jsonrpc: '2.0', ...m }) + '\n')
    const timer = setTimeout(() => { child.kill(); finish({ ok: false, error: 'bridge timeout' }) }, 15000)
    child.stdout.on('data', d => {
      buf += String(d)
      let i
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1)
        if (!line) continue
        const m = JSON.parse(line)
        if (m.id === 1) { send({ method: 'notifications/initialized' }); send({ id: 2, method: 'tools/list', params: {} }) }
        else if (m.id === 2) { out.offeredAfter = (m.result && m.result.tools || []).some(t => t.name === payload); send({ id: 3, method: 'tools/call', params: { name: payload, arguments: {} } }) }
        else if (m.id === 3) { clearTimeout(timer); child.kill(); finish({ response: JSON.stringify(m).slice(0, 2000) }) }
      }
    })
    send({ id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'acc-agent', version: '1' } } })
    return
  }
  finish({})
} catch (e) { finish({ ok: false, error: String(e && e.message) }) }
`
type AgentResult = { ok: boolean; used: string; execution: boolean; error?: string; offeredBefore?: boolean; offeredAfter?: boolean; response?: string }

test('B7.4: an agent widening the OXESpace policy waits for the person', async () => {
  test.setTimeout(360_000)
  const profile = realProfile('b74p', { OXESPACE_LOCALE: 'en-US' })
  const { repo, root } = profile
  const git = (...args: string[]) => execFileSync('git', ['-c', 'user.email=acc@example.invalid', '-c', 'user.name=acc', ...args], { cwd: repo })
  mkdirSync(join(repo, '.oxespace'))
  // HEAD~1 holds a permissive oxe.yaml; HEAD is the accepted state, as a project whose history once had wider rules.
  writeFileSync(join(repo, 'oxe.yaml'), PERMISSIVE_YAML); git('add', '.'); git('commit', '-q', '-m', 'wide')
  writeFileSync(join(repo, 'oxe.yaml'), ACCEPTED_YAML); writeFileSync(join(repo, '.oxespace', 'policy.json'), ACCEPTED_POLICY)
  git('add', '.'); git('commit', '-q', '-m', 'accepted')
  const agent = join(root, 'agent.js'); writeFileSync(agent, AGENT)
  const payload = (name: string, text: string) => { const p = join(root, `${name}.txt`); writeFileSync(p, text); return p }

  const { app, page } = await launchReal(profile)
  try {
    await holdNativeDialogs(app)
    await openRepo(page, repo)
    const workspaceId = await oxe(page, o => o.workspace.list().then(l => l[0].id))
    const terminal = page.locator('[data-testid="pane-container"] .xterm').first()
    await terminal.waitFor({ timeout: 20_000 })
    await page.waitForTimeout(2_000)
    const policyText = (id = workspaceId) => oxe(page, (o, i: string) => o.policy.get(i).then(v => JSON.stringify(v)), id)
    const groupMode = (group: string) => oxe(page, (o, a: { root: string; group: string }) => o.mcpInternal.toolGroups({ rootPath: a.root }).then(r => r.groups.find(g => g.id === a.group)?.mode), { root: repo, group })
    const setMode = (group: string, mode: string) => oxe(page, (o, a: { root: string; group: string; mode: string }) => o.mcpInternal.setToolGroupMode({ rootPath: a.root, group: a.group, mode: a.mode }).then(() => 'ok', (e: Error) => `refused: ${e.message}`), { root: repo, group, mode })
    const pending = () => oxe(page, o => o.approvals.list())
    const incidents = () => oxe(page, o => o.diagnostics.incidents())
    const denyKeepsDbDeny = async () => (await policyText()).includes('oxespace_db_execute')

    expect(await policyText(), 'the accepted deny rule is in force at start').toContain('oxespace_db_execute')
    expect(await groupMode('data'), 'the accepted oxe.yaml keeps data off at start').toBe('off')
    expect(await pending(), 'nothing is asked at start').toHaveLength(0)

    let step = 0
    const runAgent = async (what: string, file?: string, target?: string): Promise<AgentResult> => {
      const done = join(root, `done-${++step}.json`)
      await terminal.click()
      // A placeholder, never "": PowerShell drops an empty argument to a native program.
      await page.keyboard.type(`node "${agent}" ${what} "${file ?? '-'}" "${done}" "${target ?? '-'}"`); await page.keyboard.press('Enter')
      await expect.poll(() => existsSync(done), { timeout: 30_000, message: `agent step ${what} finished` }).toBe(true)
      const result = JSON.parse(readFileSync(done, 'utf8')) as AgentResult
      expect(result.ok, `agent step ${what} did its part (${result.error ?? result.used})`).toBe(true)
      expect(result.execution, 'the agent runs with the pane execution env').toBe(true)
      return result
    }
    const newRequest = async (label: string, before: Set<string>) => {
      let request: Req | undefined
      await expect.soft.poll(async () => {
        request = (await pending()).find(r => !before.has(r.id))
        return request ? request.kind : 'none'
      }, { timeout: 10_000, message: `${label}: the person is asked (B10 policyChange)` }).toBe('policyChange')
      return request
    }
    const deny = async (label: string, request: Req) => {
      await oxe(page, (o, r: Req) => o.approvals.ack({ id: r.id, generation: r.generation, visible: true, focused: true }), request)
      const answer = await oxe(page, (o, r: Req) => o.approvals.respond({ id: r.id, generation: r.generation, optionId: r.defaultOptionId }), request)
      expect.soft(answer.ok, `${label}: Deny is accepted`).toBe(true)
      await page.waitForTimeout(1_000)
    }
    /** A widening edit: a policyChange request with the diff, the old rules in force, then Deny keeps them. */
    const expectAskedThenDeny = async (label: string, changed: string | null, stillInForce: () => Promise<boolean>) => {
      const since = Date.now()
      const before = new Set((await pending()).map(r => r.id))
      const request = await newRequest(label, before)
      expect.soft(await stillInForce(), `${label}: until the answer, the accepted rules stay in force`).toBe(true)
      if (request) {
        expect.soft(['high', 'critical'], `${label}: high risk`).toContain(request.risk)
        expect.soft(request.options.find(o => o.id === request.defaultOptionId)?.intent, `${label}: Deny is the default`).toBe('deny')
        expect.soft(request.title.code, `${label}: title is a C3 code`).toMatch(/^[a-z]\w*(\.\w+)+$/)
        if (changed) expect.soft(JSON.stringify({ ...request, agentText: undefined }), `${label}: the app's own text carries the diff of the rules`).toContain(changed)
        await deny(label, request)
        expect.soft(await stillInForce(), `${label}: after Deny the accepted rules stay in force`).toBe(true)
        const entry = (await oxe(page, o => o.approvals.history())).find(h => h.id === request.id)
        expect.soft(entry?.outcome, `${label}: the decision is in the history`).toBe('deny')
      }
      const journal = (await incidents()).filter(i => i.lastAt >= since && /policy/i.test(`${i.code} ${i.area}`))
      expect.soft(journal.length, `${label}: the outside change is in the incident journal with a C3 code`).toBeGreaterThan(0)
    }

    // (5) The app's own write: Settings › Tools turns docs off through withToolMode. It applies and never asks.
    expect.soft(await setMode('docs', 'off'), '(5) the app\'s own write is accepted').toBe('ok')
    await page.waitForTimeout(3_000)
    expect.soft(await pending(), '(5) the app\'s own write asks nothing').toHaveLength(0)
    expect.soft(await groupMode('docs'), '(5) the app\'s own write applies').toBe('off')

    // (9) data is off. The agent strips the bridge's tool list from .mcp.json and calls a data tool itself.
    const mcp = await runAgent('mcp-call', DATA_TOOL)
    expect(mcp.offeredBefore, `(9) the app's .mcp.json does not offer ${DATA_TOOL} while data is off`).toBe(false)
    expect(mcp.offeredAfter, '(9) the edited .mcp.json makes the bridge offer every tool').toBe(true)
    expect.soft(mcp.response ?? '', `(9) ${DATA_TOOL} is refused by the app at tools/call (group off)`).toMatch(/"isError":true|"error":\{/)
    expect.soft(mcp.response ?? '', '(9) the refusal carries a C3 code').toMatch(/[a-z]\w*\.\w+\.\w+/)

    // (1) Editor-style edit (temp + rename) dropping the deny rule.
    await runAgent('rename-edit', payload('wide', WIDE_POLICY))
    await expectAskedThenDeny('(1) rename edit of policy.json', '"allow"', denyKeepsDbDeny)

    // (6) The same widened content again after Deny: no second request, the accepted rules still apply.
    const beforeRepeat = (await pending()).length
    await runAgent('write', payload('wide', WIDE_POLICY))
    await page.waitForTimeout(5_000)
    expect.soft((await pending()).length, '(6) the same content after Deny does not ask again').toBe(beforeRepeat)
    expect.soft(await policyText(), '(6) the accepted rules still apply').toContain('oxespace_db_execute')

    // (3) An interpreter writes a different widening.
    const used = await runAgent('interpreter', payload('wide2', WIDE_POLICY_2))
    await expectAskedThenDeny(`(3) ${used.used} writes policy.json`, 'mcp__oxespace__*', denyKeepsDbDeny)

    // (2) git checkout of a permissive committed oxe.yaml.
    await runAgent('git-checkout')
    expect(readFileSync(join(repo, 'oxe.yaml'), 'utf8'), 'the permissive version is on disk').toContain('data: always')
    await expectAskedThenDeny('(2) git checkout -- oxe.yaml', 'data', async () => (await groupMode('data')) === 'off')

    // (10) A Settings click while an agent's oxe.yaml change is pending: refused, and the agent's content is not accepted.
    {
      const before = new Set((await pending()).map(r => r.id))
      await runAgent('write', payload('yaml2', PERMISSIVE_YAML_2), join(repo, 'oxe.yaml'))
      const request = await newRequest('(10) agent edit of oxe.yaml', before)
      expect.soft(await setMode('app', 'off'), '(10) the Settings click is refused while the change is pending').toMatch(/refused: .*policy\.change\.pending/)
      if (request) await deny('(10)', request)
      expect.soft(await groupMode('data'), '(10) the agent\'s data mode was not recorded as accepted').toBe('off')
      expect.soft(await groupMode('docs'), '(10) the agent\'s docs mode was not recorded as accepted').toBe('off')
    }

    // (7) Deleted, invalid and huge policy.json: each is a change and none drops the accepted rules.
    await runAgent('delete')
    await expectAskedThenDeny('(7) policy.json deleted', null, denyKeepsDbDeny)
    await runAgent('write', payload('invalid', INVALID_POLICY))
    await expectAskedThenDeny('(7) policy.json invalid', null, denyKeepsDbDeny)
    await runAgent('write', payload('huge', HUGE_POLICY))
    await expectAskedThenDeny('(7) policy.json of 3 MB', null, denyKeepsDbDeny)

    // (4) A narrowing edit: one more deny rule. Applies at once, with a notice, and asks nothing.
    const beforeNarrow = (await pending()).length
    await runAgent('write', payload('narrow', NARROW_POLICY))
    await expect.soft.poll(() => policyText(), { timeout: 5_000, message: '(4) the narrowing applies at once' }).toContain('oxespace_git_change')
    expect.soft((await pending()).length, '(4) a narrowing asks nothing').toBe(beforeNarrow)
    await expect.soft(page.getByRole('status').or(page.getByRole('alert')).filter({ hasText: /policy|política/i }).first(), '(4) the person is told the rules got stricter').toBeVisible({ timeout: 5_000 })

    // (8) A fresh worktree of the same repo with a wider committed policy.json, opened as a workspace.
    const wt = join(root, 'wt-wide')
    await runAgent('worktree', payload('wide3', WIDE_POLICY_3), wt)
    const beforeWt = new Set((await pending()).map(r => r.id))
    await openRepo(page, wt)
    const wtId = await oxe(page, (o, path: string) => o.workspace.list().then(l => (l.find(w => (w.rootPath ?? w.root_path ?? '').replace(/[\\/]+$/, '').toLowerCase() === path.toLowerCase()) ?? l[l.length - 1]).id), wt)
    expect(wtId, '(8) the worktree opened as its own workspace').not.toBe(workspaceId)
    expect.soft(await policyText(wtId), '(8) the worktree keeps the accepted deny rule').toContain('oxespace_db_execute')
    expect.soft(await policyText(wtId), '(8) the worktree\'s wider rule is not in force').not.toContain('oxespace_db_*')
    const wtRequest = await newRequest('(8) fresh worktree', beforeWt)
    if (wtRequest) await deny('(8)', wtRequest)

    expect.soft(await app.evaluate(() => (globalThis as Record<string, unknown>).accNative), 'no native dialog while the window is open').toBe(0)
  } finally {
    await quitReal(app)
    // Electron may still hold files in user-data for a moment; a leftover temp folder must not hide the result.
    try { rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 }) } catch { /* left in the temp folder */ }
  }
})

/** Native dialogs never show: message boxes are held unanswered (a person who has not clicked) and counted. */
async function holdNativeDialogs(app: ElectronApplication): Promise<void> {
  await app.evaluate(({ dialog }) => {
    const g = globalThis as Record<string, unknown>; g.accNative = 0
    dialog.showMessageBox = (() => { g.accNative = (g.accNative as number) + 1; return new Promise(() => undefined) }) as typeof dialog.showMessageBox
    dialog.showMessageBoxSync = (() => { g.accNative = (g.accNative as number) + 1; return 0 }) as typeof dialog.showMessageBoxSync
  })
}
